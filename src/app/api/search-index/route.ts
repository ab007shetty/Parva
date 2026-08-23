import { NextResponse } from 'next/server';

import { LIMITS as RATE, rateLimitGuard } from '@/lib/rate-limit';

import { getCachedSearchIndex } from '@/lib/appwrite/catalogue-cache';
import { withRetry } from '@/lib/appwrite/server';

/**
 * The command palette's data: every published book, trimmed to the fields it
 * needs to match on. Small enough to send once and filter in the browser, which
 * is what makes search feel instant and lets it fold diacritics.
 */
export const revalidate = 300;

export async function GET(request: Request) {
  const limited = rateLimitGuard('search-index', request, RATE.searchIndex);
  if (limited) return limited;

  try {
    // Extra patience on top of the retry inside getSearchIndex, for the same
    // reason the sitemap has it: this route is prerendered at build time, so a
    // network blip during a deploy caches an empty index — and every search in
    // the app then finds nothing until `revalidate` above comes round.
    const items = await withRetry(() => getCachedSearchIndex(), 4);
    return NextResponse.json(
      { items },
      {
        headers: {
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=600',
        },
      },
    );
  } catch (error) {
    console.error('[parva] search index failed', error);
    // An empty index degrades the palette to "nothing matches" rather than
    // breaking the page that renders it.
    return NextResponse.json({ items: [] }, { status: 200 });
  }
}
