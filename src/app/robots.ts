import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin',
          '/admin/',
          '/me',
          '/me/',
          // A reading session is not a document, and its URLs carry signed
          // file links in the page.
          '/read/',
          '/sign-in',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
