'use client';

// Type-only, so epub.js is not pulled into the server bundle. Like pdf.js it
// touches browser globals when its module is evaluated, and these components —
// though Client Components — are still server-rendered for the initial HTML.
import type { Book as EpubBook, Rendition } from 'epubjs';
import type { Location as EpubLocation } from 'epubjs/types/rendition';

import { normalizeWhitespace } from '@/lib/utils';
import { TONE_COLORS, type ReaderFontKey, type ReaderTone } from '@/lib/config';
import type { SearchHit, TocItem } from '@/types';

/**
 * EPUB rendering, on epub.js.
 *
 * Reflowable text is a different problem from a fixed page: there are no page
 * numbers, only CFIs (canonical fragment identifiers) pointing into the spine.
 * Progress and "where you left off" therefore ride on a generated location
 * index rather than a page count, and the page numbers shown to the reader are
 * derived from that index so they stay stable when type size changes.
 *
 * epub.js renders each section inside an iframe, which is why fonts, theme and
 * selection all have to be injected rather than inherited.
 */

export type LoadedEpub = {
  book: EpubBook;
  title: string | null;
  author: string | null;
  /** Total generated locations. Stands in for a page count. */
  locationCount: number;
  coverUrl: string | null;
};

/** Roughly one printed page of characters. Fewer locations means a coarser
 *  progress bar; more means a slower first open. */
const CHARS_PER_LOCATION = 1024;

/**
 * Downloads the book, reporting progress as it goes.
 *
 * Streamed in chunks when the server sends a content-length, so the opening
 * screen can show a real percentage; falls back to a single read when it does
 * not.
 */
async function fetchBook(
  url: string,
  options: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal },
): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal: options.signal });

  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? 'That file is no longer in storage.'
        : 'The book could not be downloaded.',
    );
  }

  const total = Number(response.headers.get('content-length') ?? 0);

  if (!response.body || !total) return response.arrayBuffer();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.byteLength;
    options.onProgress?.(loaded, total);
  }

  // Concatenated into one buffer, because epub.js hands the whole thing to JSZip.
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes.buffer;
}

export async function loadEpub(
  source: string | ArrayBuffer,
  options: {
    cachedLocations?: string | null;
    onProgress?: (loaded: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<LoadedEpub> {
  /**
   * epub.js decides what it has been given by looking at the URL's file
   * extension. Our signed storage URLs end in `/view`, which has no extension —
   * and epub.js treats an extension-less URL as an *unpacked* book, so it would
   * go looking for `META-INF/container.xml` and fail.
   *
   * Handing it the bytes removes the guesswork entirely. An EPUB is a zip and
   * has to be read whole regardless, so nothing is lost by fetching it here —
   * and doing the fetch ourselves is what lets the opening screen show real
   * progress instead of a spinner.
   */
  const data = typeof source === 'string' ? await fetchBook(source, options) : source;

  const ePub = (await import('epubjs')).default;
  const book = ePub(data);

  await book.ready;

  const metadata = book.packaging?.metadata as { title?: string; creator?: string } | undefined;

  let coverUrl: string | null = null;
  try {
    coverUrl = await book.coverUrl();
  } catch {
    coverUrl = null;
  }

  // Generating locations walks the whole book. Reusing a saved index turns a
  // multi-second open into an instant one, which matters most on long books.
  if (options.cachedLocations) {
    try {
      book.locations.load(options.cachedLocations);
    } catch {
      await book.locations.generate(CHARS_PER_LOCATION);
    }
  } else {
    await book.locations.generate(CHARS_PER_LOCATION);
  }

  return {
    book,
    title: metadata?.title?.trim() || null,
    author: metadata?.creator?.trim() || null,
    locationCount: book.locations.length() || 0,
    coverUrl,
  };
}

/** The generated index, serialised so the next open can skip generation. */
export function serializeLocations(book: EpubBook): string | null {
  try {
    return book.locations.save();
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Rendition
   ═══════════════════════════════════════════════════════════════════ */

export type RenditionSetup = {
  book: EpubBook;
  element: HTMLElement;
  width: number;
  height: number;
  /** 'spread' shows two columns in one bound view; 'single' one; 'scroll' flows. */
  layout: 'spread' | 'single' | 'scroll';
};

export function createRendition({ book, element, width, height, layout }: RenditionSetup): Rendition {
  const rendition = book.renderTo(element, {
    width,
    height,
    // 'paginated' gives real page turns; 'scrolled-doc' is the continuous mode.
    flow: layout === 'scroll' ? 'scrolled-doc' : 'paginated',
    // 'always' forces two columns even when the viewport is narrow enough that
    // epub.js would drop to one; 'none' keeps a single column.
    spread: layout === 'spread' ? 'always' : 'none',
    // The default manager swaps sections in and out; 'default' keeps one
    // section mounted, which is what makes a page turn animatable.
    manager: layout === 'scroll' ? 'continuous' : 'default',
    // EPUBs are untrusted content. Scripts stay off.
    allowScriptedContent: false,
  });

  return rendition;
}

/* ═══════════════════════════════════════════════════════════════════
   Typography and tone

   Everything here has to be injected into the section iframe. `override` writes
   a rule with !important, which is the only reliable way past a publisher
   stylesheet that has opinions about body text.
   ═══════════════════════════════════════════════════════════════════ */

const FONT_STACKS: Record<ReaderFontKey, string> = {
  'read-serif': 'var(--font-read-serif), Georgia, serif',
  'read-literary': 'var(--font-read-literary), Georgia, serif',
  'read-clear': 'var(--font-read-clear), system-ui, sans-serif',
  ui: 'var(--font-ui), system-ui, sans-serif',
};

export type Typography = {
  tone: ReaderTone;
  fontFamily: ReaderFontKey;
  /** Multiplier on a 100% base. */
  fontScale: number;
  lineHeight: number;
  /** Multiplier on the side margins. */
  margin: number;
  justify: boolean;
};

export function applyTypography(rendition: Rendition, t: Typography) {
  const colors = TONE_COLORS[t.tone];

  // Registering under a stable name and re-selecting is how epub.js swaps a
  // whole theme without leaking the previous one's rules.
  rendition.themes.register('parva', {
    // The iframe has its own document, so the font variables have to be
    // restated here — they are not inherited across the frame boundary.
    ':root': {
      '--font-read-serif': 'Newsreader, Georgia, serif',
      '--font-read-literary': 'Literata, Georgia, serif',
      '--font-read-clear': '"Atkinson Hyperlegible", system-ui, sans-serif',
      '--font-ui': 'Archivo, system-ui, sans-serif',
    },
    body: {
      background: `${colors.background} !important`,
      color: `${colors.foreground} !important`,
      'font-family': `${FONT_STACKS[t.fontFamily]} !important`,
      'line-height': `${t.lineHeight} !important`,
      'text-align': t.justify ? 'justify !important' : 'left !important',
      hyphens: t.justify ? 'auto' : 'manual',
      'padding-left': `${Math.round(t.margin * 8)}px !important`,
      'padding-right': `${Math.round(t.margin * 8)}px !important`,
    },
    'p, li, blockquote, div': {
      'font-family': `${FONT_STACKS[t.fontFamily]} !important`,
      'line-height': `${t.lineHeight} !important`,
    },
    // Publisher headings keep their own face — overriding them flattens the
    // book's own typography, which is not ours to replace.
    'h1, h2, h3, h4, h5, h6': {
      color: `${colors.foreground} !important`,
    },
    a: { color: `${colors.foreground} !important` },
    // Images in a night theme should not glow.
    img: { 'max-width': '100% !important', height: 'auto !important' },
    '::selection': { background: 'rgba(255, 229, 133, 0.6)' },
  });

  rendition.themes.select('parva');
  rendition.themes.fontSize(`${Math.round(t.fontScale * 100)}%`);
}

/* ═══════════════════════════════════════════════════════════════════
   Position
   ═══════════════════════════════════════════════════════════════════ */

export type EpubPosition = {
  cfi: string;
  percent: number;
  /** Derived from the location index, so it survives a font-size change. */
  location: number;
  locationCount: number;
  /** Page within the current section, which is what epub.js can actually count. */
  sectionPage: number;
  sectionPages: number;
  href: string;
  atStart: boolean;
  atEnd: boolean;
};

export function readPosition(book: EpubBook, location: EpubLocation): EpubPosition {
  const cfi = location.start?.cfi ?? '';
  let percent = 0;
  let index = 0;

  try {
    percent = cfi ? book.locations.percentageFromCfi(cfi) * 100 : 0;
    index = Math.round((percent / 100) * (book.locations.length() || 1));
  } catch {
    percent = location.start?.percentage ? location.start.percentage * 100 : 0;
  }

  return {
    cfi,
    percent: Math.max(0, Math.min(100, percent)),
    location: index,
    locationCount: book.locations.length() || 0,
    sectionPage: location.start?.displayed?.page ?? 1,
    sectionPages: location.start?.displayed?.total ?? 1,
    href: location.start?.href ?? '',
    atStart: Boolean(location.atStart),
    atEnd: Boolean(location.atEnd),
  };
}

/* ═══════════════════════════════════════════════════════════════════
   Table of contents
   ═══════════════════════════════════════════════════════════════════ */

type NavItem = { id?: string; href: string; label: string; subitems?: NavItem[] };

export function readToc(book: EpubBook): TocItem[] {
  const toc = (book.navigation?.toc ?? []) as unknown as NavItem[];

  function walk(items: NavItem[], level: number, path: string): TocItem[] {
    return items.map((item, i) => {
      const id = item.id || `${path}${i}`;
      const children = item.subitems?.length ? walk(item.subitems, level + 1, `${id}-`) : undefined;
      return {
        id,
        label: normalizeWhitespace(item.label) || 'Untitled section',
        // EPUB targets are spine hrefs, which rendition.display() accepts.
        target: item.href,
        level,
        children,
      };
    });
  }

  return walk(toc, 0, '');
}

/* ═══════════════════════════════════════════════════════════════════
   Search

   epub.js can search a loaded section, so this walks the spine, loads each
   section, searches, then unloads it — otherwise a long book would hold every
   section's DOM in memory at once.
   ═══════════════════════════════════════════════════════════════════ */

type SpineSection = {
  href: string;
  load: (request?: unknown) => Promise<unknown>;
  find: (query: string) => { cfi: string; excerpt: string }[];
  unload: () => void;
};

export async function searchEpub(
  book: EpubBook,
  query: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (hits: SearchHit[], scanned: number, total: number) => void;
    maxHits?: number;
  } = {},
): Promise<SearchHit[]> {
  const needle = query.trim();
  if (needle.length < 2) return [];

  const maxHits = options.maxHits ?? 300;
  const sections: SpineSection[] = [];

  // Spine.each is untyped in epub.js's own definitions; collect first so the
  // async work below is a normal loop rather than a callback pyramid.
  book.spine.each((section: SpineSection) => {
    sections.push(section);
  });

  const hits: SearchHit[] = [];
  let scanned = 0;

  for (const section of sections) {
    if (options.signal?.aborted) break;

    try {
      await section.load(book.load.bind(book));
      const found = section.find(needle) ?? [];

      for (const item of found) {
        const excerpt = normalizeWhitespace(item.excerpt ?? '');
        // epub.js does not report the match offset, so find it in the excerpt
        // it gave us — case-insensitively, since it matched that way.
        const at = excerpt.toLowerCase().indexOf(needle.toLowerCase());

        let page: number | null = null;
        try {
          page = Math.round(book.locations.percentageFromCfi(item.cfi) * (book.locations.length() || 1));
        } catch {
          page = null;
        }

        hits.push({
          id: item.cfi,
          locator: item.cfi,
          page,
          excerpt,
          matchStart: at >= 0 ? at : 0,
          matchLength: needle.length,
        });

        if (hits.length >= maxHits) break;
      }
    } catch {
      // A section that will not load is skipped rather than failing the search.
    } finally {
      try {
        section.unload();
      } catch {
        // Nothing to release.
      }
    }

    scanned += 1;
    options.onProgress?.([...hits], scanned, sections.length);
    if (hits.length >= maxHits) break;
    // Yield so typing stays responsive.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return hits;
}

/* ═══════════════════════════════════════════════════════════════════
   Highlights
   ═══════════════════════════════════════════════════════════════════ */

const HIGHLIGHT_FILL: Record<string, string> = {
  marker: 'rgba(255, 229, 133, 0.55)',
  ribbon: 'rgba(193, 18, 31, 0.22)',
  ink: 'rgba(10, 10, 10, 0.14)',
};

export function paintHighlight(
  rendition: Rendition,
  cfiRange: string,
  color: string,
  onClick?: () => void,
) {
  try {
    rendition.annotations.add(
      'highlight',
      cfiRange,
      {},
      onClick,
      'parva-highlight',
      // epub.js applies these as SVG attributes on the highlight rect.
      { fill: HIGHLIGHT_FILL[color] ?? HIGHLIGHT_FILL.marker, 'fill-opacity': '1', 'mix-blend-mode': 'multiply' },
    );
  } catch {
    // A CFI that no longer resolves (the file was replaced) is skipped.
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Teardown
   ═══════════════════════════════════════════════════════════════════ */

export function destroyEpub(rendition: Rendition | null, book: EpubBook | null) {
  try {
    rendition?.destroy();
  } catch {
    // Already destroyed.
  }
  try {
    book?.destroy();
  } catch {
    // Already destroyed.
  }
}
