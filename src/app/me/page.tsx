import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth/session';
import { getBooksByIds } from '@/lib/appwrite/books';
import {
  computeStreak,
  listAllProgress,
  listFavorites,
  listFinished,
  listReadingDays,
} from '@/lib/appwrite/reader-data';
import { Shelf } from '@/components/books/shelf';
import { ReadingStats } from '@/components/me/reading-stats';

export const metadata: Metadata = {
  title: 'Your shelf',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function MyShelfPage() {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in?next=/me');

  // Each of these can fail independently without taking the page down — a
  // stats query timing out should not cost someone their reading list.
  const [progress, finished, favorites, days] = await Promise.all([
    listAllProgress(user.id).catch(() => []),
    listFinished(user.id).catch(() => []),
    listFavorites(user.id).catch(() => []),
    listReadingDays(user.id).catch(() => []),
  ]);

  const reading = progress.filter((row) => !row.finished && row.percent > 0);

  const [readingBooks, finishedBooks, favoriteBooks] = await Promise.all([
    getBooksByIds(reading.map((row) => row.bookId)),
    getBooksByIds(finished.map((row) => row.bookId)),
    getBooksByIds(favorites.map((row) => row.bookId)),
  ]);

  const percentByBookId: Record<string, number> = {};
  for (const row of progress) percentByBookId[row.bookId] = row.percent;

  const totalSeconds = progress.reduce((sum, row) => sum + (row.secondsRead ?? 0), 0);
  const streak = computeStreak(days);

  const empty = !readingBooks.length && !finishedBooks.length && !favoriteBooks.length;

  return (
    <div>
      <header className="px-[var(--page-gutter)] pt-12 sm:pt-16">
        <h1 className="display text-[clamp(2.25rem,6vw,4rem)]">Your shelf</h1>
        <p className="mt-3 text-[0.875rem] text-graphite">{user.name}</p>
      </header>

      {!empty && (
        <div className="mt-10 px-[var(--page-gutter)]">
          <ReadingStats
            booksStarted={progress.length}
            booksFinished={finished.length}
            totalSeconds={totalSeconds}
            streak={streak}
            days={days}
          />
        </div>
      )}

      {empty ? (
        <div className="px-[var(--page-gutter)] py-20">
          <p className="display text-[1.75rem]">Nothing here yet</p>
          <p className="prose-read mt-4 max-w-md">
            Open any book and this shelf starts filling itself in — where you stopped, what
            you marked, what you meant to finish.
          </p>
          <Link href="/library" className="link-rule mt-6 inline-block text-[0.875rem] text-ink">
            Browse the library
          </Link>
        </div>
      ) : (
        <>
          <Shelf
            eyebrow="In progress"
            title="Pick up where you stopped"
            books={readingBooks}
            progressByBookId={percentByBookId}
            emptyMessage="Nothing in progress. Open a book and it appears here."
          />

          {favoriteBooks.length > 0 && (
            <Shelf
              eyebrow="Kept"
              title="Favourites"
              books={favoriteBooks}
              moreHref="/me/favorites"
              progressByBookId={percentByBookId}
            />
          )}

          {finishedBooks.length > 0 && (
            <Shelf eyebrow="Read through" title="Finished" books={finishedBooks} size="sm" />
          )}
        </>
      )}
    </div>
  );
}
