import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/config';
import { getFacets, getSearchIndex } from '@/lib/appwrite/books';
import { withRetry } from '@/lib/appwrite/server';

export const revalidate = 3600;

/**
 * Only pages worth indexing. The reader, the admin desk and anything under /me
 * are deliberately absent — they are either private or a session rather than a
 * document.
 *
 * A language filter such as /library?language=kn gets its own entry too. That
 * URL renders a real, different page — the library page gives it a matching
 * title, description and canonical (see generateMetadata there) — and it is
 * exactly the destination someone searching "kannada books" is looking for.
 * Left out of the sitemap it would still work, just undiscoverable; a filter
 * only appears here once a published book actually uses it, so nothing empty
 * is ever offered.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/library`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/authors`, changeFrequency: 'weekly', priority: 0.6 },
  ];

  try {
    // Wrapped again on top of the retry already inside these two reads.
    //
    // This is not belt-and-braces for its own sake: a build on a flaky
    // connection produced exactly this failure, and the sitemap it cached held
    // nothing but the three static URLs below — no books, no language pages,
    // which is the entire point of the file. A page request should fail fast
    // and offer "try again", but a sitemap is built once and then believed by
    // crawlers for an hour, so it is worth waiting out a bad network window
    // rather than publishing a confidently empty index.
    const [books, facets] = await withRetry(
      () => Promise.all([getSearchIndex(), getFacets()]),
      4,
    );

    const languagePages: MetadataRoute.Sitemap = facets.languages.map((language) => ({
      url: `${SITE_URL}/library?language=${encodeURIComponent(language.value)}`,
      changeFrequency: 'weekly',
      priority: 0.7,
    }));

    return [
      ...staticPages,
      ...languagePages,
      ...books.map((book) => ({
        url: `${SITE_URL}/book/${book.slug}`,
        changeFrequency: 'monthly' as const,
        priority: 0.8,
      })),
    ];
  } catch (error) {
    // A sitemap missing its book pages is better than a 500 at /sitemap.xml —
    // but it is not fine, so it is logged loudly rather than swallowed. If this
    // shows up in a deploy log, the deployed sitemap is incomplete until
    // `revalidate` above regenerates it.
    console.error('[parva] sitemap could not read the catalogue — shipping static pages only', error);
    return staticPages;
  }
}
