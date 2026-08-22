import 'server-only';

import { getBooksByIds } from '@/lib/appwrite/books';
import { listContinueReading } from '@/lib/appwrite/reader-data';
import type { Book, SessionUser } from '@/types';

/**
 * The "pick up where you stopped" shelf.
 *
 * Progress rows carry the ordering (most recently touched first) and books
 * carry everything else, so this joins the two and drops any book that has
 * since been unpublished — a reader should not be offered a book that would
 * 404 when they click it.
 */
export async function getContinueReading(
  user: SessionUser | null,
  limit = 12,
): Promise<{ books: Book[]; percentByBookId: Record<string, number> }> {
  if (!user) return { books: [], percentByBookId: {} };

  try {
    const progress = await listContinueReading(user.id, limit);
    if (!progress.length) return { books: [], percentByBookId: {} };

    // getBooksByIds preserves the order it is given, which is the recency
    // order we want.
    const books = await getBooksByIds(progress.map((p) => p.bookId));

    const percentByBookId: Record<string, number> = {};
    for (const row of progress) percentByBookId[row.bookId] = row.percent;

    return { books, percentByBookId };
  } catch (error) {
    // A failure here should cost the reader a shelf, not the whole home page.
    console.error('[parva] could not build continue-reading shelf', error);
    return { books: [], percentByBookId: {} };
  }
}
