import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Decomposes and strips combining marks, so a title typed with diacritics
 * matches one typed without. `\p{M}` covers every combining mark, not just
 * the Latin block, which matters for the Indic titles in this collection.
 */
export function foldDiacritics(input: string): string {
  return input.normalize('NFKD').replace(/\p{M}/gu, '');
}

/* ═══════════════════════════════════════════════════════════════════
   Slugs
   ═══════════════════════════════════════════════════════════════════ */

/**
 * URL slug from a title. Keeps Unicode letters and numbers — so a Hindi or
 * Kannada title survives rather than collapsing to nothing — but strips
 * punctuation and collapses whitespace.
 */
export function slugify(input: string): string {
  return foldDiacritics(input)
    .toLowerCase()
    .replace(/['‘’"“”]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
    .replace(/-+$/, '');
}

/** Appends -2, -3 … until the slug is free. */
export function uniqueSlug(base: string, taken: Set<string>): string {
  const root = base || 'untitled';
  if (!taken.has(root)) return root;
  let n = 2;
  while (taken.has(`${root}-${n}`)) n += 1;
  return `${root}-${n}`;
}

/* ═══════════════════════════════════════════════════════════════════
   Formatting
   ═══════════════════════════════════════════════════════════════════ */

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** "3 hr 12 min", "12 min", "40 sec" — no zero-padding, no false precision. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} sec`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hours} hr ${rem} min` : `${hours} hr`;
}

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.348],
  ['month', 12],
  ['year', Infinity],
];

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  let delta = (then - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  for (const [unit, span] of RELATIVE_STEPS) {
    if (Math.abs(delta) < span) return rtf.format(Math.round(delta), unit);
    delta /= span;
  }
  return rtf.format(Math.round(delta), 'year');
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Rilke", "Rilke & Kafka", "Rilke, Kafka & 2 more" */
export function formatAuthors(authors: string[] | null | undefined, max = 2): string {
  const list = (authors ?? []).filter(Boolean);
  if (!list.length) return 'Unknown author';
  if (list.length <= max) {
    return list.length === 1 ? list[0]! : `${list.slice(0, -1).join(', ')} & ${list.at(-1)}`;
  }
  return `${list.slice(0, max).join(', ')} & ${list.length - max} more`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Rounds to a set number of decimals without exponent notation. */
export function round(value: number, places = 2) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/* ═══════════════════════════════════════════════════════════════════
   Reading estimates
   ═══════════════════════════════════════════════════════════════════ */

/** Median adult prose speed. Used only until we have measured the reader. */
export const DEFAULT_WORDS_PER_MINUTE = 240;
/** Rough words-per-page for a typical trade paperback. */
export const WORDS_PER_PAGE = 280;

export function estimateMinutesLeft(pagesLeft: number, wordsPerMinute = DEFAULT_WORDS_PER_MINUTE) {
  if (pagesLeft <= 0) return 0;
  return Math.round((pagesLeft * WORDS_PER_PAGE) / Math.max(80, wordsPerMinute));
}

/** "About 40 min left", "About 4 hr left", "A few pages left" */
export function describeTimeLeft(minutes: number): string {
  if (minutes <= 0) return 'Finished';
  if (minutes < 3) return 'A few pages left';
  if (minutes < 60) return `About ${minutes} min left`;
  const hours = Math.round(minutes / 60);
  return `About ${pluralize(hours, 'hr')} left`;
}

/* ═══════════════════════════════════════════════════════════════════
   Timing
   ═══════════════════════════════════════════════════════════════════ */

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  /** Runs the pending call now. Used when the tab is closing. */
  wrapped.flush = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    fn(...args);
  };
  return wrapped;
}

/* ═══════════════════════════════════════════════════════════════════
   Text
   ═══════════════════════════════════════════════════════════════════ */

/** Collapses runs of whitespace, including the odd spacing pdf.js emits. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A window of text around a match, plus the offset of the match inside that
 * window so the caller can mark it. Prefers word boundaries so an excerpt
 * never starts mid-word.
 */
export function excerptAround(
  text: string,
  matchIndex: number,
  matchLength: number,
  window = 220,
): { excerpt: string; matchStart: number; matchLength: number } {
  const before = Math.floor((window - matchLength) / 2);
  let start = Math.max(0, matchIndex - before);
  let end = Math.min(text.length, start + window);
  start = Math.max(0, Math.min(start, end - window));

  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space > -1 && space < matchIndex) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > matchIndex + matchLength) end = space;
  }

  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';

  return {
    excerpt: prefix + text.slice(start, end) + suffix,
    matchStart: matchIndex - start + prefix.length,
    matchLength,
  };
}

/** Case- and diacritic-insensitive contains, for client-side filtering. */
export function looseIncludes(haystack: string, needle: string): boolean {
  return foldDiacritics(haystack).toLowerCase().includes(foldDiacritics(needle).toLowerCase());
}

/* ═══════════════════════════════════════════════════════════════════
   Colour
   ═══════════════════════════════════════════════════════════════════ */

/** #abc → #aabbcc; null for anything that is not a hex colour. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const hex = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex
      .split('')
      .map((c) => c + c)
      .join('')}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  return null;
}

/** Relative luminance, per WCAG. Used to pick ink that reads on --bloom. */
export function luminance(hex: string): number {
  const normalized = normalizeHex(hex) ?? '#808080';
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(normalized.slice(1, 3), 16));
  const g = channel(parseInt(normalized.slice(3, 5), 16));
  const b = channel(parseInt(normalized.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black or white, whichever is legible on the given background. */
export function readableInk(hex: string): '#0a0a0a' | '#ffffff' {
  return luminance(hex) > 0.45 ? '#0a0a0a' : '#ffffff';
}

/* ═══════════════════════════════════════════════════════════════════
   Misc
   ═══════════════════════════════════════════════════════════════════ */

/** Count desc, then value asc — the order a facet list should read in. */
export function sortFacet<T extends { value: string | number; count: number }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)),
  );
}
