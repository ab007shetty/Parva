/**
 * Single source of truth for names, IDs and feature switches.
 *
 * The app name lives here and nowhere else — change APP_NAME and every
 * surface (metadata, manifest, header, emails, sitemap) follows.
 */

export const APP_NAME = 'Parva';
/**
 * Both feed only search-engine and share-preview surfaces — the <title> tag,
 * OG/Twitter cards, the PWA manifest — never anything rendered on a page, so
 * they carry real search terms rather than pure brand voice. "Kannada" and
 * "English" are named explicitly because that is the actual shape of the
 * catalogue and the query people search with; a vaguer tagline would read
 * more literary and rank for nothing.
 */
export const APP_TAGLINE = 'Free Kannada & English books, read online';
export const APP_DESCRIPTION =
  'Read Kannada, English and other language books online for free — no account needed. ' +
  'Full-screen PDF and EPUB reader, two pages at a time. Sign in only to keep your place and bookmarks.';

/** No trailing slash. Used for OAuth redirects, OG tags and the sitemap.
 *  A blank value in .env must fall back, or every redirect becomes relative. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'http://localhost:3000').replace(
  /\/$/,
  '',
);

/* ── Appwrite resource IDs ──────────────────────────────────────────
   These are stable slugs rather than generated IDs so the same names work
   across every environment and `npm run setup` is idempotent. */

/**
 * Reads an id from the environment, treating blank as absent.
 *
 * `??` is the wrong operator here: a variable that is present but empty —
 * `APPWRITE_COVERS_BUCKET_ID=` in a .env, which is exactly how the file ships —
 * is an empty string, not undefined, so it sails past `??` and becomes an empty
 * bucket id that Appwrite answers with a 404.
 */
function envId(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export const DB_ID = envId(process.env.APPWRITE_DATABASE_ID, 'parva');

export const TABLES = {
  users: 'users',
  books: 'books',
  progress: 'progress',
  bookmarks: 'bookmarks',
  favorites: 'favorites',
  highlights: 'highlights',
  readingDays: 'reading_days',
} as const;

const BOOKS_BUCKET = envId(process.env.APPWRITE_BOOKS_BUCKET_ID, 'parva_books');

export const BUCKETS = {
  /** Private. Book files are only ever served through a signed, expiring URL. */
  books: BOOKS_BUCKET,
  /**
   * Covers live in the same bucket by default.
   *
   * Appwrite Cloud's free plan allows exactly one bucket per project, so a
   * two-bucket design cannot run there at all. One private bucket holds both,
   * and covers reach the browser through /api/cover/[id], which fetches them
   * server-side with the API key. Set APPWRITE_COVERS_BUCKET_ID to split them
   * on a plan that allows more.
   */
  covers: envId(process.env.APPWRITE_COVERS_BUCKET_ID, BOOKS_BUCKET),
} as const;

/** True when one bucket is doing both jobs. */
export const SHARED_BUCKET = BUCKETS.books === BUCKETS.covers;

/** Appwrite label that grants access to /admin. Labels are server-set, so
 *  unlike a row field a user cannot grant it to themselves. */
export const ADMIN_LABEL = 'admin';

/** Name of the httpOnly cookie holding the Appwrite session secret. */
export const SESSION_COOKIE = 'parva_session';

/* ── Limits ─────────────────────────────────────────────────────────── */

export const LIMITS = {
  /**
   * Fallback ceiling, used only until /api/admin/limits reports what the
   * bucket really allows. Appwrite Cloud's free plan refuses anything over
   * 50,000,000 bytes — a decimal number, not 50 MiB — so that is the honest
   * default. It was 200 MiB, which meant the upload form would happily accept
   * a 120 MB book and let Appwrite reject it at the end of the transfer.
   */
  bookFileBytes: 50_000_000,
  coverFileBytes: 8 * 1024 * 1024,
  /** Appwrite rejects list queries above 100 per page. */
  pageSize: 24,
  maxPageSize: 100,
  /** Reading position is written at most this often while turning pages. */
  progressSaveMs: 2500,
  searchExcerptChars: 220,
} as const;

export const ACCEPTED_BOOK_EXTENSIONS = ['pdf', 'epub'] as const;
export const ACCEPTED_COVER_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'] as const;

/* ── Reader defaults ────────────────────────────────────────────────── */

export const READER_DEFAULTS = {
  /** 'spread' is the two-page bound-book view; 'single' one page; 'scroll'
   *  continuous vertical. Spread falls back to single below the breakpoint. */
  layout: 'spread' as ReaderLayout,
  /** Below this viewport width a spread is unreadable, so we force single. */
  spreadMinWidth: 1024,
  fit: 'page' as ReaderFit,
  zoom: 1,
  tone: 'paper' as ReaderTone,
  fontFamily: 'read-serif' as ReaderFontKey,
  fontScale: 1,
  lineHeight: 1.6,
  margin: 1,
  justify: false,
  /**
   * The chrome auto-hides after this long with no pointer, key, wheel or touch
   * activity, leaving nothing but the book and the progress hairline. Long
   * enough not to snatch the controls away while they are being read, short
   * enough that it gets out of the way on its own.
   */
  idleHideMs: 5000,
} as const;

export type ReaderLayout = 'spread' | 'single' | 'scroll';
export type ReaderFit = 'page' | 'width' | 'actual' | 'custom';
/** 'paper' is untouched white; 'sepia' warms it; 'dusk' dims; 'night' inverts.
 *  For PDF these map to pdf.js pageColors, not a CSS filter, so text stays crisp. */
export type ReaderTone = 'paper' | 'sepia' | 'dusk' | 'night';
export type ReaderFontKey = 'read-serif' | 'read-literary' | 'read-clear' | 'ui';

export const READER_FONTS: { key: ReaderFontKey; label: string; stack: string; note?: string }[] = [
  { key: 'read-serif', label: 'Newsreader', stack: 'var(--font-read-serif)' },
  { key: 'read-literary', label: 'Literata', stack: 'var(--font-read-literary)' },
  {
    key: 'read-clear',
    label: 'Atkinson Hyperlegible',
    stack: 'var(--font-read-clear)',
    note: 'Designed for low vision',
  },
  { key: 'ui', label: 'Archivo', stack: 'var(--font-ui)' },
];

export const READER_TONES: { key: ReaderTone; label: string; swatch: string }[] = [
  { key: 'paper', label: 'Paper', swatch: '#ffffff' },
  { key: 'sepia', label: 'Sepia', swatch: '#f6efe2' },
  { key: 'dusk', label: 'Dusk', swatch: '#dedbd6' },
  { key: 'night', label: 'Night', swatch: '#111111' },
];

/** Background / foreground pairs. For PDF these go to pdf.js `pageColors`,
 *  which recolours during rasterisation — far cleaner than filter: invert. */
export const TONE_COLORS: Record<ReaderTone, { background: string; foreground: string; surround: string }> = {
  paper: { background: '#ffffff', foreground: '#0a0a0a', surround: '#f6f6f6' },
  sepia: { background: '#f7f0e3', foreground: '#3b3226', surround: '#efe7d7' },
  dusk: { background: '#e2ded7', foreground: '#2a2823', surround: '#d6d2ca' },
  night: { background: '#111111', foreground: '#e6e6e6', surround: '#0a0a0a' },
};

/* ── Browse facets ──────────────────────────────────────────────────── */

export const SORTS = [
  { key: 'recent', label: 'Recently added' },
  { key: 'title', label: 'Title A–Z' },
  { key: 'author', label: 'Author A–Z' },
  { key: 'year', label: 'Newest published' },
  { key: 'popular', label: 'Most read' },
] as const;

export type SortKey = (typeof SORTS)[number]['key'];

export const BOOK_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'kn', label: 'Kannada' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'mr', label: 'Marathi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'ur', label: 'Urdu' },
  { code: 'sa', label: 'Sanskrit' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'es', label: 'Spanish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'other', label: 'Other' },
] as const;

export function languageLabel(code?: string | null) {
  if (!code) return null;
  return BOOK_LANGUAGES.find((l) => l.code === code)?.label ?? code.toUpperCase();
}
