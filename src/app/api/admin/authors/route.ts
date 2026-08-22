import { NextResponse } from 'next/server';
import { Query } from 'node-appwrite';

import { requireAdmin } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/appwrite/server';
import { DB_ID, TABLES } from '@/lib/config';
import type { BookRow } from '@/types';

/**
 * Every author name already in the catalogue, with how often each appears.
 *
 * Authors are an array column, so Appwrite cannot group or distinct them — the
 * only way to know the real set is to read the names and count them here. That
 * is cheap: a scan of one small column, cached for the session, and it is the
 * difference between a form that suggests "Kuvempu" and one that quietly
 * accepts "kuvempu" as a second, separate author.
 *
 * Drafts are included deliberately. Someone shelving the second volume of a
 * series should get the spelling they used on the first, published or not.
 */

/** Enough to cover any catalogue an admin is typing into by hand. */
const SCAN_CAP = 2000;

export async function GET() {
  try {
    await requireAdmin();

    const { tables } = createAdminClient();

    /** Lowercased name → the spelling to offer, and its frequency. */
    const seen = new Map<string, { name: string; count: number }>();
    let cursor: string | undefined;

    while (seen.size < SCAN_CAP) {
      const queries = [Query.select(['$id', 'authors']), Query.limit(100)];
      if (cursor) queries.push(Query.cursorAfter(cursor));

      const page = await tables.listRows<BookRow>({
        databaseId: DB_ID,
        tableId: TABLES.books,
        queries,
      });

      for (const row of page.rows) {
        for (const raw of row.authors ?? []) {
          const name = raw.trim();
          if (!name) continue;

          const key = name.toLocaleLowerCase();
          const existing = seen.get(key);
          if (existing) existing.count += 1;
          else seen.set(key, { name, count: 1 });
        }
      }

      if (page.rows.length < 100) break;
      cursor = page.rows.at(-1)?.$id;
      if (!cursor) break;
    }

    // Commonest first, then alphabetical. A prolific author should be the first
    // suggestion after one letter, not the alphabetically luckiest one.
    const authors = [...seen.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map(({ name, count }) => ({ name, count }));

    return NextResponse.json(
      { authors },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 401) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
    if (status === 403) {
      return NextResponse.json({ error: 'That area is for administrators.' }, { status: 403 });
    }

    // No suggestions is a worse form, not a broken one — the field is still a
    // plain text input underneath.
    console.error('[parva] could not read the author list', error);
    return NextResponse.json({ authors: [] });
  }
}
