import {
  getCachedFeaturedBook,
  getCachedPopularBooks,
  getCachedRecentBooks,
} from '@/lib/appwrite/catalogue-cache';
import { getSessionUser } from '@/lib/auth/session';
import { getContinueReading } from '@/lib/reader/continue-reading';
import { Shelf } from '@/components/books/shelf';
import { Hero } from '@/components/home/hero';
import { EmptyLibrary } from '@/components/home/empty-library';

// No `revalidate` here on purpose: this page reads the session cookie, which
// opts it out of prerendering entirely, so a route-level revalidate would be
// dead code. The caching that actually matters lives in catalogue-cache.ts,
// around the reads that are the same for everyone.

export default async function HomePage() {
  const user = await getSessionUser();

  // Independent reads, so they go in parallel rather than in sequence.
  // The first three are the same for every visitor and come from the shared
  // catalogue cache; only continue-reading is per-reader and uncached.
  const [featured, recent, popular, continuing] = await Promise.all([
    getCachedFeaturedBook(),
    getCachedRecentBooks(14),
    getCachedPopularBooks(14),
    getContinueReading(user),
  ]);

  if (!featured && !recent.length) {
    return <EmptyLibrary isAdmin={Boolean(user?.isAdmin)} />;
  }

  return (
    <>
      {featured && <Hero book={featured} />}

      {continuing.books.length > 0 && (
        <Shelf
          eyebrow={user ? `Welcome back, ${user.name.split(' ')[0]}` : undefined}
          title="Pick up where you stopped"
          books={continuing.books}
          progressByBookId={continuing.percentByBookId}
          size="md"
          moreHref="/me"
          moreLabel="Your shelf"
        />
      )}

      <Shelf
        eyebrow="Newest on the shelf"
        title="Recently added"
        books={recent}
        moreHref="/library?sort=recent"
      />

      {popular.length > 3 && (
        <Shelf eyebrow="What people are reading" title="Most opened" books={popular} moreHref="/library?sort=popular" />
      )}
    </>
  );
}
