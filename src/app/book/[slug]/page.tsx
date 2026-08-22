import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Download, Languages, Layers, ScrollText } from 'lucide-react';

import { getBookBySlug, getRelatedBooks } from '@/lib/appwrite/books';
import { getProgress, isFavorite } from '@/lib/appwrite/reader-data';
import { getSessionUser } from '@/lib/auth/session';
import { APP_NAME, SITE_URL, languageLabel } from '@/lib/config';
import { BookObject } from '@/components/books/book-object';
import { Shelf } from '@/components/books/shelf';
import { ButtonLink } from '@/components/ui/button';
import { BookActions } from '@/components/books/book-actions';
import { formatAuthors, formatBytes, formatDate, pluralize } from '@/lib/utils';

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const book = await getBookBySlug(slug);
  if (!book) return { title: 'Book not found' };

  // The fallback names the language explicitly — a real synopsis, when there
  // is one, already speaks for itself and is left alone.
  const language = book.language ? languageLabel(book.language) : null;
  const description =
    book.description?.slice(0, 180) ??
    `${book.title} by ${formatAuthors(book.authors)}${language ? ` — a ${language} book` : ''}, free to read on ${APP_NAME}.`;

  return {
    title: book.title,
    description,
    alternates: { canonical: `${SITE_URL}/book/${book.slug}` },
    openGraph: {
      title: book.title,
      description,
      type: 'book',
      url: `/book/${book.slug}`,
      images: book.coverId ? [{ url: `/api/cover/${book.coverId}?w=1200`, width: 1200 }] : undefined,
    },
  };
}

/**
 * schema.org/Book plus the breadcrumb this page already shows. This is what
 * lets a search engine answer "kannada books" with an understanding of what
 * language a specific title is in, rather than guessing from the word
 * "Kannada" appearing somewhere on the page — `inLanguage` says it directly,
 * in the vocabulary Google's own documentation names for exactly this.
 */
function bookJsonLd(book: NonNullable<Awaited<ReturnType<typeof getBookBySlug>>>) {
  const url = `${SITE_URL}/book/${book.slug}`;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Book',
        name: book.title,
        author: book.authors.map((name) => ({ '@type': 'Person', name })),
        url,
        image: book.coverId ? `${SITE_URL}/api/cover/${book.coverId}?w=1200` : undefined,
        inLanguage: book.language || undefined,
        // schema.org has one umbrella type for this; PDF vs EPUB is not a
        // distinction it draws.
        bookFormat: 'https://schema.org/EBook',
        isbn: book.isbn || undefined,
        numberOfPages: book.pageCount || undefined,
        publisher: book.publisher ? { '@type': 'Organization', name: book.publisher } : undefined,
        datePublished: book.publishedYear ? String(book.publishedYear) : undefined,
        description: book.description || undefined,
        isAccessibleForFree: true,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Library', item: `${SITE_URL}/library` },
          { '@type': 'ListItem', position: 2, name: book.title, item: url },
        ],
      },
    ],
  };
}

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const book = await getBookBySlug(slug);
  if (!book) notFound();

  const user = await getSessionUser();

  const [related, progress, favorite] = await Promise.all([
    getRelatedBooks(book),
    user ? getProgress(user.id, book.$id).catch(() => null) : Promise.resolve(null),
    user ? isFavorite(user.id, book.$id).catch(() => false) : Promise.resolve(false),
  ]);

  const started = progress && progress.percent > 0.5;
  const readHref = started ? `/read/${book.$id}?p=${progress.position}` : `/read/${book.$id}`;

  const facts = [
    book.publishedYear && { label: 'Published', value: String(book.publishedYear) },
    book.publisher && { label: 'Publisher', value: book.publisher },
    book.pageCount && { label: 'Length', value: pluralize(book.pageCount, 'page') },
    book.language && { label: 'Language', value: languageLabel(book.language) },
    { label: 'Format', value: book.format.toUpperCase() },
    book.fileSize && { label: 'File', value: formatBytes(book.fileSize) },
    book.isbn && { label: 'ISBN', value: book.isbn },
    { label: 'Added', value: formatDate(book.$createdAt) },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <article style={{ ['--bloom' as string]: book.coverColor ?? '#e9e9e9' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(bookJsonLd(book)) }}
      />

      <div className="px-[var(--page-gutter)] pt-12 sm:pt-16">
        <nav className="label flex items-center gap-2" aria-label="Breadcrumb">
          <Link href="/library" className="link-rule">
            Library
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-ink">{book.format.toUpperCase()}</span>
        </nav>

        <div className="shelf-rule mt-4" />

        <div className="mt-10 grid gap-12 lg:grid-cols-[auto_1fr] lg:gap-20">
          {/* The book, as an object. Same treatment as the shelf, larger. */}
          <div className="justify-self-start">
            <BookObject book={book} size="xl" showMeta={false} priority href={readHref} />
          </div>

          <div className="min-w-0 max-w-2xl">
            {book.series && (
              <p className="label mb-4">
                {book.series}
                {book.seriesIndex ? ` — Book ${book.seriesIndex}` : ''}
              </p>
            )}

            <h1 className="display text-[clamp(2.25rem,6vw,4.25rem)]">{book.title}</h1>
            {book.subtitle && (
              <p className="display mt-3 text-[clamp(1.125rem,2.5vw,1.625rem)] text-graphite">
                {book.subtitle}
              </p>
            )}

            <p className="mt-5 text-[0.9375rem] text-ink-soft">
              {(book.authors ?? []).length ? (
                (book.authors ?? []).map((author, i) => (
                  <span key={author}>
                    {i > 0 && <span className="text-mute"> · </span>}
                    <Link
                      href={`/library?author=${encodeURIComponent(author)}`}
                      className="link-rule"
                    >
                      {author}
                    </Link>
                  </span>
                ))
              ) : (
                <span className="text-graphite">Unknown author</span>
              )}
            </p>

            {started && (
              <p className="mt-6 flex items-center gap-2.5 text-[0.8125rem] text-graphite">
                <span className="inline-block h-[3px] w-24 bg-rule" aria-hidden="true">
                  <span
                    className="block h-full bg-ink"
                    style={{ width: `${Math.min(100, progress.percent)}%` }}
                  />
                </span>
                <span className="tnum">{Math.round(progress.percent)}% read</span>
                {progress.finished && <span className="label">Finished</span>}
              </p>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href={readHref} variant="ink" size="lg">
                {started ? 'Continue reading' : 'Start reading'}
                <ArrowRight className="size-4" strokeWidth={1.5} />
              </ButtonLink>

              <BookActions
                bookId={book.$id}
                slug={book.slug}
                title={book.title}
                isFavorite={favorite}
                signedIn={Boolean(user)}
                allowDownload={book.allowDownload}
                format={book.format}
              />
            </div>

            {book.description && (
              <div className="mt-12 border-t border-rule pt-8">
                <p className="label mb-4">About this book</p>
                {/* Descriptions are plain text from the admin form, so paragraphs
                    are split on blank lines rather than rendered as HTML. */}
                <div className="prose-read space-y-4">
                  {book.description
                    .split(/\n{2,}/)
                    .map((paragraph, i) => <p key={i}>{paragraph.trim()}</p>)}
                </div>
              </div>
            )}

            {(book.tags ?? []).length > 0 && (
              <div className="mt-10">
                <p className="label mb-3.5">Subjects</p>
                <ul className="flex flex-wrap gap-2">
                  {(book.tags ?? []).map((tag) => (
                    <li key={tag}>
                      <Link
                        href={`/library?tag=${encodeURIComponent(tag)}`}
                        className="inline-flex h-8 items-center border border-rule px-2.5 text-[0.75rem] text-graphite transition-colors hover:border-ink hover:text-ink"
                      >
                        {tag}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <dl className="mt-12 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-rule pt-8 sm:grid-cols-3">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt className="label mb-1.5">{fact.label}</dt>
                  <dd className="text-[0.875rem] text-ink">{fact.value}</dd>
                </div>
              ))}
            </dl>

            <ul className="mt-10 space-y-2.5 text-[0.8125rem] text-graphite">
              <li className="flex items-center gap-2.5">
                <ScrollText className="size-3.5 shrink-0" strokeWidth={1.5} />
                Opens in a full-screen reader — no account needed
              </li>
              <li className="flex items-center gap-2.5">
                <Layers className="size-3.5 shrink-0" strokeWidth={1.5} />
                Two-page spread, single page, or continuous scroll
              </li>
              {book.format === 'epub' && (
                <li className="flex items-center gap-2.5">
                  <Languages className="size-3.5 shrink-0" strokeWidth={1.5} />
                  Set your own typeface, size and spacing
                </li>
              )}
              {book.allowDownload && (
                <li className="flex items-center gap-2.5">
                  <Download className="size-3.5 shrink-0" strokeWidth={1.5} />
                  Available to download
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <Shelf
          eyebrow={book.series ? `More of ${book.series}` : 'You might also open'}
          title={book.series ? 'In this series' : 'Related books'}
          books={related}
        />
      )}
    </article>
  );
}
