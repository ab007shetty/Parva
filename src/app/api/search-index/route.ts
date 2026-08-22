import { NextResponse } from 'next/server';

import { getSearchIndex } from '@/lib/appwrite/books';

/**
 * The command palette's data: every published book, trimmed to the fields it
 * needs to match on. Small enough to send once and filter in the browser, which
 * is what makes search feel instant and lets it fold diacritics.
 */
export const revalidate = 300;

export async function GET() {
  try {
    const items = await getSearchIndex();
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
