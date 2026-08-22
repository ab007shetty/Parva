'use client';

import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Book as EpubBook, Rendition } from 'epubjs';
import type { Location as EpubLocation } from 'epubjs/types/rendition';

import {
  applyTypography,
  createRendition,
  paintHighlight,
  readPosition,
  type EpubPosition,
} from '@/lib/reader/epub-engine';
import { TONE_COLORS, type ReaderLayout } from '@/lib/config';
import type { HighlightRow, ReaderSettings } from '@/types';

/**
 * The EPUB viewport.
 *
 * epub.js paints each section into an iframe it owns, so this component's job is
 * mostly plumbing: give it a correctly sized box, re-create the rendition when
 * the layout changes (spread ↔ single ↔ scroll cannot be switched in place),
 * push typography through on every settings change, and translate its
 * `relocated` events into the position shape the rest of the reader speaks.
 */

export type EpubViewHandle = {
  next: () => void;
  previous: () => void;
  goToCfi: (cfi: string) => void;
  goToHref: (href: string) => void;
  goToPercent: (percent: number) => void;
  /** Visible text of the current view, for read-aloud. */
  visibleText: () => string;
  rendition: () => Rendition | null;
};

export function EpubView({
  book,
  settings,
  layout,
  highlights,
  initialCfi,
  onPosition,
  onSelection,
  onReady,
  ref,
}: {
  book: EpubBook;
  settings: ReaderSettings;
  layout: ReaderLayout;
  highlights: HighlightRow[];
  initialCfi?: string | null;
  onPosition: (position: EpubPosition) => void;
  onSelection?: (payload: { cfiRange: string; text: string }) => void;
  onReady?: () => void;
  ref?: React.Ref<EpubViewHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  // Kept in refs so the epub.js handlers always call the latest callback
  // without being re-bound — re-binding would mean re-creating the rendition,
  // which would reload the section and lose the reader's place. Written in an
  // effect rather than during render so the refs are only mutated after commit.
  const onPositionRef = useRef(onPosition);
  const onSelectionRef = useRef(onSelection);

  useEffect(() => {
    onPositionRef.current = onPosition;
    onSelectionRef.current = onSelection;
  });

  /* ── Measure ──────────────────────────────────────────────────── */

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setBox({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* ── Rendition lifecycle ──────────────────────────────────────── */

  // Re-created when the layout or the box changes. epub.js cannot switch
  // between paginated and scrolled flow on a live rendition, and its own
  // `resize` mishandles a spread→single transition, so a clean rebuild is both
  // simpler and more reliable.
  useEffect(() => {
    const el = host.current;
    if (!el || !box.width || !box.height) return;

    // Remember where we were so a rebuild does not send the reader to page one.
    const resumeAt =
      (renditionRef.current?.currentLocation() as EpubLocation | undefined)?.start?.cfi ??
      initialCfi ??
      undefined;

    el.replaceChildren();

    const rendition = createRendition({
      book,
      element: el,
      width: box.width,
      height: box.height,
      layout: layout === 'scroll' ? 'scroll' : layout === 'spread' ? 'spread' : 'single',
    });
    renditionRef.current = rendition;

    applyTypography(rendition, {
      tone: settings.tone,
      fontFamily: settings.fontFamily,
      fontScale: settings.fontScale,
      lineHeight: settings.lineHeight,
      margin: settings.margin,
      justify: settings.justify,
    });

    rendition.on('relocated', (location: EpubLocation) => {
      onPositionRef.current(readPosition(book, location));
    });

    rendition.on('selected', (cfiRange: string, contents: { window: Window }) => {
      const text = contents.window.getSelection()?.toString() ?? '';
      if (text.trim()) onSelectionRef.current?.({ cfiRange, text: text.trim() });
    });

    void rendition.display(resumeAt).then(() => {
      // Re-apply saved highlights: annotations live on the rendition, so a
      // rebuild loses them.
      for (const highlight of highlights) {
        paintHighlight(rendition, highlight.position, highlight.color);
      }
      onReady?.();
    });

    return () => {
      try {
        rendition.destroy();
      } catch {
        // Already gone.
      }
      renditionRef.current = null;
    };
    // Typography and highlights are pushed by their own effects below; including
    // them here would rebuild the rendition on every font-size nudge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, box.width, box.height, layout]);

  /* ── Typography, pushed without a rebuild ─────────────────────── */

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    applyTypography(rendition, {
      tone: settings.tone,
      fontFamily: settings.fontFamily,
      fontScale: settings.fontScale,
      lineHeight: settings.lineHeight,
      margin: settings.margin,
      justify: settings.justify,
    });
  }, [
    settings.tone,
    settings.fontFamily,
    settings.fontScale,
    settings.lineHeight,
    settings.margin,
    settings.justify,
  ]);

  /* ── Highlights ───────────────────────────────────────────────── */

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    for (const highlight of highlights) {
      paintHighlight(rendition, highlight.position, highlight.color);
    }
  }, [highlights]);

  useImperativeHandle(ref, () => ({
    next: () => void renditionRef.current?.next(),
    previous: () => void renditionRef.current?.prev(),
    goToCfi: (cfi) => void renditionRef.current?.display(cfi),
    goToHref: (href) => void renditionRef.current?.display(href),
    goToPercent: (percent) => {
      try {
        const cfi = book.locations.cfiFromPercentage(Math.max(0, Math.min(1, percent / 100)));
        if (cfi) void renditionRef.current?.display(cfi);
      } catch {
        // An un-generated location index cannot answer this.
      }
    },
    visibleText: () => {
      const rendition = renditionRef.current;
      if (!rendition) return '';
      try {
        // getContents returns the mounted section views; each has its own
        // document, so concatenate what is actually on screen.
        const contents = rendition.getContents() as unknown as { document: Document }[];
        const list = Array.isArray(contents) ? contents : [contents];
        return list
          .map((c) => c?.document?.body?.innerText ?? '')
          .join(' ')
          .trim();
      } catch {
        return '';
      }
    },
    rendition: () => renditionRef.current,
  }));

  const colors = TONE_COLORS[settings.tone];

  return (
    <div
      className="relative h-full w-full"
      style={{ background: colors.surround }}
      // Lenis must not smooth-scroll a paginated iframe; the reader pages
      // itself and inertia here would fight every turn.
      data-lenis-prevent
    >
      {/* The sheet the text sits on, with the gutter drawn over it in spread
          mode so a reflowable book still reads as bound. */}
      <div className="relative mx-auto h-full w-full max-w-[min(100%,1500px)]">
        <div ref={host} className="epub-host epub-view h-full w-full" style={{ background: colors.background }} />

        {layout === 'spread' && (
          <div
            className="book-gutter pointer-events-none absolute inset-y-0 left-1/2 w-[26px] -translate-x-1/2"
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}
