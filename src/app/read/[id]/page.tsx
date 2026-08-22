import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { getPublishedBook, bumpReadCount } from '@/lib/appwrite/books';
import { signBookFile } from '@/lib/appwrite/files';
import { getSessionUser } from '@/lib/auth/session';
import { getProgress, isFavorite, listBookmarks, listHighlights } from '@/lib/appwrite/reader-data';
import { ReaderShell } from '@/components/reader/reader-shell';
import type { BookmarkRow, HighlightRow } from '@/types';

/** The signed file URL expires, so this page can never be cached. */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const book = await getPublishedBook(id);
  if (!book) return { title: 'Book not found' };

  return {
    title: `Reading ${book.title}`,
    // A reading session is not a page anyone should land on from search.
    robots: { index: false, follow: false },
  };
}

export default async function ReadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const book = await getPublishedBook(id);
  if (!book) notFound();

  const user = await getSessionUser();

  // The file URL is signed here, on the server, so the private bucket is never
  // exposed and the link dies on its own.
  const signed = await signBookFile(book.$id, book.fileId);

  // A signed-out reader still gets the book — their place comes from
  // localStorage in the client instead.
  let savedPosition: { locator: string; page: number; percent: number } | null = null;
  let bookmarks: BookmarkRow[] = [];
  let highlights: HighlightRow[] = [];
  let favorite = false;

  if (user) {
    // Independent reads; one slow query should not delay the others.
    const [progress, marks, notes, fav] = await Promise.all([
      getProgress(user.id, book.$id).catch(() => null),
      listBookmarks(user.id, book.$id).catch(() => []),
      listHighlights(user.id, book.$id).catch(() => []),
      isFavorite(user.id, book.$id).catch(() => false),
    ]);

    if (progress) {
      savedPosition = {
        locator: progress.position,
        page: progress.page ?? 1,
        percent: progress.percent,
      };
    }
    bookmarks = marks;
    highlights = notes;
    favorite = fav;
  }

  // Counting an open is a side effect nobody should wait for.
  void bumpReadCount(book.$id);

  return (
    <ReaderShell
      book={book}
      user={user}
      fileUrl={signed.url}
      savedPosition={savedPosition}
      bookmarks={bookmarks}
      highlights={highlights}
      isFavorite={favorite}
    />
  );
}
