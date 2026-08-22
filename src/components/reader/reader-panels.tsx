'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Book as EpubBook } from 'epubjs';
import { Bookmark, Highlighter, Loader2, Search, Trash2, X } from 'lucide-react';

import { IconButton } from '@/components/ui/button';
import { READER_FONTS, READER_TONES } from '@/lib/config';
import { useReaderSettings } from '@/lib/reader/store';
import { renderThumbnail, searchPdf } from '@/lib/reader/pdf-engine';
import { searchEpub } from '@/lib/reader/epub-engine';
import { cn, clamp, formatRelative } from '@/lib/utils';
import type { Book, BookmarkRow, HighlightRow, ReaderPosition, SearchHit, TocItem } from '@/types';

export type PanelKey =
  | 'contents'
  | 'search'
  | 'bookmarks'
  | 'highlights'
  | 'thumbnails'
  | 'settings'
  | 'shortcuts';

const TITLES: Record<PanelKey, string> = {
  contents: 'Contents',
  search: 'Search in this book',
  bookmarks: 'Bookmarks',
  highlights: 'Highlights',
  thumbnails: 'Pages',
  settings: 'Reading settings',
  shortcuts: 'Keyboard',
};

/**
 * All reader panels share one drawer. They are mutually exclusive by design —
 * two open panels would leave a sliver of book between them, and the book is
 * the point.
 */
export function ReaderPanels(props: {
  open: PanelKey | null;
  onClose: () => void;
  book: Book;
  isPdf: boolean;
  pdfDoc: PDFDocumentProxy | null;
  epubBook: EpubBook | null;
  toc: TocItem[];
  bookmarks: BookmarkRow[];
  highlights: HighlightRow[];
  position: ReaderPosition;
  onGoToToc: (item: TocItem) => void;
  onGoToLocator: (locator: string | number) => void;
  onGoToPage: (page: number) => void;
  onRemoveBookmark: (id: string) => void;
  onRemoveHighlight: (id: string) => void;
}) {
  const { open, onClose } = props;

  // Escape is handled by the shell's hotkeys so there is one owner of it.
  return (
    <>
      <div
        className={cn(
          'absolute inset-0 z-50 bg-ink/10 transition-opacity duration-300',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="false"
        aria-label={open ? TITLES[open] : 'Reader panel'}
        className={cn(
          'safe-t safe-b absolute inset-y-0 right-0 z-60 flex w-[min(24rem,100vw)] flex-col border-l border-ink bg-paper transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        // The panel scrolls natively — Lenis inertia inside a list of 900 page
        // thumbnails feels broken.
        data-lenis-prevent
      >
        <header className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <h2 className="label-ink">{open ? TITLES[open] : ''}</h2>
          <IconButton label="Close panel" size="sm" onClick={onClose}>
            <X className="size-4" strokeWidth={1.5} />
          </IconButton>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {open === 'contents' && <ContentsPanel {...props} />}
          {open === 'search' && <SearchPanel {...props} />}
          {open === 'bookmarks' && <BookmarksPanel {...props} />}
          {open === 'highlights' && <HighlightsPanel {...props} />}
          {open === 'thumbnails' && <ThumbnailsPanel {...props} />}
          {open === 'settings' && <SettingsPanel isPdf={props.isPdf} />}
          {open === 'shortcuts' && <ShortcutsPanel />}
        </div>
      </aside>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Contents
   ═══════════════════════════════════════════════════════════════════ */

function ContentsPanel({
  toc,
  position,
  isPdf,
  onGoToToc,
}: {
  toc: TocItem[];
  position: ReaderPosition;
  isPdf: boolean;
  onGoToToc: (item: TocItem) => void;
}) {
  if (!toc.length) {
    return (
      <Empty
        title="No contents in this file"
        body="This book has no embedded table of contents. Use search or the page thumbnails to move around."
      />
    );
  }

  function render(items: TocItem[]): React.ReactNode {
    return items.map((item) => {
      // Highlight the section the reader is actually in, which for a PDF means
      // the last entry at or before the current page.
      const active = isPdf && typeof item.target === 'number' && item.target === position.page;
      return (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onGoToToc(item)}
            className={cn(
              'flex w-full items-baseline gap-3 px-4 py-2 text-left text-[0.8125rem] transition-colors hover:bg-wash',
              active ? 'bg-wash text-ink' : 'text-ink-soft',
            )}
            style={{ paddingLeft: `${16 + item.level * 14}px` }}
          >
            <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
            {typeof item.target === 'number' && (
              <span className="shrink-0 text-[0.6875rem] text-mute tnum">{item.target}</span>
            )}
          </button>
          {item.children?.length ? <ul>{render(item.children)}</ul> : null}
        </li>
      );
    });
  }

  return <ul className="py-2">{render(toc)}</ul>;
}

/* ═══════════════════════════════════════════════════════════════════
   Search
   ═══════════════════════════════════════════════════════════════════ */

function SearchPanel({
  isPdf,
  pdfDoc,
  epubBook,
  position,
  onGoToLocator,
}: {
  isPdf: boolean;
  pdfDoc: PDFDocumentProxy | null;
  epubBook: EpubBook | null;
  position: ReaderPosition;
  onGoToLocator: (locator: string | number) => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ scanned: 0, total: 0 });
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  // Search is debounced and cancellable: extracting text from a 900-page book
  // takes seconds, and every keystroke must abandon the previous pass.
  useEffect(() => {
    controller.current?.abort();
    const term = query.trim();

    // Every state write below happens inside the timer or a promise callback.
    // Clearing results synchronously here would be a cascading render on every
    // keystroke, and the 320 ms wait makes it invisible anyway.
    const timer = setTimeout(() => {
      if (term.length < 2) {
        setHits([]);
        setScanning(false);
        setProgress({ scanned: 0, total: 0 });
        return;
      }

      const ac = new AbortController();
      controller.current = ac;
      setScanning(true);
      setHits([]);

      const run = isPdf
        ? pdfDoc
          ? searchPdf(pdfDoc, term, {
              signal: ac.signal,
              startPage: position.page,
              onProgress: ({ hits: found, pagesScanned, pageCount }) => {
                if (ac.signal.aborted) return;
                setHits(found);
                setProgress({ scanned: pagesScanned, total: pageCount });
              },
            })
          : Promise.resolve([])
        : epubBook
          ? searchEpub(epubBook, term, {
              signal: ac.signal,
              onProgress: (found, scanned, total) => {
                if (ac.signal.aborted) return;
                setHits(found);
                setProgress({ scanned, total });
              },
            })
          : Promise.resolve([]);

      void run
        .then((found) => {
          if (!ac.signal.aborted) setHits(found);
        })
        .finally(() => {
          if (!ac.signal.aborted) setScanning(false);
        });
    }, 320);

    return () => {
      clearTimeout(timer);
      controller.current?.abort();
    };
  }, [query, isPdf, pdfDoc, epubBook, position.page]);

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-rule bg-paper px-4 py-3">
        <div className="flex items-center gap-2 border border-rule px-2.5 focus-within:border-ink">
          <Search className="size-3.5 shrink-0 text-graphite" strokeWidth={1.5} />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a word or phrase"
            aria-label="Search inside this book"
            className="h-9 flex-1 bg-transparent text-[0.8125rem] outline-none placeholder:text-mute"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="shrink-0 text-mute hover:text-ink"
            >
              <X className="size-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>

        {(scanning || hits.length > 0) && (
          <p className="mt-2 flex items-center gap-2 text-[0.6875rem] text-graphite">
            {scanning && <Loader2 className="size-3 animate-spin" strokeWidth={2} />}
            {hits.length > 0
              ? `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`
              : 'Searching'}
            {scanning && progress.total > 0 && (
              <span className="tnum">
                · {progress.scanned}/{progress.total}
              </span>
            )}
          </p>
        )}
      </div>

      {!scanning && query.trim().length >= 2 && hits.length === 0 && (
        <Empty title={`No matches for “${query.trim()}”`} body="Try a shorter phrase, or check the spelling." />
      )}

      {query.trim().length < 2 && (
        <Empty
          title="Search this book"
          body="Type at least two characters. Results start from the page you are on and work outwards."
        />
      )}

      <ul>
        {hits.map((hit) => (
          <li key={hit.id}>
            <button
              type="button"
              onClick={() => onGoToLocator(hit.locator)}
              className="block w-full border-b border-rule-soft px-4 py-3 text-left transition-colors hover:bg-wash"
            >
              {hit.page !== null && (
                <span className="label mb-1.5 block">
                  {isPdf ? `Page ${hit.page}` : `${Math.round((hit.page / Math.max(1, position.totalPages)) * 100)}%`}
                </span>
              )}
              <span className="block text-[0.8125rem] leading-relaxed text-ink-soft">
                {hit.excerpt.slice(0, hit.matchStart)}
                <mark className="bg-marker text-ink">
                  {hit.excerpt.slice(hit.matchStart, hit.matchStart + hit.matchLength)}
                </mark>
                {hit.excerpt.slice(hit.matchStart + hit.matchLength)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Bookmarks & highlights
   ═══════════════════════════════════════════════════════════════════ */

function BookmarksPanel({
  bookmarks,
  isPdf,
  onGoToLocator,
  onRemoveBookmark,
}: {
  bookmarks: BookmarkRow[];
  isPdf: boolean;
  onGoToLocator: (locator: string | number) => void;
  onRemoveBookmark: (id: string) => void;
}) {
  if (!bookmarks.length) {
    return (
      <Empty
        title="No bookmarks yet"
        body="Press B while reading, or use the filled bookmark in the top bar. A red ribbon drops down to confirm."
        icon={<Bookmark className="size-5" strokeWidth={1.25} />}
      />
    );
  }

  return (
    <ul>
      {bookmarks.map((mark) => (
        <li key={mark.$id} className="group border-b border-rule-soft">
          <div className="flex items-start gap-2 px-4 py-3">
            <button
              type="button"
              onClick={() => onGoToLocator(isPdf ? (mark.page ?? 1) : mark.position)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="label mb-1.5 block">
                {isPdf && mark.page ? `Page ${mark.page}` : `${Math.round(mark.percent)}%`}
                <span className="ml-2 normal-case tracking-normal text-mute">
                  {formatRelative(mark.$createdAt)}
                </span>
              </span>
              <span className="block text-[0.8125rem] leading-relaxed text-ink-soft">
                {mark.label || 'Bookmarked spot'}
              </span>
              {mark.note && <span className="mt-1 block text-[0.75rem] text-graphite italic">{mark.note}</span>}
            </button>

            <button
              type="button"
              onClick={() => onRemoveBookmark(mark.$id)}
              aria-label="Remove this bookmark"
              className="shrink-0 p-1 text-mute opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-ribbon"
            >
              <Trash2 className="size-3.5" strokeWidth={1.5} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function HighlightsPanel({
  highlights,
  isPdf,
  onGoToLocator,
  onRemoveHighlight,
}: {
  highlights: HighlightRow[];
  isPdf: boolean;
  onGoToLocator: (locator: string | number) => void;
  onRemoveHighlight: (id: string) => void;
}) {
  if (!highlights.length) {
    return (
      <Empty
        title="Nothing marked yet"
        body="Select any passage while reading and choose Highlight. Marked passages collect here."
        icon={<Highlighter className="size-5" strokeWidth={1.25} />}
      />
    );
  }

  return (
    <ul>
      {highlights.map((highlight) => (
        <li key={highlight.$id} className="group border-b border-rule-soft">
          <div className="flex items-start gap-2 px-4 py-3">
            <button
              type="button"
              onClick={() => onGoToLocator(isPdf ? (highlight.page ?? 1) : highlight.position)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="label mb-1.5 block">
                {isPdf && highlight.page ? `Page ${highlight.page}` : `${Math.round(highlight.percent)}%`}
              </span>
              <span className="block border-l-2 border-marker-deep pl-2.5 text-[0.8125rem] leading-relaxed text-ink-soft">
                {highlight.text}
              </span>
              {highlight.note && (
                <span className="mt-1.5 block text-[0.75rem] text-graphite italic">{highlight.note}</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => onRemoveHighlight(highlight.$id)}
              aria-label="Remove this highlight"
              className="shrink-0 p-1 text-mute opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-ribbon"
            >
              <Trash2 className="size-3.5" strokeWidth={1.5} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Thumbnails
   ═══════════════════════════════════════════════════════════════════ */

function ThumbnailsPanel({
  pdfDoc,
  position,
  onGoToPage,
  book,
}: {
  pdfDoc: PDFDocumentProxy | null;
  position: ReaderPosition;
  onGoToPage: (page: number) => void;
  book: Book;
}) {
  if (!pdfDoc) {
    return (
      <Empty
        title="Pages are not fixed in this format"
        body="EPUB text reflows to fit your type size, so there are no page images. Use the contents panel to move between chapters."
      />
    );
  }
  return <PdfThumbnails doc={pdfDoc} position={position} onGoToPage={onGoToPage} cacheKey={book.$id} />;
}

function PdfThumbnails({
  doc,
  position,
  onGoToPage,
  cacheKey,
}: {
  doc: PDFDocumentProxy;
  position: ReaderPosition;
  onGoToPage: (page: number) => void;
  cacheKey: string;
}) {
  // Thumbnails are rasterised on demand as they scroll into view — rendering
  // 900 of them up front would lock the tab for a minute.
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [urls, setUrls] = useState<Record<number, string>>({});
  const container = useRef<HTMLDivElement>(null);

  const pages = useMemo(
    () => Array.from({ length: doc.numPages }, (_, i) => i + 1),
    [doc.numPages],
  );

  useEffect(() => {
    const root = container.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const page = Number((entry.target as HTMLElement).dataset.page);
              if (page) next.add(page);
            }
          }
          return next;
        });
      },
      { root, rootMargin: '320px 0px' },
    );

    for (const child of Array.from(root.querySelectorAll('[data-page]'))) observer.observe(child);
    return () => observer.disconnect();
  }, [pages.length]);

  useEffect(() => {
    let cancelled = false;
    const pending = Array.from(visible).filter((page) => !urls[page]);
    if (!pending.length) return;

    void (async () => {
      for (const page of pending) {
        if (cancelled) return;
        const url = await renderThumbnail(doc, page, 128, cacheKey);
        if (cancelled || !url) continue;
        setUrls((current) => ({ ...current, [page]: url }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, urls, doc, cacheKey]);

  // Keep the current page in view when the panel opens.
  useEffect(() => {
    container.current
      ?.querySelector(`[data-page="${position.page}"]`)
      ?.scrollIntoView({ block: 'center' });
    // Only on open, not on every page turn — that would fight a reader who is
    // scrolling the strip to look somewhere else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={container} className="grid grid-cols-3 gap-2 p-4">
      {pages.map((page) => {
        const active = page === position.page;
        return (
          <button
            key={page}
            data-page={page}
            type="button"
            onClick={() => onGoToPage(page)}
            className={cn(
              'group flex flex-col items-center gap-1.5 border p-1.5 transition-colors',
              active ? 'border-ink bg-wash' : 'border-transparent hover:border-rule',
            )}
          >
            <span className="block w-full bg-wash" style={{ aspectRatio: '0.7' }}>
              {urls[page] ? (
                // A plain img: these are already-sized data URLs, so next/image
                // would add an optimisation pass that does nothing here.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={urls[page]} alt="" className="h-full w-full object-contain" />
              ) : null}
            </span>
            <span className={cn('text-[0.625rem] tnum', active ? 'text-ink' : 'text-mute')}>{page}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Settings
   ═══════════════════════════════════════════════════════════════════ */

function SettingsPanel({ isPdf }: { isPdf: boolean }) {
  const settings = useReaderSettings();

  return (
    <div className="divide-y divide-rule">
      <Field label="Page layout">
        <Segmented
          value={settings.layout}
          onChange={(value) => settings.set('layout', value)}
          options={[
            { value: 'spread', label: 'Two pages' },
            { value: 'single', label: 'One page' },
            { value: 'scroll', label: 'Scroll' },
          ]}
        />
        <Hint>Two pages needs a wide window; narrow screens fall back to one.</Hint>
      </Field>

      <Field label="Tone">
        <div className="flex gap-2">
          {READER_TONES.map((tone) => (
            <button
              key={tone.key}
              type="button"
              onClick={() => settings.set('tone', tone.key)}
              aria-label={tone.label}
              aria-pressed={settings.tone === tone.key}
              className={cn(
                'flex flex-1 flex-col items-center gap-1.5 border p-2 transition-colors',
                settings.tone === tone.key ? 'border-ink' : 'border-rule hover:border-mute',
              )}
            >
              <span
                className="h-8 w-full border border-rule"
                style={{ background: tone.swatch }}
                aria-hidden="true"
              />
              <span className="text-[0.625rem] tracking-[0.08em] uppercase">{tone.label}</span>
            </button>
          ))}
        </div>
        <Hint>
          {isPdf
            ? 'Recolours during rendering, so photographs and diagrams stay readable rather than inverting.'
            : 'Applies to the book’s text without touching its own headings.'}
        </Hint>
      </Field>

      {isPdf ? (
        <>
          <Field label="Fit">
            <Segmented
              value={settings.fit}
              onChange={(value) => settings.set('fit', value)}
              options={[
                { value: 'page', label: 'Whole page' },
                { value: 'width', label: 'Fit width' },
                { value: 'actual', label: 'Actual size' },
              ]}
            />
          </Field>

          <Field label={`Zoom · ${Math.round(settings.zoom * 100)}%`}>
            <Slider
              min={0.4}
              max={4}
              step={0.05}
              value={settings.zoom}
              onChange={(value) => settings.set('zoom', value)}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="Reading face">
            <div className="space-y-1">
              {READER_FONTS.map((font) => (
                <button
                  key={font.key}
                  type="button"
                  onClick={() => settings.set('fontFamily', font.key)}
                  className={cn(
                    'flex w-full items-baseline justify-between gap-3 border px-3 py-2 text-left transition-colors',
                    settings.fontFamily === font.key ? 'border-ink' : 'border-rule hover:border-mute',
                  )}
                >
                  <span className="text-[0.9375rem]" style={{ fontFamily: font.stack }}>
                    {font.label}
                  </span>
                  {font.note && <span className="shrink-0 text-[0.625rem] text-mute">{font.note}</span>}
                </button>
              ))}
            </div>
          </Field>

          <Field label={`Text size · ${Math.round(settings.fontScale * 100)}%`}>
            <Slider
              min={0.7}
              max={2.4}
              step={0.05}
              value={settings.fontScale}
              onChange={(value) => settings.set('fontScale', value)}
            />
          </Field>

          <Field label={`Line spacing · ${settings.lineHeight.toFixed(2)}`}>
            <Slider
              min={1.1}
              max={2.4}
              step={0.05}
              value={settings.lineHeight}
              onChange={(value) => settings.set('lineHeight', value)}
            />
          </Field>

          <Field label={`Margins · ${settings.margin.toFixed(1)}×`}>
            <Slider
              min={0}
              max={6}
              step={0.5}
              value={settings.margin}
              onChange={(value) => settings.set('margin', value)}
            />
          </Field>

          <Field label="Justify text">
            <Toggle
              checked={settings.justify}
              onChange={(value) => settings.set('justify', value)}
              label="Justify text"
            />
            <Hint>Justified text with hyphenation, as a printed book sets it.</Hint>
          </Field>
        </>
      )}

      <Field label="Animate page turns">
        <Toggle
          checked={settings.animatePageTurn}
          onChange={(value) => settings.set('animatePageTurn', value)}
          label="Animate page turns"
        />
        <Hint>Turned off automatically if your system asks for reduced motion.</Hint>
      </Field>

      <Field label={`Read-aloud speed · ${settings.speechRate.toFixed(1)}×`}>
        <Slider
          min={0.5}
          max={2.5}
          step={0.1}
          value={settings.speechRate}
          onChange={(value) => settings.set('speechRate', value)}
        />
      </Field>

      <div className="p-4">
        <button
          type="button"
          onClick={() => settings.reset()}
          className="link-rule text-[0.75rem] text-graphite hover:text-ink"
        >
          Reset reading settings
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Shortcuts
   ═══════════════════════════════════════════════════════════════════ */

const SHORTCUTS: [string, string][] = [
  ['→ · ↓ · Space · PgDn', 'Next page'],
  ['← · ↑ · PgUp', 'Previous page'],
  ['Home · End', 'First · last page'],
  ['B', 'Bookmark this spot'],
  ['T', 'Contents'],
  ['S', 'Search in book'],
  ['M', 'Bookmarks'],
  ['H', 'Highlights'],
  ['G', 'Reading settings'],
  ['F', 'Full screen'],
  ['+ · −', 'Zoom in · out'],
  ['0', 'Reset zoom'],
  ['?', 'This list'],
  ['Esc', 'Close panel, or leave the book'],
];

function ShortcutsPanel() {
  return (
    <dl className="divide-y divide-rule-soft">
      {SHORTCUTS.map(([keys, action]) => (
        <div key={keys} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
          <dt className="shrink-0 font-mono text-[0.6875rem] text-ink">{keys}</dt>
          <dd className="text-right text-[0.8125rem] text-graphite">{action}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Small shared pieces
   ═══════════════════════════════════════════════════════════════════ */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-4">
      <p className="label mb-3">{label}</p>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-2.5 text-[0.6875rem] leading-relaxed text-mute">{children}</p>;
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex border border-rule">
      {options.map((option, i) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'flex-1 px-2 py-2 text-[0.75rem] transition-colors',
            i > 0 && 'border-l border-rule',
            value === option.value ? 'ink-fill' : 'text-graphite hover:bg-wash hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  min,
  max,
  step,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const filled = ((value - min) / (max - min)) * 100;
  return (
    <div className="relative flex h-6 items-center">
      <div className="pointer-events-none absolute inset-x-0 h-[3px] bg-rule">
        <div className="h-full bg-ink" style={{ width: `${clamp(filled, 0, 100)}%` }} />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="relative z-10 h-6 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-ink [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-ink"
      />
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('flex h-6 w-11 items-center border p-0.5 transition-colors', checked ? 'border-ink bg-ink' : 'border-rule bg-transparent')}
    >
      <span
        className={cn('size-4 transition-transform', checked ? 'translate-x-5 bg-paper' : 'translate-x-0 bg-mute')}
      />
    </button>
  );
}

function Empty({
  title,
  body,
  icon,
}: {
  title: string;
  body: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="px-6 py-14 text-center">
      {icon && <div className="mx-auto mb-4 text-faint">{icon}</div>}
      <p className="display text-[1.0625rem]">{title}</p>
      <p className="mt-2 text-[0.8125rem] leading-relaxed text-graphite">{body}</p>
    </div>
  );
}
