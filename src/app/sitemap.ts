import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/config';
import { getFacets, getSearchIndex } from '@/lib/appwrite/books';

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
    const [books, facets] = await Promise.all([getSearchIndex(), getFacets()]);

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
  } catch {
    // A sitemap missing its book pages is better than a 500 at /sitemap.xml.
    return staticPages;
  }
}
