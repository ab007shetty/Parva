import { NextResponse } from 'next/server';

import { LIMITS as RATE, rateLimitGuard } from '@/lib/rate-limit';

import { getPublishedBook } from '@/lib/appwrite/books';
import { signBookDownload, signBookFile } from '@/lib/appwrite/files';

/**
 * Hands out a short-lived, signed URL for a book file.
 *
 * The reader gets the URL rather than the bytes on purpose. Streaming a 200 MB
 * scan through a serverless function would mean paying for the bandwidth twice
 * and — worse — losing HTTP Range support, which is exactly what lets pdf.js
 * render page one before the rest of the file has arrived.
 *
 * Access control happens here: only published books get a URL, and the URL
 * expires on its own.
 *
 * `?download=1` returns a download-flavoured link instead, and only if the
 * administrator allowed downloads for that book.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimitGuard('book-file', request, RATE.bookFile);
  if (limited) return limited;

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

  try {
    const signed = wantsDownload
      ? await signBookDownload(
          book.$id,
          book.fileId,
          book.fileName ?? `${book.slug}.${book.format}`,
        )
      : await signBookFile(book.$id, book.fileId);

    return NextResponse.json(
      {
        url: signed.url,
        expiresAt: signed.expiresAt,
        format: book.format,
        bytes: book.fileSize,
      },
      // A signed URL must never be cached by a shared cache — it is a
      // credential with an expiry.
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('[parva] could not sign book file', error);
    return NextResponse.json({ error: 'That file could not be opened.' }, { status: 500 });
  }
}
