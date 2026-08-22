import 'server-only';

import { Tokens } from 'node-appwrite';

import { BUCKETS } from '@/lib/config';
import { createAdminClient } from '@/lib/appwrite/server';

/**
 * Book files live in a private bucket, but the reader must stream them from the
 * browser: pdf.js issues HTTP Range requests so a 200 MB scan renders its first
 * page immediately instead of after a full download.
 *
 * Piping that through a route handler would mean paying for the bandwidth twice
 * and losing Range support. Instead the server mints a short-lived Appwrite
 * *file token* and hands back a direct URL. The bucket stays private, the URL
 * expires, and Appwrite serves the bytes with Range intact.
 */

const endpoint = () => (process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ?? '').replace(/\/$/, '');
const projectId = () => process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID ?? '';

/** Long enough to finish a reading session, short enough that a leaked URL
 *  stops working the same day. */
const TOKEN_TTL_MINUTES = 240;

export type SignedFile = {
  url: string;
  expiresAt: string;
  /** True when the browser will fetch straight from Appwrite; false when the
   *  bytes are relayed through /api/book-stream. */
  direct: boolean;
};

/**
 * True when Appwrite refused a call because the API key lacks a scope.
 *
 * Worth distinguishing from any other 401: a missing scope is a configuration
 * gap with a working alternative, not a failure to report to a reader.
 */
function isMissingScope(error: unknown, scope: string): boolean {
  const e = error as { code?: number; type?: string; message?: string } | null;
  if (!e) return false;
  return (
    e.type === 'general_unauthorized_scope' ||
    (e.code === 401 && typeof e.message === 'string' && e.message.includes(scope))
  );
}

/**
 * Remembers that this key cannot mint tokens, so the doomed call is made once
 * per process rather than once per book opened.
 */
let fileTokensAllowed: boolean | null = null;

/** Relayed through our own origin — see api/book-stream/[id]. */
function relayed(bookId: string, download = false): SignedFile {
  return {
    url: `/api/book-stream/${bookId}${download ? '?download=1' : ''}`,
    // Our own route does not expire; the book's published state governs access.
    expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000).toISOString(),
    direct: false,
  };
}

/**
 * A URL the browser can read the book from.
 *
 * Prefers a short-lived Appwrite file token, which costs us no bandwidth at
 * all. Falls back to relaying through our own origin when the API key lacks
 * `tokens.write` — same bytes, same Range behaviour, just routed through us.
 * Adding that scope in the Appwrite console is the cheaper arrangement, and the
 * app picks it up with no code change.
 */
export async function signBookFile(bookId: string, fileId: string): Promise<SignedFile> {
  if (fileTokensAllowed === false) return relayed(bookId);

  try {
    const { client } = createAdminClient();
    const tokens = new Tokens(client);

    const expire = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000).toISOString();
    const token = await tokens.createFileToken({
      bucketId: BUCKETS.books,
      fileId,
      expire,
    });

    const url = new URL(`${endpoint()}/storage/buckets/${BUCKETS.books}/files/${fileId}/view`);
    url.searchParams.set('project', projectId());
    url.searchParams.set('token', token.secret);

    fileTokensAllowed = true;
    return { url: url.toString(), expiresAt: token.expire, direct: true };
  } catch (error) {
    if (!isMissingScope(error, 'tokens.write')) throw error;

    fileTokensAllowed = false;
    console.info(
      '[parva] The Appwrite API key has no tokens.write scope, so books are being relayed through /api/book-stream. Adding that scope lets readers stream straight from Appwrite instead — see SETUP.md.',
    );
    return relayed(bookId);
  }
}

/** Same file, but flagged so the browser saves it rather than opening it. */
export async function signBookDownload(
  bookId: string,
  fileId: string,
  filename?: string | null,
): Promise<SignedFile> {
  if (fileTokensAllowed === false) return relayed(bookId, true);

  try {
    const { client } = createAdminClient();
    const tokens = new Tokens(client);

    const expire = new Date(Date.now() + 15 * 60_000).toISOString();
    const token = await tokens.createFileToken({
      bucketId: BUCKETS.books,
      fileId,
      expire,
    });

    const url = new URL(`${endpoint()}/storage/buckets/${BUCKETS.books}/files/${fileId}/download`);
    url.searchParams.set('project', projectId());
    url.searchParams.set('token', token.secret);
    if (filename) url.searchParams.set('response-filename', filename);

    fileTokensAllowed = true;
    return { url: url.toString(), expiresAt: token.expire, direct: true };
  } catch (error) {
    if (!isMissingScope(error, 'tokens.write')) throw error;
    fileTokensAllowed = false;
    return relayed(bookId, true);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Covers

   Covers sit in a private bucket — the same one as the books, on plans that
   allow only one — so they cannot be linked to directly. They are fetched
   server-side with the API key and proxied by /api/cover/[id], which means the
   key stays on the server and the browser caches covers on our own origin.
   ═══════════════════════════════════════════════════════════════════ */

/** The upstream request for a cover, ready to hand to `fetch`. */
export type UpstreamRequest = { url: string; headers: Record<string, string> };

function serverHeaders(): Record<string, string> {
  const key = process.env.APPWRITE_API_KEY;
  if (!key) throw new Error('Missing APPWRITE_API_KEY. Set it in .env — see SETUP.md.');
  return {
    'X-Appwrite-Project': projectId(),
    'X-Appwrite-Key': key,
  };
}

/**
 * A resized, re-encoded cover. Appwrite does the work, so asking for exactly the
 * width we paint is the single biggest win on a page full of covers.
 */
export function coverPreviewRequest(
  coverId: string,
  options: {
    width?: number;
    height?: number;
    quality?: number;
    output?: 'webp' | 'jpg' | 'png' | 'avif';
  } = {},
): UpstreamRequest {
  const url = new URL(`${endpoint()}/storage/buckets/${BUCKETS.covers}/files/${coverId}/preview`);
  if (options.width) url.searchParams.set('width', String(Math.round(options.width)));
  if (options.height) url.searchParams.set('height', String(Math.round(options.height)));
  url.searchParams.set('quality', String(options.quality ?? 82));
  url.searchParams.set('output', options.output ?? 'webp');

  return { url: url.toString(), headers: { ...serverHeaders(), accept: 'image/webp,image/*' } };
}

/** The original bytes, untransformed. Used when a preview is refused — an SVG or
 *  a file type Appwrite will not resize. */
export function coverOriginalRequest(coverId: string): UpstreamRequest {
  const url = new URL(`${endpoint()}/storage/buckets/${BUCKETS.covers}/files/${coverId}/view`);
  return { url: url.toString(), headers: { ...serverHeaders(), accept: 'image/*' } };
}

/* ═══════════════════════════════════════════════════════════════════
   Upload credentials

   A 200 MB book cannot be posted through a Next.js route handler — serverless
   request bodies are capped far below that. So the browser uploads straight to
   Appwrite using a short-lived JWT that impersonates the signed-in admin, and
   Appwrite's own 5 MB chunking handles the size and the progress events.
   ═══════════════════════════════════════════════════════════════════ */

export async function createUploadJwt(userId: string): Promise<{ jwt: string; expiresInSeconds: number }> {
  const { users } = createAdminClient();
  // Appwrite caps JWT duration at 3600s. Fifteen minutes is enough for a large
  // upload on a slow line without leaving a long-lived credential around.
  const duration = 900;
  const token = await users.createJWT({ userId, duration });
  return { jwt: token.jwt, expiresInSeconds: duration };
}

/** Deletes a stored file, ignoring "already gone". Used when an upload is
 *  abandoned or a book is removed. */
export async function deleteStoredFile(bucketId: string, fileId: string): Promise<void> {
  const { storage } = createAdminClient();
  try {
    await storage.deleteFile({ bucketId, fileId });
  } catch (error) {
    const code = (error as { code?: number } | null)?.code;
    if (code !== 404) throw error;
  }
}
