import 'server-only';

import { Query } from 'node-appwrite';

import { DB_ID, LIMITS, TABLES, type SortKey } from '@/lib/config';
import { createAdminClient, isNotFound, toPlainObject, withRetry } from '@/lib/appwrite/server';
import { clamp, sortFacet } from '@/lib/utils';
import type { Book, BookRow, BrowseParams, Facets, Paginated } from '@/types';

/**
 * The catalogue.
 *
 * Reads use the admin client because the books table has no per-user rows and
 * reading requires no account — but every public read is filtered to
 * `status = 'published'` here, in one place, so an unpublished draft can never
 * leak through a route that forgot to filter.
 */

const PUBLISHED = () => Query.equal('status', 'published');

function sortQueries(sort: SortKey | undefined): string[] {
  switch (sort) {
    case 'title':
      return [Query.orderAsc('title')];
    case 'author':
      // `authors` is an array column; Appwrite orders on the first element,
      // which is the primary author — the useful behaviour here.
      return [Query.orderAsc('authors'), Query.orderAsc('title')];
    case 'year':
      return [Query.orderDesc('publishedYear'), Query.orderDesc('$createdAt')];
    case 'popular':
      return [Query.orderDesc('readCount'), Query.orderDesc('$createdAt')];
    case 'recent':
    default:
      return [Query.orderDesc('$createdAt')];
  }
}

/**
 * Strips no fields today — BookRow and Book are the same shape — but every row
 * that reaches the browser passes through here, so adding a private column
 * later is a one-line change rather than an audit.
 *
 * It also does real work: `toPlainObject` rebuilds the row without the
 * null prototype node-appwrite's parser gives it, which is what lets this
 * value be handed to a Client Component at all. See toPlainObject's own
 * comment for why that is necessary.
 */
export function toPublicBook(row: BookRow): Book {
  return toPlainObject(row);
}

/* ═══════════════════════════════════════════════════════════════════
   Reads
   ═══════════════════════════════════════════════════════════════════ */

export async function browseBooks(params: BrowseParams = {}): Promise<Paginated<Book>> {
  const { tables } = createAdminClient();

  const pageSize = clamp(params.pageSize ?? LIMITS.pageSize, 1, LIMITS.maxPageSize);
  const page = Math.max(1, params.page ?? 1);

  const queries: string[] = [PUBLISHED()];

  if (params.q?.trim()) {
    const term = params.q.trim();
    // `title` carries a fulltext index; searching it is the cheap path. Author
    // and tag matches are handled by the facet filters and by the client-side
    // pass in the command palette, which already has the collection loaded.
    queries.push(Query.search('title', term));
  }
  if (params.author) queries.push(Query.contains('authors', params.author));
  if (params.tag) queries.push(Query.contains('tags', params.tag));
  if (params.language) queries.push(Query.equal('language', params.language));
  if (params.format) queries.push(Query.equal('format', params.format));
  if (params.year) queries.push(Query.equal('publishedYear', params.year));

  queries.push(...sortQueries(params.sort as SortKey | undefined));
  queries.push(Query.limit(pageSize), Query.offset((page - 1) * pageSize));

  const result = await withRetry(() =>
    tables.listRows<BookRow>({
      databaseId: DB_ID,
      tableId: TABLES.books,
      queries,
      total: true,
    }),
  );

  return {
    items: result.rows.map(toPublicBook),
    total: result.total,
    page,
    pageSize,
    hasMore: page * pageSize < result.total,
  };
}

export async function getBookBySlug(slug: string): Promise<Book | null> {
  const { tables } = createAdminClient();
  const result = await withRetry(() =>
    tables.listRows<BookRow>({
      databaseId: DB_ID,
      tableId: TABLES.books,
      queries: [PUBLISHED(), Query.equal('slug', slug), Query.limit(1)],
    }),
  );
  const row = result.rows[0];
  return row ? toPublicBook(row) : null;
}

/** By id, published only. Use getBookForAdmin to see drafts. */
export async function getPublishedBook(id: string): Promise<Book | null> {
  const { tables } = createAdminClient();
  try {
    const row = await withRetry(() =>
      tables.getRow<BookRow>({
        databaseId: DB_ID,
        tableId: TABLES.books,
        rowId: id,
      }),
    );
    if (row.status !== 'published') return null;
    return toPublicBook(row);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Drafts included. Only call behind requireAdmin(). */
export async function getBookForAdmin(id: string): Promise<BookRow | null> {
  const { tables } = createAdminClient();
  try {
    const row = await withRetry(() =>
      tables.getRow<BookRow>({ databaseId: DB_ID, tableId: TABLES.books, rowId: id }),
    );
    // Deliberately not toPublicBook — the admin edit form needs the draft
    // status a public read would hide — but it still reaches <BookForm>, a
    // Client Component, so it needs the same null-prototype fix.
    return toPlainObject(row);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function getBooksByIds(ids: string[]): Promise<Book[]> {
  const wanted = Array.from(new Set(ids.filter(Boolean)));
  if (!wanted.length) return [];

  const { tables } = createAdminClient();
  const found: BookRow[] = [];

  // Appwrite caps values per query; chunk so a long "continue reading" list
  // still resolves in one pass per 100 ids.
  for (let i = 0; i < wanted.length; i += 100) {
    const chunk = wanted.slice(i, i + 100);
    const result = await withRetry(() =>
      tables.listRows<BookRow>({
        databaseId: DB_ID,
        tableId: TABLES.books,
        queries: [PUBLISHED(), Query.equal('$id', chunk), Query.limit(chunk.length)],
      }),
    );
    found.push(...result.rows);
  }

  // Return in the order asked for — callers pass ids already sorted by
  // recency, and losing that order would scramble "continue reading".
  const byId = new Map(found.map((b) => [b.$id, b]));
  return wanted.map((id) => byId.get(id)).filter((b): b is BookRow => Boolean(b)).map(toPublicBook);
}

/**
 * Clears `featured` on every book except one.
 *
 * The hero has exactly one slot, so featuring a second book cannot mean
 * "show both" — it can only mean "show this one instead". Left unenforced, the
 * flag quietly lies: two books read as featured in the admin list while the
 * newest silently wins, which is the confusing half of a race nobody entered.
 *
 * Called after a save rather than before, so a failed write cannot unfeature
 * the book that was already there.
 */
export async function demoteOtherFeatured(keepId: string): Promise<void> {
  const { tables } = createAdminClient();

  const others = await withRetry(() =>
    tables.listRows<BookRow>({
      databaseId: DB_ID,
      tableId: TABLES.books,
      queries: [
        Query.equal('featured', true),
        Query.notEqual('$id', keepId),
        Query.select(['$id']),
        Query.limit(100),
      ],
    }),
  );

  await Promise.all(
    others.rows.map((row) =>
      tables.updateRow({
        databaseId: DB_ID,
        tableId: TABLES.books,
        rowId: row.$id,
        data: { featured: false },
      }),
    ),
  );
}

export async function getFeaturedBook(): Promise<Book | null> {
  const { tables } = createAdminClient();
  const featured = await withRetry(() =>
    tables.listRows<BookRow>({
      databaseId: DB_ID,
      tableId: TABLES.books,
      queries: [PUBLISHED(), Query.equal('featured', true), Query.orderDesc('$createdAt'), Query.limit(1)],
    }),
  );
  if (featured.rows[0]) return toPublicBook(featured.rows[0]);

  // Nothing flagged: the newest book stands in, so the hero is never empty
  // just because nobody has picked a favourite yet.
  const newest = await withRetry(() =>
    tables.listRows<BookRow>({
      databaseId: DB_ID,
      tableId: TABLES.books,
      queries: [PUBLISHED(), Query.orderDesc('$createdAt'), Query.limit(1)],
    }),
  );
  return newest.rows[0] ? toPublicBook(newest.rows[0]) : null;
}

export async function getRecentBooks(limit = 12): Promise<Book[]> {
  const { items } = await browseBooks({ sort: 'recent', pageSize: limit });
  return items;
}

export async function getPopularBooks(limit = 12): Promise<Book[]> {
  const { items } = await browseBooks({ sort: 'popular', pageSize: limit });
  return items;
}

/** Other volumes in the same series, or failing that the same primary author. */
export async function getRelatedBooks(book: Book, limit = 8): Promise<Book[]> {
  const { tables } = createAdminClient();

  if (book.series) {
    // Narrowing `book.series` from the `if` above doesn't survive into the
    // closure withRetry takes — TypeScript re-widens a property access (as
    // opposed to a local variable) inside a nested function, since it can't
    // prove the object wasn't mutated by the time the closure runs. Reading
    // it into a local const, the same way `author` and `tag` already do
    // below, keeps the narrowing.
    const series = book.series;
    const sameSeries = await withRetry(() =>
      tables.listRows<BookRow>({
        databaseId: DB_ID,
        tableId: TABLES.books,
        queries: [
          PUBLISHED(),
          Query.equal('series', series),
          Query.notEqual('$id', book.$id),
          Query.orderAsc('seriesIndex'),
          Query.limit(limit),
        ],
      }),
    );
    if (sameSeries.rows.length) return sameSeries.rows.map(toPublicBook);
  }

  const author = book.authors?.[0];
  if (author) {
    const sameAuthor = await withRetry(() =>
      tables.listRows<BookRow>({
        databaseId: DB_ID,
        tableId: TABLES.books,
        queries: [
          PUBLISHED(),
          Query.contains('authors', author),
          Query.notEqual('$id', book.$id),
          Query.orderDesc('$createdAt'),
          Query.limit(limit),
        ],
      }),
    );
    if (sameAuthor.rows.length) return sameAuthor.rows.map(toPublicBook);
  }

  // Fall back to sharing a tag, so a book detail page is never a dead end.
  const tag = book.tags?.[0];
  if (tag) {
    const sameTag = await withRetry(() =>
      tables.listRows<BookRow>({
        databaseId: DB_ID,
        tableId: TABLES.books,
        queries: [
          PUBLISHED(),
          Query.contains('tags', tag),
          Query.notEqual('$id', book.$id),
          Query.orderDesc('$createdAt'),
          Query.limit(limit),
        ],
      }),
    );
    return sameTag.rows.map(toPublicBook);
  }

  return [];
}

/* ═══════════════════════════════════════════════════════════════════
   Facets

   Appwrite has no GROUP BY, so facets are counted in application code over
   the published set. That is fine at library scale (hundreds to low
   thousands) and the result is cached per request.
   ═══════════════════════════════════════════════════════════════════ */

const FACET_SCAN_CAP = 2000;

export async function getFacets(): Promise<Facets> {
  const { tables } = createAdminClient();

  const authors = new Map<string, number>();
  const tags = new Map<string, number>();
  const languages = new Map<string, number>();
  const formats = new Map<string, number>();
  const years = new Map<number, number>();

  let cursor: string | undefined;
  let scanned = 0;

  while (scanned < FACET_SCAN_CAP) {
    const queries = [
      PUBLISHED(),
      // Only the columns the facets need — keeps the payload small on a
      // collection with long descriptions.
      Query.select(['$id', 'authors', 'tags', 'language', 'format', 'publishedYear']),
      Query.orderAsc('$id'),
      Query.limit(100),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await withRetry(() =>
      tables.listRows<BookRow>({
        databaseId: DB_ID,
        tableId: TABLES.books,
        queries,
      }),
    );

    for (const row of page.rows) {
      for (const a of row.authors ?? []) if (a) authors.set(a, (authors.get(a) ?? 0) + 1);
      for (const t of row.tags ?? []) if (t) tags.set(t, (tags.get(t) ?? 0) + 1);
      if (row.language) languages.set(row.language, (languages.get(row.language) ?? 0) + 1);
      if (row.format) formats.set(row.format, (formats.get(row.format) ?? 0) + 1);
      if (row.publishedYear) years.set(row.publishedYear, (years.get(row.publishedYear) ?? 0) + 1);
    }

    scanned += page.rows.length;
    if (page.rows.length < 100) break;
    cursor = page.rows.at(-1)?.$id;
    if (!cursor) break;
  }

  const toList = <K extends string | number>(map: Map<K, number>) =>
    sortFacet(Array.from(map, ([value, count]) => ({ value, count })));

  return {
    authors: toList(authors) as Facets['authors'],
    tags: toList(tags) as Facets['tags'],
    languages: toList(languages) as Facets['languages'],
    formats: toList(formats) as Facets['formats'],
    // Years read best newest-first rather than by count.
    years: Array.from(years, ([value, count]) => ({ value, count })).sort((a, b) => b.value - a.value),
  };
}

/** Everything published, trimmed to what the command palette needs to search. */
export async function getSearchIndex(): Promise<
  Pick<Book, '$id' | 'title' | 'slug' | 'authors' | 'format' | 'coverId' | 'coverColor'>[]
> {
  const { tables } = createAdminClient();
  const out: BookRow[] = [];
  let cursor: string | undefined;

  while (out.length < FACET_SCAN_CAP) {
    const queries = [
      PUBLISHED(),
      Query.select(['$id', 'title', 'slug', 'authors', 'format', 'coverId', 'coverColor']),
      Query.orderAsc('title'),
      Query.limit(100),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await withRetry(() =>
      tables.listRows<BookRow>({
        databaseId: DB_ID,
        tableId: TABLES.books,
        queries,
      }),
    );
    out.push(...page.rows);
    if (page.rows.length < 100) break;
    cursor = page.rows.at(-1)?.$id;
    if (!cursor) break;
  }

  return out;
}

/* ═══════════════════════════════════════════════════════════════════
   Writes
   ═══════════════════════════════════════════════════════════════════ */

/** Fire-and-forget read counter. A dropped increment is not worth an error. */
export async function bumpReadCount(bookId: string): Promise<void> {
  try {
    const { tables } = createAdminClient();
    await tables.incrementRowColumn({
      databaseId: DB_ID,
      tableId: TABLES.books,
      rowId: bookId,
      column: 'readCount',
      value: 1,
    });
  } catch (error) {
    console.error('[parva] readCount increment failed', error);
  }
}
