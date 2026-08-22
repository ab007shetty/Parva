import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth/session';
import { getBooksByIds } from '@/lib/appwrite/books';
import { listAllProgress, listFavorites } from '@/lib/appwrite/reader-data';
import { BookGrid } from '@/components/books/book-grid';
import { pluralize } from '@/lib/utils';

export const metadata: Metadata = { title: 'Favourites', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function FavoritesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in?next=/me/favorites');

  const [favorites, progress] = await Promise.all([
    listFavorites(user.id).catch(() => []),
    listAllProgress(user.id).catch(() => []),
  ]);

  const books = await getBooksByIds(favorites.map((row) => row.bookId));

  const percentByBookId: Record<string, number> = {};
  for (const row of progress) percentByBookId[row.bookId] = row.percent;

  return (
    <div className="px-[var(--page-gutter)] pt-12 pb-6 sm:pt-16">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <h1 className="display text-[clamp(2.25rem,6vw,4rem)]">Favourites</h1>
        {books.length > 0 && (
          <p className="pb-2 text-[0.8125rem] text-graphite tnum">{pluralize(books.length, 'book')}</p>
        )}
      </div>

      <div className="mt-10">
        {books.length ? (
          <BookGrid books={books} progressByBookId={percentByBookId} />
        ) : (
          <div className="border-t border-rule py-20">
            <p className="display text-[1.5rem]">No favourites yet</p>
            <p className="prose-read mt-3 max-w-md">
              The heart on any book keeps it here. Nothing else about the book changes — it
              just becomes easy to find again.
            </p>
            <Link href="/library" className="link-rule mt-6 inline-block text-[0.875rem] text-ink">
              Browse the library
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
