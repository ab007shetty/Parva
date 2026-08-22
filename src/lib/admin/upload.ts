'use client';

import { ID } from 'appwrite';

import { normalizeHex, readableInk } from '@/lib/utils';

/**
 * Direct browser-to-Appwrite upload, plus metadata extraction.
 *
 * Two things happen here that make adding a book nearly automatic:
 *
 *  1. The file goes straight to Appwrite with a short-lived admin JWT, so a
 *     200 MB book is not limited by a serverless request body and the
 *     administrator sees real progress.
 *
 *  2. Before uploading, the file is read locally to pull out its title, author,
 *     page count and cover image — a PDF's info dictionary and first page, an
 *     EPUB's OPF metadata and cover entry. Most books then need nothing typed.
 */

export type UploadCredentials = {
  jwt: string;
  endpoint: string;
  projectId: string;
  buckets: { books: string; covers: string };
  /** Epoch ms after which the JWT is no longer accepted. */
  expiresAt: number;
};

/**
 * Fetches upload credentials, minting fresh ones when the ones we hold are
 * close to expiry.
 *
 * The JWT lasts fifteen minutes. A librarian who drops a file, writes a
 * description and then saves can easily take longer than that, so caching one
 * for the lifetime of the form would fail exactly on the careful uploads.
 */
export async function getUploadCredentials(
  cached?: UploadCredentials | null,
): Promise<UploadCredentials> {
  // A minute of headroom, so a large upload that starts valid stays valid.
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached;

  const response = await fetch('/api/admin/upload-token', { method: 'POST' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? 'Could not start the upload.');
  }

  const data = await response.json();
  if (!data.endpoint || !data.projectId) {
    throw new Error('Appwrite is not configured. Check NEXT_PUBLIC_APPWRITE_ENDPOINT.');
  }

  return {
    ...data,
    expiresAt: Date.now() + (data.expiresInSeconds ?? 900) * 1000,
  };
}

export type UploadResult = { fileId: string; bytes: number; name: string };

/** Appwrite requires anything above this to be sent in chunks. */
const CHUNK_SIZE = 5 * 1024 * 1024;

/**
 * Uploads a file, preferring our own origin.
 *
 * Two routes to the same place, and the order matters:
 *
 *   1. Through /api/admin/upload. Same-origin, so there is no preflight, no
 *      ambient Appwrite cookie, no expiring token — and when Appwrite objects,
 *      its actual message reaches the screen. This is the path that can be
 *      debugged, so it is the path we try first.
 *
 *   2. Straight to Appwrite. Only used when the platform refuses the body,
 *      which on a serverless host means anything past a few megabytes. It works,
 *      but a failure here is opaque by construction: Appwrite omits CORS headers
 *      on its 401, so the browser can never read the reason.
 */
export async function uploadFile(
  credentials: UploadCredentials,
  kind: 'book' | 'cover',
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  try {
    return await uploadViaServer(file, kind, onProgress);
  } catch (error) {
    if (!(error instanceof BodyTooLargeError)) throw error;
    // The host will not carry a body this size. Nothing for it but to go direct.
    onProgress?.(0);
    const bucketId = kind === 'cover' ? credentials.buckets.covers : credentials.buckets.books;
    return uploadDirectToAppwrite(credentials, bucketId, file, onProgress);
  }
}

/** Thrown when the platform, not Appwrite, rejected the request body. */
class BodyTooLargeError extends Error {
  constructor() {
    super('The server would not accept a body that large.');
    this.name = 'BodyTooLargeError';
  }
}

/**
 * Posts the file to our own route.
 *
 * XMLHttpRequest rather than fetch, because fetch still cannot report upload
 * progress — and a silent three-minute wait on a 30 MB book reads as a broken
 * button.
 */
function uploadViaServer(
  file: File,
  kind: 'book' | 'cover',
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ kind, name: file.name });
    const request = new XMLHttpRequest();

    request.open('POST', `/api/admin/upload?${params.toString()}`);
    request.responseType = 'json';

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };

    request.onload = () => {
      const body = request.response as { fileId?: string; bytes?: number; name?: string; error?: string } | null;

      if (request.status === 413 || body?.error === 'too-large') {
        reject(new BodyTooLargeError());
        return;
      }
      if (request.status < 200 || request.status >= 300 || !body?.fileId) {
        reject(new Error(body?.error ?? `The upload failed (${request.status}).`));
        return;
      }

      onProgress?.(100);
      resolve({ fileId: body.fileId, bytes: body.bytes ?? file.size, name: body.name ?? file.name });
    };

    request.onerror = () =>
      reject(new Error('Could not reach the server. Check your connection and try again.'));
    request.ontimeout = () => reject(new Error('The upload timed out.'));

    request.send(file);
  });
}

/**
 * Uploads straight to Appwrite storage, deliberately not using the SDK.
 *
 * The web SDK sends `credentials: 'include'` on every request. That means the
 * browser attaches any Appwrite cookie it happens to hold for that domain —
 * including the `a_session_console` cookie of anyone logged into the Appwrite
 * console, which is to say the developer, always. Appwrite then resolves the
 * request against that cookie's session rather than our JWT, finds an account
 * without the `admin` label, and answers 401. Worse, its error response carries
 * no CORS headers, so the browser reports a CORS failure and the real cause is
 * invisible.
 *
 * Sending the request ourselves with `credentials: 'omit'` makes the JWT the
 * only identity in play, which is both correct and reproducible.
 */
async function uploadDirectToAppwrite(
  credentials: UploadCredentials,
  bucketId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  const endpoint = credentials.endpoint.replace(/\/$/, '');
  const url = `${endpoint}/storage/buckets/${bucketId}/files`;
  const fileId = ID.unique();

  const baseHeaders: Record<string, string> = {
    'X-Appwrite-Project': credentials.projectId,
    'X-Appwrite-JWT': credentials.jwt,
    // Appwrite answers with the response shape this SDK version expects.
    'X-Appwrite-Response-Format': '1.9.0',
  };

  async function send(body: FormData, extra: Record<string, string> = {}) {
    const response = await fetch(url, {
      method: 'POST',
      // The whole point: no ambient cookies.
      credentials: 'omit',
      headers: { ...baseHeaders, ...extra },
      body,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(describeUploadError(response.status, payload));
    }
    return payload as { $id: string; sizeOriginal?: number; chunksUploaded?: number };
  }

  // Small enough to go in one request.
  if (file.size <= CHUNK_SIZE) {
    const body = new FormData();
    body.append('fileId', fileId);
    body.append('file', file, file.name);

    const created = await send(body);
    onProgress?.(100);
    return { fileId: created.$id, bytes: created.sizeOriginal ?? file.size, name: file.name };
  }

  // Chunked. The first chunk establishes the upload; every chunk after it
  // carries the id Appwrite returned, and each declares its own byte range.
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  let uploadId = '';
  let uploaded = 0;
  let last: { $id: string; sizeOriginal?: number } | null = null;

  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);

    const body = new FormData();
    body.append('fileId', fileId);
    body.append('file', new File([file.slice(start, end)], file.name, { type: file.type }));

    const extra: Record<string, string> = {
      'content-range': `bytes ${start}-${end - 1}/${file.size}`,
    };
    if (uploadId) extra['x-appwrite-id'] = uploadId;

    last = await send(body, extra);
    uploadId ||= last.$id;

    uploaded = end;
    onProgress?.(Math.round((uploaded / file.size) * 100));
  }

  return {
    fileId: last?.$id ?? fileId,
    bytes: last?.sizeOriginal ?? file.size,
    name: file.name,
  };
}

/** Turns Appwrite's upload failures into something a librarian can act on. */
function describeUploadError(status: number, payload: unknown): string {
  const message =
    payload && typeof payload === 'object' && 'message' in payload
      ? String((payload as { message: unknown }).message)
      : '';

  if (status === 401) {
    return 'Appwrite rejected the upload credentials. Sign out and back in, then try again.';
  }
  if (status === 403) {
    return 'This account is not allowed to upload. It needs the admin label — see SETUP.md.';
  }
  if (status === 404) {
    return 'The storage bucket does not exist yet. Run `npm run setup` and try again.';
  }
  if (status === 413 || /size/i.test(message)) {
    return message || 'That file is larger than your Appwrite storage allows.';
  }
  if (status === 400 && /extension/i.test(message)) {
    return 'Appwrite refused that file type. Re-run `npm run setup` to allow it.';
  }
  return message || `The upload failed (${status}).`;
}

/* ═══════════════════════════════════════════════════════════════════
   Metadata extraction
   ═══════════════════════════════════════════════════════════════════ */

export type ExtractedMetadata = {
  title: string | null;
  authors: string[];
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  isbn: string | null;
  description: string | null;
  pageCount: number | null;
  /** Rendered or embedded cover, ready to upload. */
  cover: { blob: Blob; name: string; ratio: number; color: string } | null;
};

const EMPTY: ExtractedMetadata = {
  title: null,
  authors: [],
  publisher: null,
  publishedYear: null,
  language: null,
  isbn: null,
  description: null,
  pageCount: null,
  cover: null,
};

export async function extractMetadata(file: File): Promise<ExtractedMetadata> {
  try {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      return await extractFromPdf(file);
    }
    return await extractFromEpub(file);
  } catch (error) {
    // Extraction is a convenience. A file we cannot read is still uploadable —
    // the administrator just types the details.
    console.warn('[parva] could not read metadata from the file', error);
    return EMPTY;
  }
}

async function extractFromPdf(file: File): Promise<ExtractedMetadata> {
  const { loadPdf, destroyPdf } = await import('@/lib/reader/pdf-engine');

  const url = URL.createObjectURL(file);
  let loaded: Awaited<ReturnType<typeof loadPdf>> | null = null;

  try {
    loaded = await loadPdf(url);
    const { doc, pageCount, title, author } = loaded;

    // Render page one as the cover. A scanned book's first page *is* its cover,
    // and even a typeset one gives a truer thumbnail than a grey box.
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const targetWidth = 900;
    const viewport = page.getViewport({ scale: targetWidth / base.width });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    await page.render({ canvas, viewport, background: '#ffffff' }).promise;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.86),
    );

    const color = dominantColorFromCanvas(canvas);

    return {
      ...EMPTY,
      title: title ?? fileNameToTitle(file.name),
      authors: author ? splitAuthors(author) : [],
      pageCount,
      cover: blob
        ? {
            blob,
            name: 'cover.webp',
            ratio: viewport.width / viewport.height,
            color,
          }
        : null,
    };
  } finally {
    if (loaded) await destroyPdf(loaded);
    URL.revokeObjectURL(url);
  }
}

async function extractFromEpub(file: File): Promise<ExtractedMetadata> {
  const ePub = (await import('epubjs')).default;

  // An ArrayBuffer skips epub.js's URL-extension sniffing entirely, which is
  // what we want — a local File has no URL for it to inspect.
  const book = ePub(await file.arrayBuffer());

  try {
    await book.ready;

    const metadata = book.packaging?.metadata as
      | {
          title?: string;
          creator?: string;
          publisher?: string;
          pubdate?: string;
          language?: string;
          identifier?: string;
          description?: string;
        }
      | undefined;

    let cover: ExtractedMetadata['cover'] = null;
    try {
      const coverHref = await book.coverUrl();
      if (coverHref) {
        const response = await fetch(coverHref);
        const blob = await response.blob();
        const measured = await measureImage(blob);
        cover = {
          blob,
          name: 'cover',
          ratio: measured.ratio,
          color: measured.color,
        };
      }
    } catch {
      // Plenty of EPUBs have no cover entry. A generated typographic cover
      // stands in on the shelf.
    }

    const year = metadata?.pubdate ? Number(metadata.pubdate.slice(0, 4)) : null;

    return {
      title: metadata?.title?.trim() || fileNameToTitle(file.name),
      authors: metadata?.creator ? splitAuthors(metadata.creator) : [],
      publisher: metadata?.publisher?.trim() || null,
      publishedYear: Number.isFinite(year) && year! > 0 ? year : null,
      language: metadata?.language?.trim().slice(0, 12).toLowerCase() || null,
      isbn: metadata?.identifier?.replace(/^urn:isbn:/i, '').trim() || null,
      description: metadata?.description
        ? // EPUB descriptions are usually HTML fragments.
          stripHtml(metadata.description).slice(0, 4000)
        : null,
      pageCount: null,
      cover,
    };
  } finally {
    try {
      book.destroy();
    } catch {
      // Already gone.
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Cover colour

   Every cover contributes one colour, which becomes that book's --bloom. It is
   the only colour the interface borrows, so it is worth sampling properly:
   average the image but discard near-white and near-black pixels, which are
   usually page margins and text rather than the cover's actual colour.
   ═══════════════════════════════════════════════════════════════════ */

export function dominantColorFromCanvas(canvas: HTMLCanvasElement): string {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '#e9e9e9';

    // Sample a downscaled copy — reading a 900px canvas pixel by pixel is slow
    // and adds nothing.
    const size = 48;
    const small = document.createElement('canvas');
    small.width = size;
    small.height = size;
    const smallCtx = small.getContext('2d', { willReadFrequently: true });
    if (!smallCtx) return '#e9e9e9';

    smallCtx.drawImage(canvas, 0, 0, size, size);
    const { data } = smallCtx.getImageData(0, 0, size, size);

    let r = 0;
    let g = 0;
    let b = 0;
    let counted = 0;

    for (let i = 0; i < data.length; i += 4) {
      const pr = data[i]!;
      const pg = data[i + 1]!;
      const pb = data[i + 2]!;
      const alpha = data[i + 3]!;
      if (alpha < 128) continue;

      const brightness = (pr + pg + pb) / 3;
      // Skip paper and ink; keep the colour in between.
      if (brightness > 236 || brightness < 26) continue;

      r += pr;
      g += pg;
      b += pb;
      counted += 1;
    }

    // An entirely black-and-white cover — a plain scan — legitimately has no
    // colour. A warm grey is a better --bloom than a muddy average.
    if (counted < 40) return '#dcdcdc';

    const hex = `#${[r / counted, g / counted, b / counted]
      .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
      .join('')}`;

    return normalizeHex(hex) ?? '#e9e9e9';
  } catch {
    return '#e9e9e9';
  }
}

async function measureImage(blob: Blob): Promise<{ ratio: number; color: string }> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.min(image.naturalWidth, 400);
    canvas.height = Math.round((canvas.width / image.naturalWidth) * image.naturalHeight);
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);

    return {
      ratio: image.naturalWidth / image.naturalHeight,
      color: dominantColorFromCanvas(canvas),
    };
  } catch {
    return { ratio: 0.66, color: '#e9e9e9' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Exposed so the book form can preview the ink that will sit on a bloom. */
export { readableInk };

/* ═══════════════════════════════════════════════════════════════════
   Text helpers
   ═══════════════════════════════════════════════════════════════════ */

/** "the-brothers-karamazov (1).epub" → "The Brothers Karamazov" */
function fileNameToTitle(name: string): string {
  return (
    name
      .replace(/\.[a-z0-9]+$/i, '')
      // Drop the "(1)" a second download adds.
      .replace(/\s*\(\d+\)\s*$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\p{Ll}/gu, (c) => c.toUpperCase()) || 'Untitled'
  );
}

/** PDF and EPUB both cram multiple authors into one string, inconsistently. */
function splitAuthors(raw: string): string[] {
  return raw
    .split(/\s*(?:;|,|&| and )\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 1)
    .slice(0, 12);
}

function stripHtml(html: string): string {
  // Parsed rather than regexed, so entities decode and tags cannot slip
  // through. The document is inert — never attached, never scripted.
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  } catch {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}
