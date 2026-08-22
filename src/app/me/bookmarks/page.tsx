import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth/session';
import { getBooksByIds } from '@/lib/appwrite/books';
import { listBookmarks, listHighlights } from '@/lib/appwrite/reader-data';
import { CoverThumb } from '@/components/books/cover-thumb';
import { formatRelative, pluralize } from '@/lib/utils';

export const metadata: Metadata = { title: 'Bookmarks', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Bookmarks and highlights across every book, grouped by book.
 *
 * Grouping is the point: a flat list of two hundred marks is a database dump,
 * not a reading record. Under each book they read as a trail through it.
 */
export default async function BookmarksPage() {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in?next=/me/bookmarks');

  const [bookmarks, highlights] = await Promise.all([
    listBookmarks(user.id).catch(() => []),
    listHighlights(user.id).catch(() => []),
  ]);

  const bookIds = [...new Set([...bookmarks, ...highlights].map((row) => row.bookId))];
  const books = await getBooksByIds(bookIds);

  const groups = books
    .map((book) => ({
      book,
      marks: bookmarks.filter((row) => row.bookId === book.$id),
      notes: highlights.filter((row) => row.bookId === book.$id),
    }))
    .filter((group) => group.marks.length || group.notes.length);

  return (
    <div className="px-[var(--page-gutter)] pt-12 pb-6 sm:pt-16">
      <h1 className="display text-[clamp(2.25rem,6vw,4rem)]">Bookmarks &amp; highlights</h1>

      {groups.length ? (
        <div className="mt-14 space-y-16">
          {groups.map(({ book, marks, notes }) => (
            <section key={book.$id}>
              <div className="flex items-center justify-between gap-4 border-b border-rule pb-3">
                <div className="flex min-w-0 items-center gap-3.5">
                  <CoverThumb
                    coverId={book.coverId}
                    coverColor={book.coverColor}
                    title={book.title}
                    width={32}
                    className="h-11 w-8"
                  />
                  <h2 className="display truncate text-[1.375rem]">
                    <Link href={`/book/${book.slug}`} className="link-rule">
                      {book.title}
                    </Link>
                  </h2>
                </div>
                <p className="shrink-0 text-[0.6875rem] text-mute">
                  {marks.length > 0 && pluralize(marks.length, 'bookmark')}
                  {marks.length > 0 && notes.length > 0 && ' · '}
                  {notes.length > 0 && pluralize(notes.length, 'highlight')}
                </p>
              </div>

              <ul className="mt-5 space-y-4">
                {marks.map((mark) => (
                  <li key={mark.$id}>
                    <Link
                      href={`/read/${book.$id}?p=${encodeURIComponent(mark.position)}`}
                      className="group flex min-w-0 gap-4"
                    >
                      <span className="label shrink-0 pt-0.5">
                        {mark.page ? `p ${mark.page}` : `${Math.round(mark.percent)}%`}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.875rem] leading-relaxed text-ink-soft group-hover:text-ink">
                          {mark.label || 'Bookmarked spot'}
                        </span>
                        <span className="mt-0.5 block text-[0.6875rem] text-mute">
                          {formatRelative(mark.$createdAt)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}

                {notes.map((note) => (
                  <li key={note.$id}>
                    <Link
                      href={`/read/${book.$id}?p=${encodeURIComponent(note.position)}`}
                      className="group flex min-w-0 gap-4"
                    >
                      <span className="label shrink-0 pt-0.5">
                        {note.page ? `p ${note.page}` : `${Math.round(note.percent)}%`}
                      </span>
                      <span className="min-w-0 flex-1 border-l-2 border-marker-deep pl-3">
                        <span className="block text-[0.875rem] leading-relaxed text-ink-soft group-hover:text-ink">
                          {note.text}
                        </span>
                        {note.note && (
                          <span className="mt-1 block text-[0.75rem] text-graphite italic">{note.note}</span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="mt-12 border-t border-rule py-20">
          <p className="display text-[1.5rem]">Nothing marked yet</p>
          <p className="prose-read mt-3 max-w-md">
            Press <kbd className="border border-rule px-1.5 py-0.5 font-mono text-[0.75rem]">B</kbd> while
            reading to drop a bookmark, or select a passage to highlight it.
          </p>
          <Link href="/library" className="link-rule mt-6 inline-block text-[0.875rem] text-ink">
            Find something to read
          </Link>
        </div>
      )}
    </div>
  );
}
