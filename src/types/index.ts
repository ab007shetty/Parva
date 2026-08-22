import type { ReaderFit, ReaderFontKey, ReaderLayout, ReaderTone } from '@/lib/config';

/* ═══════════════════════════════════════════════════════════════════
   Domain types

   These mirror the Appwrite tables provisioned by scripts/setup-appwrite.mjs.
   Every row carries Appwrite's system fields; `AppwriteRow` captures them
   once so each table type stays readable.
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Appwrite's system fields. These must match `Models.Row` exactly — all
 * required — or the SDK's `Row extends Models.Row` constraint rejects our
 * row types and every generic call has to be cast.
 */
export type AppwriteRow = {
  $id: string;
  $sequence: string;
  $tableId: string;
  $databaseId: string;
  $createdAt: string;
  $updatedAt: string;
  $permissions: string[];
};

export type BookFormat = 'pdf' | 'epub';
export type BookStatus = 'draft' | 'published';

export type BookRow = AppwriteRow & {
  title: string;
  slug: string;
  subtitle: string | null;
  authors: string[];
  description: string | null;
  tags: string[];
  language: string | null;
  format: BookFormat;

  fileId: string;
  fileName: string | null;
  fileSize: number | null;

  coverId: string | null;
  /** Hex, sampled from the cover at upload. Drives --bloom. */
  coverColor: string | null;
  /** Intrinsic cover ratio (w/h). Lets the shelf keep real proportions
   *  and reserve exact space before the image loads. */
  coverRatio: number | null;

  pageCount: number | null;
  publisher: string | null;
  publishedYear: number | null;
  isbn: string | null;
  series: string | null;
  seriesIndex: number | null;

  featured: boolean;
  status: BookStatus;
  allowDownload: boolean;

  uploadedBy: string | null;
  readCount: number;
};

/** What the browser is allowed to know about a book. Identical to BookRow
 *  today, but stated separately so a future private field cannot leak by
 *  accident — `toPublicBook()` is the only way rows reach the client. */
export type Book = BookRow;

export type ProgressRow = AppwriteRow & {
  userId: string;
  bookId: string;
  /** Page number as a string for PDF, an EPUB CFI for EPUB. One column keeps
   *  the table uniform; `format` says how to read it. */
  position: string;
  format: BookFormat;
  page: number | null;
  totalPages: number | null;
  percent: number;
  secondsRead: number;
  finished: boolean;
  lastDevice: string | null;
};

export type BookmarkRow = AppwriteRow & {
  userId: string;
  bookId: string;
  position: string;
  page: number | null;
  percent: number;
  /** Auto-filled from the text at that position, editable by the reader. */
  label: string | null;
  note: string | null;
};

export type FavoriteRow = AppwriteRow & {
  userId: string;
  bookId: string;
};

export type HighlightColor = 'marker' | 'ribbon' | 'ink';

export type HighlightRow = AppwriteRow & {
  userId: string;
  bookId: string;
  /** CFI range for EPUB. For PDF, a JSON string: {page, rects:[[x,y,w,h]…]}
   *  in unscaled PDF units so it survives any zoom. */
  position: string;
  page: number | null;
  percent: number;
  text: string;
  note: string | null;
  color: HighlightColor;
};

/** One row per user per day. Cheap, and it makes streaks and the reading
 *  heatmap a single query instead of a scan over progress history. */
export type ReadingDayRow = AppwriteRow & {
  userId: string;
  /** YYYY-MM-DD in the reader's own timezone. */
  day: string;
  seconds: number;
  pages: number;
};

export type UserRow = AppwriteRow & {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  lastSeenAt: string | null;
};

/* ═══════════════════════════════════════════════════════════════════
   Session
   ═══════════════════════════════════════════════════════════════════ */

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  createdAt: string;
};

/* ═══════════════════════════════════════════════════════════════════
   Reader
   ═══════════════════════════════════════════════════════════════════ */

export type ReaderSettings = {
  layout: ReaderLayout;
  fit: ReaderFit;
  zoom: number;
  tone: ReaderTone;
  fontFamily: ReaderFontKey;
  fontScale: number;
  lineHeight: number;
  /** Multiplier on the reading column's side margins. */
  margin: number;
  justify: boolean;
  /** Turning a page slides/folds it. Off means an instant cut. */
  animatePageTurn: boolean;
  /** Read-aloud voice rate. */
  speechRate: number;
  speechVoiceURI: string | null;
};

/** Where the reader is, in a format both engines can express. */
export type ReaderPosition = {
  /** 1-based for PDF. */
  page: number;
  totalPages: number;
  /** 0–100. */
  percent: number;
  /** Engine-native locator: page number string, or an EPUB CFI. */
  locator: string;
  /** Chapter or section label for the current position, when known. */
  label?: string | null;
};

export type TocItem = {
  id: string;
  label: string;
  /** PDF: 1-based page number. EPUB: an href into the spine. */
  target: string | number;
  level: number;
  children?: TocItem[];
};

export type SearchHit = {
  id: string;
  /** 1-based page for PDF; a CFI for EPUB. */
  locator: string | number;
  page: number | null;
  excerpt: string;
  /** Character offset of the match inside `excerpt`, for highlighting. */
  matchStart: number;
  matchLength: number;
};

/* ═══════════════════════════════════════════════════════════════════
   API shapes
   ═══════════════════════════════════════════════════════════════════ */

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type BrowseParams = {
  q?: string;
  author?: string;
  tag?: string;
  language?: string;
  format?: BookFormat;
  year?: number;
  sort?: string;
  page?: number;
  pageSize?: number;
};

/** Facets for the browse filters, computed from the published collection. */
export type Facets = {
  authors: { value: string; count: number }[];
  tags: { value: string; count: number }[];
  languages: { value: string; count: number }[];
  formats: { value: BookFormat; count: number }[];
  years: { value: number; count: number }[];
};
