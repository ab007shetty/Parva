import 'server-only';

import { unstable_cache } from 'next/cache';

import {
  getFacets,
  getFeaturedBook,
  getPopularBooks,
  getRecentBooks,
  getSearchIndex,
} from '@/lib/appwrite/books';

/**
 * The catalogue reads, shared across requests instead of repeated per visitor.
 *
 * Why this exists: every page that shows books also calls `getSessionUser()`,
 * which reads a cookie — and reading a cookie opts the whole route out of
 * prerendering. So `export const revalidate = 300` on the home page was dead
 * code: nothing was cached, and each request re-ran four Appwrite queries.
 * Under any real traffic that multiplies straight into the backend, and on a
 * free plan it is quota spent re-fetching a catalogue that changes when an
 * admin publishes and at no other time.
 *
 * The split is the important part. These reads are identical for everyone, so
 * they cache. Anything per-reader — continue-reading, favourites, bookmarks —
 * stays outside this file and keeps rendering per request, because caching it
 * would mean serving one reader's shelf to another.
 *
 * Invalidation is by tag rather than by time alone: the admin write routes
 * already call `revalidatePath('/')`, and now also `revalidateTag(CATALOGUE_TAG)`,
 * so a publish is visible immediately instead of up to five minutes later.
 */

export const CATALOGUE_TAG = 'catalogue';

/** Long enough to absorb a burst, short enough that a missed tag invalidation
 *  still self-corrects within a few minutes. */
const TTL_SECONDS = 300;

const cacheOptions = { revalidate: TTL_SECONDS, tags: [CATALOGUE_TAG] };

export const getCachedFeaturedBook = unstable_cache(
  () => getFeaturedBook(),
  ['catalogue', 'featured'],
  cacheOptions,
);

export const getCachedRecentBooks = unstable_cache(
  (limit: number) => getRecentBooks(limit),
  ['catalogue', 'recent'],
  cacheOptions,
);

export const getCachedPopularBooks = unstable_cache(
  (limit: number) => getPopularBooks(limit),
  ['catalogue', 'popular'],
  cacheOptions,
);

export const getCachedFacets = unstable_cache(
  () => getFacets(),
  ['catalogue', 'facets'],
  cacheOptions,
);

export const getCachedSearchIndex = unstable_cache(
  () => getSearchIndex(),
  ['catalogue', 'search-index'],
  cacheOptions,
);
