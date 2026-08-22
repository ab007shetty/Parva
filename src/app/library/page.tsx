import type { Metadata } from 'next';

import { browseBooks, getFacets } from '@/lib/appwrite/books';
import { getContinueReading } from '@/lib/reader/continue-reading';
import { getSessionUser } from '@/lib/auth/session';
import { LIMITS, SITE_URL, SORTS, languageLabel } from '@/lib/config';
import { BookGrid } from '@/components/books/book-grid';
import { BrowseFilters } from '@/components/books/browse-filters';
import { Pager } from '@/components/books/pager';
import { pluralize } from '@/lib/utils';
import type { BookFormat, BrowseParams } from '@/types';

export const revalidate = 300;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** One value only — a repeated query param is a mistake, not a multi-select. */
function one(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}

async function readParams(searchParams: SearchParams): Promise<BrowseParams> {
  const raw = await searchParams;
  const sortParam = one(raw.sort);
  const formatParam = one(raw.format);

  return {
    q: one(raw.q),
    author: one(raw.author),
    tag: one(raw.tag),
    language: one(raw.language),
    format: formatParam === 'pdf' || formatParam === 'epub' ? (formatParam as BookFormat) : undefined,
    year: Number(one(raw.year)) || undefined,
    // Ignore an unknown sort rather than passing it through to a query.
    sort: SORTS.some((s) => s.key === sortParam) ? sortParam : 'recent',
    page: Math.max(1, Number(one(raw.page)) || 1),
    pageSize: LIMITS.pageSize,
  };
}

/**
 * The heading a filter deserves, shared between the <title> tag and the h1 so
 * the two always agree — a page that tells Google "Kannada books" and tells
 * the person who lands on it "The library" is the kind of mismatch search
 * engines call thin content, and it reads as a bait-and-switch either way.
 */
function heading(params: BrowseParams): string {
  if (params.q) return `“${params.q}”`;
  if (params.author) return params.author;
  if (params.language) return `${languageLabel(params.language) ?? params.language} books`;
  if (params.tag) return params.tag;
  return 'The library';
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const params = await readParams(searchParams);

  // Internal search results and pages past the first are exactly the thin,
  // duplicate content Google's own quality guidelines ask sites not to index
  // — the useful destination is the search box or page one, not a cached copy
  // of page four's URL.
  const noindex = Boolean(params.q) || (params.page ?? 1) > 1;

  if (params.language) {
    const label = languageLabel(params.language) ?? params.language;
    const url = `${SITE_URL}/library?language=${encodeURIComponent(params.language)}`;
    return {
      title: `Free ${label} Books to Read Online`,
      description: `Read ${label} books online for free — no sign-up needed. Browse the collection and open any book straight into a full-screen, two-page reader.`,
      alternates: { canonical: url },
      openGraph: { url, title: `Free ${label} Books to Read Online` },
      robots: { index: !noindex, follow: true },
    };
  }

  if (params.author) {
    return {
      title: `${params.author} — Books to Read Online`,
      description: `Read books by ${params.author} online for free, no account needed.`,
      alternates: { canonical: `${SITE_URL}/library` },
      robots: { index: !noindex, follow: true },
    };
  }

  if (params.tag) {
    return {
      title: `${params.tag} Books — Read Online`,
      description: `${params.tag} books on the shelf, free to read online with no account needed.`,
      alternates: { canonical: `${SITE_URL}/library` },
      robots: { index: !noindex, follow: true },
    };
  }

  return {
    title: 'Browse Every Book — Free to Read Online',
    description:
      'Every book on the shelf, free to read online — filter by author, language, subject and format. No account needed.',
    alternates: { canonical: `${SITE_URL}/library` },
    robots: { index: !noindex, follow: true },
  };
}

export default async function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await readParams(searchParams);

  const user = await getSessionUser();

  const [result, facets, continuing] = await Promise.all([
    browseBooks(params),
    getFacets(),
    getContinueReading(user, 40),
  ]);

  return (
    <div className="px-[var(--page-gutter)] pt-12 pb-6 sm:pt-16">
      <header>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h1 className="display text-[clamp(2.25rem,6vw,4rem)]">{heading(params)}</h1>
          <p className="pb-2 text-[0.8125rem] text-graphite tnum">
            {pluralize(result.total, 'book')}
          </p>
        </div>
      </header>

      <BrowseFilters facets={facets} active={params} />

      <div className="mt-10">
        {result.items.length ? (
          <>
            <BookGrid books={result.items} progressByBookId={continuing.percentByBookId} />
            <Pager page={result.page} pageSize={result.pageSize} total={result.total} />
          </>
        ) : (
          <div className="border-t border-rule py-20 text-center">
            <p className="display text-[1.5rem]">Nothing matches those filters</p>
            <p className="mt-3 text-[0.875rem] text-graphite">
              {params.q
                ? 'Try a shorter search, or clear the filters to see the whole shelf.'
                : 'Clear a filter or two to widen the search.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
