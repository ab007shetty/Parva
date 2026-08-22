import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { ID, Permission, Query, Role } from 'node-appwrite';

import { requireAdmin } from '@/lib/auth/session';
import { createAdminClient, isConflict } from '@/lib/appwrite/server';
import { DB_ID, TABLES } from '@/lib/config';
import { deleteStoredFile } from '@/lib/appwrite/files';
import { demoteOtherFeatured } from '@/lib/appwrite/books';
import { BUCKETS } from '@/lib/config';
import { clamp, normalizeHex, slugify, uniqueSlug } from '@/lib/utils';
import type { BookRow } from '@/types';

/**
 * Creates and lists books.
 *
 * The file itself never comes through here — the browser has already uploaded
 * it straight to Appwrite storage and passes the resulting fileId. This route
 * writes the catalogue row that makes it a book.
 */

export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    return authError(error);
  }

  const url = new URL(request.url);
  const search = url.searchParams.get('q')?.trim();
  const status = url.searchParams.get('status');
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = clamp(Number(url.searchParams.get('pageSize')) || 25, 1, 100);

  try {
    const { tables } = createAdminClient();

    const queries: string[] = [Query.orderDesc('$createdAt'), Query.limit(pageSize), Query.offset((page - 1) * pageSize)];
    if (search) queries.unshift(Query.search('title', search));
    if (status === 'draft' || status === 'published') queries.unshift(Query.equal('status', status));

    const result = await tables.listRows<BookRow>({
      databaseId: DB_ID,
      tableId: TABLES.books,
      queries,
      total: true,
    });

    return NextResponse.json({
      items: result.rows,
      total: result.total,
      page,
      pageSize,
      hasMore: page * pageSize < result.total,
    });
  } catch (error) {
    console.error('[parva] admin book list failed', error);
    return NextResponse.json({ error: 'Could not load the catalogue.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let adminId: string;
  try {
    const admin = await requireAdmin();
    adminId = admin.id;
  } catch (error) {
    return authError(error);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const title = str(body.title)?.slice(0, 240);
  const fileId = str(body.fileId);
  const format = body.format === 'epub' ? 'epub' : body.format === 'pdf' ? 'pdf' : null;

  if (!title) return NextResponse.json({ error: 'A title is required.' }, { status: 400 });
  if (!fileId) return NextResponse.json({ error: 'Upload the book file first.' }, { status: 400 });
  if (!format) {
    return NextResponse.json({ error: 'Only PDF and EPUB files are supported.' }, { status: 400 });
  }

  try {
    const { tables } = createAdminClient();

    // Slugs are the public URL, so they have to be unique. Collect the taken
    // ones and step around them rather than failing the save.
    const existing = await tables.listRows<BookRow>({
      databaseId: DB_ID,
      tableId: TABLES.books,
      queries: [Query.select(['$id', 'slug']), Query.limit(100), Query.orderDesc('$createdAt')],
    });
    const taken = new Set(existing.rows.map((row) => row.slug).filter(Boolean));
    const slug = uniqueSlug(str(body.slug) ? slugify(str(body.slug)!) : slugify(title), taken);

    const row = await tables.createRow<BookRow>({
      databaseId: DB_ID,
      tableId: TABLES.books,
      rowId: ID.unique(),
      data: {
        title,
        slug,
        subtitle: str(body.subtitle)?.slice(0, 240) ?? null,
        authors: strArray(body.authors, 24, 160),
        description: str(body.description)?.slice(0, 20000) ?? null,
        tags: strArray(body.tags, 32, 60),
        language: str(body.language)?.slice(0, 12) ?? null,
        format,

        fileId,
        fileName: str(body.fileName)?.slice(0, 240) ?? null,
        fileSize: num(body.fileSize, 0, 5_000_000_000),

        coverId: str(body.coverId) ?? null,
        coverColor: normalizeHex(str(body.coverColor)),
        coverRatio: num(body.coverRatio, 0.1, 5),

        pageCount: num(body.pageCount, 1, 100_000),
        publisher: str(body.publisher)?.slice(0, 200) ?? null,
        publishedYear: num(body.publishedYear, 1, 2200),
        isbn: str(body.isbn)?.slice(0, 32) ?? null,
        series: str(body.series)?.slice(0, 200) ?? null,
        seriesIndex: num(body.seriesIndex, 0, 10_000),

        featured: body.featured === true,
        status: body.status === 'published' ? 'published' : 'draft',
        // Downloads are off unless asked for — the librarian decides whether a
        // book leaves the building.
        allowDownload: body.allowDownload === true,

        uploadedBy: adminId,
        readCount: 0,
      },
      // Anyone may read a book row; only the API key writes them.
      permissions: [Permission.read(Role.any())],
    });

    // One hero slot, one featured book. Doing this after the write means a
    // failed save leaves the existing featured book alone.
    if (row.featured) await demoteOtherFeatured(row.$id);

    // The catalogue is cached, so publishing has to invalidate it or the new
    // book will not appear for minutes.
    revalidatePath('/');
    revalidatePath('/library');
    revalidatePath(`/book/${slug}`);

    return NextResponse.json({ book: row }, { status: 201 });
  } catch (error) {
    if (isConflict(error)) {
      return NextResponse.json(
        { error: 'A book with that web address already exists. Change the slug.' },
        { status: 409 },
      );
    }
    console.error('[parva] creating a book failed', error);

    // The file is already in storage. Leaving an orphan there costs quota for
    // nothing, so clean it up before reporting the failure.
    if (fileId) void deleteStoredFile(BUCKETS.books, fileId);

    return NextResponse.json({ error: 'That book could not be saved.' }, { status: 500 });
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

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function num(value: unknown, min: number, max: number): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clamp(parsed, min, max);
}

/** Accepts an array or a comma-separated string, trims, dedupes, and caps both
 *  the number of entries and their length so a paste cannot exceed the column. */
function strArray(value: unknown, maxItems: number, maxLength: number): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

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
