import { NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { Query } from 'node-appwrite';

import { requireAdmin } from '@/lib/auth/session';
import { createAdminClient, isConflict, isNotFound } from '@/lib/appwrite/server';
import { BUCKETS, DB_ID, TABLES } from '@/lib/config';
import { deleteStoredFile } from '@/lib/appwrite/files';
import { demoteOtherFeatured } from '@/lib/appwrite/books';
import { CATALOGUE_TAG } from '@/lib/appwrite/catalogue-cache';
import { clamp, normalizeHex, slugify, uniqueSlug } from '@/lib/utils';
import type { BookRow } from '@/types';

/** Only these columns may be changed after creation. Notably not `fileId` —
 *  replacing a file means a new upload, which keeps positions honest. */
const EDITABLE = [
  'title',
  'subtitle',
  'authors',
  'description',
  'tags',
  'language',
  'coverId',
  'coverColor',
  'coverRatio',
  'pageCount',
  'publisher',
  'publishedYear',
  'isbn',
  'series',
  'seriesIndex',
  'featured',
  'status',
  'allowDownload',
] as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (error) {
    return authError(error);
  }

  const { id } = await params;

  try {
    const { tables } = createAdminClient();
    const book = await tables.getRow<BookRow>({
      databaseId: DB_ID,
      tableId: TABLES.books,
      rowId: id,
    });
    return NextResponse.json({ book });
  } catch (error) {
    if (isNotFound(error)) return NextResponse.json({ error: 'No such book.' }, { status: 404 });
    console.error('[parva] admin book fetch failed', error);
    return NextResponse.json({ error: 'Could not load that book.' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (error) {
    return authError(error);
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  try {
    const { tables } = createAdminClient();
    const current = await tables.getRow<BookRow>({
      databaseId: DB_ID,
      tableId: TABLES.books,
      rowId: id,
    });

    const data: Record<string, unknown> = {};

    for (const key of EDITABLE) {
      if (!(key in body)) continue;
      const value = body[key];

      switch (key) {
        case 'authors':
          data.authors = strArray(value, 24, 160);
          break;
        case 'tags':
          data.tags = strArray(value, 32, 60);
          break;
        case 'featured':
        case 'allowDownload':
          data[key] = value === true;
          break;
        case 'status':
          data.status = value === 'published' ? 'published' : 'draft';
          break;
        case 'coverColor':
          data.coverColor = normalizeHex(typeof value === 'string' ? value : null);
          break;
        case 'coverRatio':
          data.coverRatio = num(value, 0.1, 5);
          break;
        case 'pageCount':
          data.pageCount = num(value, 1, 100_000);
          break;
        case 'publishedYear':
          data.publishedYear = num(value, 1, 2200);
          break;
        case 'seriesIndex':
          data.seriesIndex = num(value, 0, 10_000);
          break;
        case 'description':
          data.description = typeof value === 'string' ? value.trim().slice(0, 20000) || null : null;
          break;
        default:
          data[key] = typeof value === 'string' ? value.trim().slice(0, 240) || null : null;
      }
    }

    // A title change does not move the URL — an existing link to a book should
    // keep working. The slug only changes when it is set explicitly.
    let slug = current.slug;
    if (typeof body.slug === 'string' && body.slug.trim()) {
      const desired = slugify(body.slug);
      if (desired && desired !== current.slug) {
        const existing = await tables.listRows<BookRow>({
          databaseId: DB_ID,
          tableId: TABLES.books,
          queries: [Query.select(['$id', 'slug']), Query.limit(100)],
        });
        const taken = new Set(
          existing.rows.filter((row) => row.$id !== id).map((row) => row.slug).filter(Boolean),
        );
        slug = uniqueSlug(desired, taken);
        data.slug = slug;
      }
    }

    // A replaced cover leaves the old file behind; drop it so storage does not
    // accumulate images nothing points at.
    const oldCoverId = current.coverId;
    if ('coverId' in body && typeof body.coverId === 'string' && body.coverId !== oldCoverId) {
      data.coverId = body.coverId;
    }

    const book = await tables.updateRow<BookRow>({
      databaseId: DB_ID,
      tableId: TABLES.books,
      rowId: id,
      data,
    });

    if (data.coverId && oldCoverId && data.coverId !== oldCoverId) {
      void deleteStoredFile(BUCKETS.covers, oldCoverId);
    }

    // Featuring this book unfeatures whatever held the slot before it.
    if (data.featured === true) await demoteOtherFeatured(id);

    // 'max' is the documented profile: the tag is marked stale and refreshed
    // behind the next visit. updateTag() would be read-your-own-writes, but it
    // is Server-Action-only and this is a Route Handler.
    revalidateTag(CATALOGUE_TAG, 'max');
    revalidatePath('/');
    revalidatePath('/library');
    revalidatePath(`/book/${current.slug}`);
    if (slug !== current.slug) revalidatePath(`/book/${slug}`);

    return NextResponse.json({ book });
  } catch (error) {
    if (isNotFound(error)) return NextResponse.json({ error: 'No such book.' }, { status: 404 });
    if (isConflict(error)) {
      return NextResponse.json({ error: 'That web address is already taken.' }, { status: 409 });
    }
    console.error('[parva] updating a book failed', error);
    return NextResponse.json({ error: 'That change could not be saved.' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (error) {
    return authError(error);
  }

  const { id } = await params;

  try {
    const { tables } = createAdminClient();
    const book = await tables.getRow<BookRow>({
      databaseId: DB_ID,
      tableId: TABLES.books,
      rowId: id,
    });

    await tables.deleteRow({ databaseId: DB_ID, tableId: TABLES.books, rowId: id });

    // Storage is cleaned up after the row is gone: an orphaned file is a
    // wasted megabyte, but an orphaned row is a broken book.
    if (book.fileId) void deleteStoredFile(BUCKETS.books, book.fileId);
    if (book.coverId) void deleteStoredFile(BUCKETS.covers, book.coverId);

    // Readers' bookmarks and progress rows are deliberately left alone. They
    // are owned by their readers, not by this book, and a re-uploaded book
    // under the same id would restore them.

    // 'max' is the documented profile: the tag is marked stale and refreshed
    // behind the next visit. updateTag() would be read-your-own-writes, but it
    // is Server-Action-only and this is a Route Handler.
    revalidateTag(CATALOGUE_TAG, 'max');
    revalidatePath('/');
    revalidatePath('/library');
    revalidatePath(`/book/${book.slug}`);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (isNotFound(error)) return new NextResponse(null, { status: 204 });
    console.error('[parva] deleting a book failed', error);
    return NextResponse.json({ error: 'That book could not be removed.' }, { status: 500 });
  }
}

/* ── helpers ────────────────────────────────────────────────────────── */

function authError(error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  if (status === 401) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (status === 403) {
    return NextResponse.json({ error: 'That area is for administrators.' }, { status: 403 });
  }
  console.error('[parva] admin auth check failed', error);
  return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
}

function num(value: unknown, min: number, max: number): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clamp(parsed, min, max);
}

function strArray(value: unknown, maxItems: number, maxLength: number): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim().slice(0, maxLength);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }

  return out;
}
