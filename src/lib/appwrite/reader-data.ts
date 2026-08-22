import 'server-only';

import { ID, Permission, Query, Role } from 'node-appwrite';

import { DB_ID, TABLES } from '@/lib/config';
import { createAdminClient, isNotFound, requireSessionClient, toPlainObject } from '@/lib/appwrite/server';
import { clamp, round } from '@/lib/utils';
import type {
  BookmarkRow,
  FavoriteRow,
  HighlightRow,
  ProgressRow,
  ReadingDayRow,
  ReaderPosition,
} from '@/types';

/**
 * Everything a signed-in reader owns: progress, bookmarks, favourites,
 * highlights, reading days.
 *
 * All of it goes through the SESSION client, so Appwrite's row permissions do
 * the access control. Even if a route handler forgot to check the caller, a
 * reader physically cannot read or write another reader's rows.
 */

/**
 * One row per (user, book), by construction.
 *
 * Appwrite row ids are capped at 36 characters, so two 20-character ids cannot
 * simply be concatenated — and truncating them would let two different books
 * collide. Hashing the pair gives a deterministic id that fits, which turns
 * "save my place" into an upsert with no read-then-write race.
 */
function pairId(userId: string, bookId: string) {
  // FNV-1a: short, stable, and collision-safe enough for a per-user namespace.
  let h = 0x811c9dc5;
  for (const ch of `${userId}:${bookId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${userId.slice(0, 20)}${h.toString(36)}`.slice(0, 36);
}

/** Only the owner may ever touch these rows. */
function ownerOnly(userId: string) {
  return [
    Permission.read(Role.user(userId)),
    Permission.update(Role.user(userId)),
    Permission.delete(Role.user(userId)),
  ];
}

/* ═══════════════════════════════════════════════════════════════════
   Progress — "where you left off"
   ═══════════════════════════════════════════════════════════════════ */

export async function getProgress(userId: string, bookId: string): Promise<ProgressRow | null> {
  const { tables } = await requireSessionClient();
  try {
    const row = await tables.getRow<ProgressRow>({
      databaseId: DB_ID,
      tableId: TABLES.progress,
      rowId: pairId(userId, bookId),
    });
    // node-appwrite parses every response as a null-prototype object, which
    // React's Server → Client boundary refuses outright — see toPlainObject.
    return toPlainObject(row);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function saveProgress(input: {
  userId: string;
  bookId: string;
  format: 'pdf' | 'epub';
  position: ReaderPosition;
  /** Seconds read since the last save. Accumulated, not replaced. */
  secondsDelta?: number;
  device?: string | null;
}): Promise<ProgressRow> {
  const { tables } = await requireSessionClient();
  const rowId = pairId(input.userId, input.bookId);
  const percent = clamp(round(input.position.percent, 2), 0, 100);

  // Read the existing row so `secondsRead` accumulates. If it is missing we
  // start from zero — the upsert below creates it either way.
  let previousSeconds = 0;
  try {
    const existing = await tables.getRow<ProgressRow>({
      databaseId: DB_ID,
      tableId: TABLES.progress,
      rowId,
    });
    previousSeconds = existing.secondsRead ?? 0;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  return tables.upsertRow<ProgressRow>({
    databaseId: DB_ID,
    tableId: TABLES.progress,
    rowId,
    data: {
      userId: input.userId,
      bookId: input.bookId,
      format: input.format,
      position: input.position.locator,
      page: input.position.page,
      totalPages: input.position.totalPages,
      percent,
      secondsRead: previousSeconds + Math.max(0, Math.round(input.secondsDelta ?? 0)),
      // 98% rather than 100: the last page of a PDF is often a colophon or a
      // blank, and readers stop before it. Marking it finished there matches
      // what people mean.
      finished: percent >= 98,
      lastDevice: input.device ?? null,
    },
    permissions: ownerOnly(input.userId),
  });
}

/** Most recently read first — the order the "Continue reading" shelf wants. */
export async function listContinueReading(userId: string, limit = 12): Promise<ProgressRow[]> {
  const { tables } = await requireSessionClient();
  const result = await tables.listRows<ProgressRow>({
    databaseId: DB_ID,
    tableId: TABLES.progress,
    queries: [
      Query.equal('userId', userId),
      Query.equal('finished', false),
      Query.greaterThan('percent', 0),
      Query.orderDesc('$updatedAt'),
      Query.limit(limit),
    ],
  });
  // See toPlainObject: node-appwrite's rows carry a null prototype that React's
  // Server → Client boundary rejects, so every row is rebuilt plain here.
  return result.rows.map(toPlainObject);
}

export async function listFinished(userId: string, limit = 50): Promise<ProgressRow[]> {
  const { tables } = await requireSessionClient();
  const result = await tables.listRows<ProgressRow>({
    databaseId: DB_ID,
    tableId: TABLES.progress,
    queries: [
      Query.equal('userId', userId),
      Query.equal('finished', true),
      Query.orderDesc('$updatedAt'),
      Query.limit(limit),
    ],
  });
  // See toPlainObject: node-appwrite's rows carry a null prototype that React's
  // Server → Client boundary rejects, so every row is rebuilt plain here.
  return result.rows.map(toPlainObject);
}

export async function listAllProgress(userId: string, limit = 100): Promise<ProgressRow[]> {
  const { tables } = await requireSessionClient();
  const result = await tables.listRows<ProgressRow>({
    databaseId: DB_ID,
    tableId: TABLES.progress,
    queries: [Query.equal('userId', userId), Query.orderDesc('$updatedAt'), Query.limit(limit)],
  });
  // See toPlainObject: node-appwrite's rows carry a null prototype that React's
  // Server → Client boundary rejects, so every row is rebuilt plain here.
  return result.rows.map(toPlainObject);
}

/* ═══════════════════════════════════════════════════════════════════
   Favourites
   ═══════════════════════════════════════════════════════════════════ */

export async function isFavorite(userId: string, bookId: string): Promise<boolean> {
  const { tables } = await requireSessionClient();
  try {
    await tables.getRow<FavoriteRow>({
      databaseId: DB_ID,
      tableId: TABLES.favorites,
      rowId: pairId(userId, bookId),
    });
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/** Returns the state after the toggle, so the caller can render it directly. */
export async function toggleFavorite(userId: string, bookId: string): Promise<boolean> {
  const { tables } = await requireSessionClient();
  const rowId = pairId(userId, bookId);

  try {
    await tables.getRow<FavoriteRow>({
      databaseId: DB_ID,
      tableId: TABLES.favorites,
      rowId,
    });
    await tables.deleteRow({ databaseId: DB_ID, tableId: TABLES.favorites, rowId });
    return false;
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await tables.createRow<FavoriteRow>({
      databaseId: DB_ID,
      tableId: TABLES.favorites,
      rowId,
      data: { userId, bookId },
      permissions: ownerOnly(userId),
    });
    return true;
  }
}

export async function listFavorites(userId: string, limit = 100): Promise<FavoriteRow[]> {
  const { tables } = await requireSessionClient();
  const result = await tables.listRows<FavoriteRow>({
    databaseId: DB_ID,
    tableId: TABLES.favorites,
    queries: [Query.equal('userId', userId), Query.orderDesc('$createdAt'), Query.limit(limit)],
  });
  // See toPlainObject: node-appwrite's rows carry a null prototype that React's
  // Server → Client boundary rejects, so every row is rebuilt plain here.
  return result.rows.map(toPlainObject);
}

/* ═══════════════════════════════════════════════════════════════════
   Bookmarks
   ═══════════════════════════════════════════════════════════════════ */

export async function listBookmarks(
  userId: string,
  bookId?: string,
  limit = 200,
): Promise<BookmarkRow[]> {
  const { tables } = await requireSessionClient();
  const queries = [Query.equal('userId', userId), Query.orderAsc('percent'), Query.limit(limit)];
  if (bookId) queries.unshift(Query.equal('bookId', bookId));

  const result = await tables.listRows<BookmarkRow>({
    databaseId: DB_ID,
    tableId: TABLES.bookmarks,
    queries,
  });
  // See toPlainObject: node-appwrite's rows carry a null prototype that React's
  // Server → Client boundary rejects, so every row is rebuilt plain here.
  return result.rows.map(toPlainObject);
}

export async function addBookmark(input: {
  userId: string;
  bookId: string;
  position: string;
  page: number | null;
  percent: number;
  label?: string | null;
  note?: string | null;
}): Promise<BookmarkRow> {
  const { tables } = await requireSessionClient();
  return tables.createRow<BookmarkRow>({
    databaseId: DB_ID,
    tableId: TABLES.bookmarks,
    rowId: ID.unique(),
    data: {
      userId: input.userId,
      bookId: input.bookId,
      position: input.position,
      page: input.page,
      percent: clamp(round(input.percent, 2), 0, 100),
      label: input.label ?? null,
      note: input.note ?? null,
    },
    permissions: ownerOnly(input.userId),
  });
}

export async function updateBookmark(
  id: string,
  data: Partial<Pick<BookmarkRow, 'label' | 'note'>>,
): Promise<BookmarkRow> {
  const { tables } = await requireSessionClient();
  return tables.updateRow<BookmarkRow>({
    databaseId: DB_ID,
    tableId: TABLES.bookmarks,
    rowId: id,
    data,
  });
}

export async function removeBookmark(id: string): Promise<void> {
  const { tables } = await requireSessionClient();
  await tables.deleteRow({ databaseId: DB_ID, tableId: TABLES.bookmarks, rowId: id });
}

/* ═══════════════════════════════════════════════════════════════════
   Highlights
   ═══════════════════════════════════════════════════════════════════ */

export async function listHighlights(
  userId: string,
  bookId?: string,
  limit = 300,
): Promise<HighlightRow[]> {
  const { tables } = await requireSessionClient();
  const queries = [Query.equal('userId', userId), Query.orderAsc('percent'), Query.limit(limit)];
  if (bookId) queries.unshift(Query.equal('bookId', bookId));

  const result = await tables.listRows<HighlightRow>({
    databaseId: DB_ID,
    tableId: TABLES.highlights,
    queries,
  });
  // See toPlainObject: node-appwrite's rows carry a null prototype that React's
  // Server → Client boundary rejects, so every row is rebuilt plain here.
  return result.rows.map(toPlainObject);
}

export async function addHighlight(input: {
  userId: string;
  bookId: string;
  position: string;
  page: number | null;
  percent: number;
  text: string;
  note?: string | null;
  color?: HighlightRow['color'];
}): Promise<HighlightRow> {
  const { tables } = await requireSessionClient();
  return tables.createRow<HighlightRow>({
    databaseId: DB_ID,
    tableId: TABLES.highlights,
    rowId: ID.unique(),
    data: {
      userId: input.userId,
      bookId: input.bookId,
      position: input.position,
      page: input.page,
      percent: clamp(round(input.percent, 2), 0, 100),
      // Long selections are notes, not highlights; cap so one runaway
      // selection cannot blow the column limit.
      text: input.text.slice(0, 2000),
      note: input.note ?? null,
      color: input.color ?? 'marker',
    },
    permissions: ownerOnly(input.userId),
  });
}

export async function updateHighlight(
  id: string,
  data: Partial<Pick<HighlightRow, 'note' | 'color'>>,
): Promise<HighlightRow> {
  const { tables } = await requireSessionClient();
  return tables.updateRow<HighlightRow>({
    databaseId: DB_ID,
    tableId: TABLES.highlights,
    rowId: id,
    data,
  });
}

export async function removeHighlight(id: string): Promise<void> {
  const { tables } = await requireSessionClient();
  await tables.deleteRow({ databaseId: DB_ID, tableId: TABLES.highlights, rowId: id });
}

/* ═══════════════════════════════════════════════════════════════════
   Reading days — streaks and the year heatmap
   ═══════════════════════════════════════════════════════════════════ */

/** `day` is YYYY-MM-DD in the reader's own timezone, sent by the client, so a
 *  late-night session counts as the day it felt like. */
export async function recordReadingDay(input: {
  userId: string;
  day: string;
  seconds: number;
  pages: number;
}): Promise<void> {
  const { tables } = await requireSessionClient();
  const rowId = pairId(input.userId, input.day);

  let seconds = 0;
  let pages = 0;
  try {
    const existing = await tables.getRow<ReadingDayRow>({
      databaseId: DB_ID,
      tableId: TABLES.readingDays,
      rowId,
    });
    seconds = existing.seconds ?? 0;
    pages = existing.pages ?? 0;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  await tables.upsertRow<ReadingDayRow>({
    databaseId: DB_ID,
    tableId: TABLES.readingDays,
    rowId,
    data: {
      userId: input.userId,
      day: input.day,
      seconds: seconds + Math.max(0, Math.round(input.seconds)),
      pages: pages + Math.max(0, Math.round(input.pages)),
    },
    permissions: ownerOnly(input.userId),
  });
}

export async function listReadingDays(userId: string, limit = 400): Promise<ReadingDayRow[]> {
  const { tables } = await requireSessionClient();
  const result = await tables.listRows<ReadingDayRow>({
    databaseId: DB_ID,
    tableId: TABLES.readingDays,
    queries: [Query.equal('userId', userId), Query.orderDesc('day'), Query.limit(limit)],
  });
  // See toPlainObject: node-appwrite's rows carry a null prototype that React's
  // Server → Client boundary rejects, so every row is rebuilt plain here.
  return result.rows.map(toPlainObject);
}

/**
 * Consecutive days ending today or yesterday. Yesterday still counts so the
 * streak does not appear broken before you have read today.
 */
export function computeStreak(days: ReadingDayRow[]): { current: number; longest: number } {
  const set = new Set(days.filter((d) => d.seconds > 0).map((d) => d.day));
  if (!set.size) return { current: 0, longest: 0 };

  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  let current = 0;
  const cursor = set.has(dayKey(today)) ? today : set.has(dayKey(yesterday)) ? yesterday : null;
  if (cursor) {
    const walk = new Date(cursor);
    while (set.has(dayKey(walk))) {
      current += 1;
      walk.setDate(walk.getDate() - 1);
    }
  }

  const sorted = Array.from(set).sort();
  let longest = 0;
  let run = 0;
  let previous: Date | null = null;
  for (const key of sorted) {
    const date = new Date(`${key}T00:00:00Z`);
    if (previous && (date.getTime() - previous.getTime()) / 86_400_000 === 1) run += 1;
    else run = 1;
    longest = Math.max(longest, run);
    previous = date;
  }

  return { current, longest };
}

/* ═══════════════════════════════════════════════════════════════════
   Admin views
   ═══════════════════════════════════════════════════════════════════ */

/** Aggregate counts for the admin dashboard. Uses the admin client because it
 *  deliberately spans every reader. */
export async function adminCounts(): Promise<{
  books: number;
  published: number;
  drafts: number;
  readers: number;
  sessions: number;
}> {
  const { tables } = createAdminClient();

  const count = async (tableId: string, queries: string[] = []) => {
    const result = await tables.listRows({
      databaseId: DB_ID,
      tableId,
      queries: [...queries, Query.limit(1)],
      total: true,
    });
    return result.total;
  };

  const [books, published, readers, sessions] = await Promise.all([
    count(TABLES.books),
    count(TABLES.books, [Query.equal('status', 'published')]),
    count(TABLES.users),
    count(TABLES.progress),
  ]);

  return { books, published, drafts: books - published, readers, sessions };
}
