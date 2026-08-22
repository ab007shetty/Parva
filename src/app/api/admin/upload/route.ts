import { NextResponse } from 'next/server';
import { ID } from 'node-appwrite';

import { requireAdmin } from '@/lib/auth/session';
import { BUCKETS, LIMITS } from '@/lib/config';
import { ACCEPTED_BOOK_EXTENSIONS, ACCEPTED_COVER_EXTENSIONS } from '@/lib/config';

/**
 * Uploads a file to Appwrite storage on the browser's behalf.
 *
 * Why proxy at all, when the browser could talk to Appwrite directly?
 *
 * Because when Appwrite refuses a direct upload it answers 401 *without* CORS
 * headers, so the browser cannot read the body and reports a generic CORS
 * failure. The real reason is invisible — which makes the one thing an
 * administrator needs to work the one thing that cannot be debugged.
 *
 * Going through our own origin removes every moving part at once: no preflight,
 * no ambient Appwrite cookie competing with a JWT, no short-lived token to
 * expire mid-upload, and — most importantly — Appwrite's actual error message
 * reaches the person standing at the form.
 *
 * The tradeoff is the platform's request-body ceiling. Appwrite's storage sits
 * on S3 multipart, which rejects any non-final part under 5 MB, so a large file
 * cannot be split small enough to slip under a serverless body limit. Where that
 * bites, the client falls back to uploading directly (see lib/admin/upload.ts).
 */

/** S3 multipart will not accept a non-final part below this. */
const CHUNK_SIZE = 5 * 1024 * 1024;

export const runtime = 'nodejs';
/** A 30 MB book over a slow line needs more than the default. */
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 401) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
    if (status === 403) {
      return NextResponse.json({ error: 'Only administrators can upload.' }, { status: 403 });
    }
    console.error('[parva] upload auth check failed', error);
    return NextResponse.json({ error: 'Upload is unavailable right now.' }, { status: 500 });
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') === 'cover' ? 'cover' : 'book';
  const rawName = url.searchParams.get('name') ?? 'upload';

  // The filename reaches Appwrite, so strip anything path-like out of it.
  const name = rawName.replace(/[/\\]/g, '_').slice(0, 240) || 'upload';
  const extension = name.split('.').pop()?.toLowerCase() ?? '';

  const allowed: readonly string[] =
    kind === 'cover' ? ACCEPTED_COVER_EXTENSIONS : ACCEPTED_BOOK_EXTENSIONS;
  if (!allowed.includes(extension)) {
    return NextResponse.json(
      { error: `Only ${allowed.join(', ')} files are accepted here.` },
      { status: 400 },
    );
  }

  const bucketId = kind === 'cover' ? BUCKETS.covers : BUCKETS.books;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await request.arrayBuffer());
  } catch {
    // Almost always the platform refusing the body before it reaches us.
    return NextResponse.json(
      { error: 'too-large', detail: 'The request body was rejected before it arrived.' },
      { status: 413 },
    );
  }

  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: 'That file was empty.' }, { status: 400 });
  }

  const ceiling = kind === 'cover' ? LIMITS.coverFileBytes : LIMITS.bookFileBytes;
  if (bytes.byteLength > ceiling) {
    return NextResponse.json({ error: 'too-large' }, { status: 413 });
  }

  try {
    const file = await sendToAppwrite(bucketId, name, bytes);
    return NextResponse.json({
      fileId: file.$id,
      bytes: file.sizeOriginal ?? bytes.byteLength,
      name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The upload failed.';
    console.error('[parva] proxied upload failed', error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

type StoredFile = { $id: string; sizeOriginal?: number };

/**
 * Sends the bytes on to Appwrite with the API key, chunked when necessary.
 *
 * Uses the REST endpoint rather than the SDK because the SDK's chunked upload is
 * written against a browser `File`, and this is a Buffer on the server.
 */
async function sendToAppwrite(bucketId: string, name: string, bytes: Buffer): Promise<StoredFile> {
  const endpoint = (process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ?? '').replace(/\/$/, '');
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;

  if (!endpoint || !projectId || !apiKey) {
    throw new Error('Appwrite is not configured. Check .env — see SETUP.md.');
  }

  const url = `${endpoint}/storage/buckets/${bucketId}/files`;
  const fileId = ID.unique();
  const total = bytes.byteLength;

  const headers: Record<string, string> = {
    'X-Appwrite-Project': projectId,
    'X-Appwrite-Key': apiKey,
    'X-Appwrite-Response-Format': '1.9.0',
  };

  const post = async (part: Buffer, extra: Record<string, string>) => {
    const body = new FormData();
    body.append('fileId', fileId);
    body.append('file', new File([new Uint8Array(part)], name));

    const response = await fetch(url, { method: 'POST', headers: { ...headers, ...extra }, body });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(explain(response.status, payload));
    }
    return payload as StoredFile;
  };

  if (total <= CHUNK_SIZE) {
    return post(bytes, {});
  }

  let uploadId = '';
  let last: StoredFile | null = null;

  for (let start = 0; start < total; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, total);
    const extra: Record<string, string> = {
      'content-range': `bytes ${start}-${end - 1}/${total}`,
    };
    if (uploadId) extra['x-appwrite-id'] = uploadId;

    last = await post(bytes.subarray(start, end), extra);
    uploadId ||= last.$id;
  }

  if (!last) throw new Error('The upload produced no result.');
  return last;
}

/** Appwrite's storage errors, translated into something actionable. */
function explain(status: number, payload: unknown): string {
  const message =
    payload && typeof payload === 'object' && payload !== null && 'message' in payload
      ? String((payload as { message: unknown }).message)
      : '';

  if (status === 404) {
    return 'The storage bucket does not exist. Run `npm run setup` and try again.';
  }
  if (status === 401 || status === 403) {
    return 'Appwrite refused the API key. Check APPWRITE_API_KEY has the files.write scope.';
  }
  if (/EntityTooSmall/i.test(message)) {
    // Ours to get right, not the administrator's.
    return 'Upload chunking error — please report this.';
  }
  if (/extension/i.test(message)) {
    return 'Appwrite refused that file type. Re-run `npm run setup` to allow it.';
  }
  if (/size/i.test(message)) {
    return message;
  }
  return message || `Appwrite returned ${status}.`;
}
