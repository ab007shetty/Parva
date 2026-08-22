import { NextResponse } from 'next/server';

import { getPublishedBook } from '@/lib/appwrite/books';
import { BUCKETS } from '@/lib/config';

/**
 * Streams a book's bytes through our own origin.
 *
 * The preferred path is a short-lived Appwrite *file token*, which lets the
 * browser fetch straight from Appwrite and costs us no bandwidth at all. That
 * needs the `tokens.write` scope on the API key, and a key without it fails at
 * the worst moment — when a reader clicks Start reading. This route is the
 * fallback: same bytes, same Range semantics, fetched with the API key and
 * relayed.
 *
 * Range is the whole point. pdf.js asks for small byte ranges so page one of a
 * 200 MB scan renders before the rest of the file has arrived, and Appwrite
 * answers those with a proper 206, so this relays the range headers in both
 * directions rather than buffering the file.
 *
 * Access control lives here, not in the URL: the route takes a *book* id and
 * refuses anything that is not published, so a bare storage file id cannot be
 * guessed into a download.
 */

export const runtime = 'nodejs';
/** A slow line reading a large book needs more than the default. */
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wantsDownload = new URL(request.url).searchParams.get('download') === '1';

  const book = await getPublishedBook(id);
  if (!book) {
    return NextResponse.json({ error: 'That book is not available.' }, { status: 404 });
  }

  if (wantsDownload && !book.allowDownload) {
    return NextResponse.json(
      { error: 'This book is read-only. The librarian has not enabled downloads for it.' },
      { status: 403 },
    );
  }

  const endpoint = (process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ?? '').replace(/\/$/, '');
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;

  if (!endpoint || !projectId || !apiKey) {
    return NextResponse.json({ error: 'Appwrite is not configured.' }, { status: 500 });
  }

  const target = new URL(
    `${endpoint}/storage/buckets/${BUCKETS.books}/files/${book.fileId}/${
      wantsDownload ? 'download' : 'view'
    }`,
  );
  if (wantsDownload) {
    target.searchParams.set(
      'response-filename',
      book.fileName ?? `${book.slug}.${book.format}`,
    );
  }

  const headers: Record<string, string> = {
    'X-Appwrite-Project': projectId,
    'X-Appwrite-Key': apiKey,
  };

  // Pass the reader's range through untouched — this is what keeps large books
  // opening on the first page rather than the last byte.
  const range = request.headers.get('range');
  if (range) headers.Range = range;

  try {
    const upstream = await fetch(target.toString(), { headers, cache: 'no-store' });

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        { error: 'That file could not be read from storage.' },
        { status: upstream.status === 404 ? 404 : 502 },
      );
    }
    if (!upstream.body) {
      return NextResponse.json({ error: 'Storage returned no content.' }, { status: 502 });
    }

    const out = new Headers();
    // Relay exactly what a range-aware client needs to keep asking for more.
    for (const header of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified',
    ]) {
      const value = upstream.headers.get(header);
      if (value) out.set(header, value);
    }

    // Appwrite does not always advertise it, but it does honour ranges — saying
    // so lets pdf.js choose partial loading instead of pulling the whole file.
    if (!out.has('accept-ranges')) out.set('accept-ranges', 'bytes');
    if (!out.has('content-type')) {
      out.set(
        'content-type',
        book.format === 'epub' ? 'application/epub+zip' : 'application/pdf',
      );
    }
    if (wantsDownload) {
      out.set(
        'content-disposition',
        `attachment; filename="${(book.fileName ?? `${book.slug}.${book.format}`).replace(/"/g, '')}"`,
      );
    }
    // A published book's bytes never change — the admin form cannot swap a file,
    // only replace the whole book — so ranges can be cached hard.
    out.set('cache-control', 'public, max-age=86400, immutable');

    // The body is piped rather than buffered, so a 200 MB book never lands in
    // this function's memory.
    return new NextResponse(upstream.body, { status: upstream.status, headers: out });
  } catch (error) {
    console.error('[parva] book stream failed', error);
    return NextResponse.json({ error: 'That book could not be opened.' }, { status: 502 });
  }
}
