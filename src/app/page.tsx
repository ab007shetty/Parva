import { getFeaturedBook, getPopularBooks, getRecentBooks } from '@/lib/appwrite/books';
import { getSessionUser } from '@/lib/auth/session';
import { getContinueReading } from '@/lib/reader/continue-reading';
import { Shelf } from '@/components/books/shelf';
import { Hero } from '@/components/home/hero';
import { EmptyLibrary } from '@/components/home/empty-library';

// The catalogue changes when an admin publishes, not on a timer. Revalidating
// every few minutes keeps the shelf fresh without a request per visitor, and
// the admin routes revalidate this path directly on publish.
export const revalidate = 300;

export default async function HomePage() {
  const user = await getSessionUser();

  // Independent reads, so they go in parallel rather than in sequence.
  const [featured, recent, popular, continuing] = await Promise.all([
    getFeaturedBook(),
    getRecentBooks(14),
    getPopularBooks(14),
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
