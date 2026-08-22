'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import { cancelRender, renderPage } from '@/lib/reader/pdf-engine';
import { TONE_COLORS, type ReaderTone } from '@/lib/config';
import { clamp, normalizeWhitespace } from '@/lib/utils';
import { parsePdfHighlight, type PdfSelection } from '@/components/reader/pdf-view';
import type { HighlightRow } from '@/types';

/**
 * Continuous scroll for PDFs.
 *
 * A long document is sometimes a document rather than a book — a report, a
 * paper, a scanned manuscript you are scanning through — and paging through it
 * two leaves at a time is the wrong shape. This is the same renderer, laid out
 * as one column.
 *
 * Every page gets a slot of the right height immediately, computed from the
 * document's aspect ratio, so the scrollbar is honest from the first frame and
 * never jumps as pages arrive. Only the pages near the viewport are actually
 * rasterised — a 900-page book would otherwise try to allocate 900 canvases.
 */

/** How far outside the viewport to keep pages rendered, in screens. */
const OVERSCAN = 1.2;
const GAP = 20;

export function PdfScrollView({
  doc,
  page,
  pageCount,
  tone,
  zoom,
  fit,
  rotation,
  highlights,
  onPageChange,
  onSelect,
}: {
  doc: PDFDocumentProxy;
  /** Scrolls here when it changes from outside (a TOC jump, a bookmark). */
  page: number;
  pageCount: number;
  tone: ReaderTone;
  zoom: number;
  fit: 'page' | 'width' | 'actual' | 'custom';
  rotation: number;
  highlights: HighlightRow[];
  onPageChange: (page: number) => void;
  onSelect?: (selection: PdfSelection | null) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  /** The page the column is known to be showing — set both when we scroll to a
   *  page and when the reader scrolls onto one, so the two cannot fight. */
  const jumpedTo = useRef(page);
  const [box, setBox] = useState({ width: 0, height: 0 });
  /** Intrinsic ratio of page one, used to size every slot. */
  const [ratio, setRatio] = useState<number | null>(null);
  const [visible, setVisible] = useState({ from: 1, to: 1 });

  const onSelectRef = useRef(onSelect);
  const onPageChangeRef = useRef(onPageChange);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onPageChangeRef.current = onPageChange;
  });

  /* ── Measure the container and the document ───────────────────── */

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setBox({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void doc.getPage(1).then((first) => {
      if (cancelled) return;
      const viewport = first.getViewport({ scale: 1, rotation });
      setRatio(viewport.width / viewport.height);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, rotation]);

  /* ── Slot geometry ───────────────────────────────────────────── */

  const geometry = useMemo(() => {
    if (!ratio || !box.width || !box.height) return null;

    // A single column, so the available width is the whole container minus a
    // margin that keeps the page off the edge on a narrow window.
    const available = Math.max(120, box.width - 32);

    let width: number;
    if (fit === 'width') width = available;
    else if (fit === 'actual') width = available; // actual size is meaningless without a ruler here
    else width = Math.min(available, box.height * ratio);

    width = clamp(Math.floor(width * zoom), 80, 6000);
    const height = Math.round(width / ratio);

    return { width, height, stride: height + GAP };
  }, [ratio, box.width, box.height, fit, zoom]);

  /* ── Which pages to render, and which page we are on ─────────── */

  const recompute = useCallback(() => {
    const el = scroller.current;
    if (!el || !geometry) return;

    const { stride } = geometry;
    const top = el.scrollTop;
    const overscan = el.clientHeight * OVERSCAN;

    const from = clamp(Math.floor((top - overscan) / stride) + 1, 1, pageCount);
    const to = clamp(Math.ceil((top + el.clientHeight + overscan) / stride), 1, pageCount);
    setVisible((current) => (current.from === from && current.to === to ? current : { from, to }));

    // The current page is the one occupying the upper third of the viewport —
    // which is where a reader's eye actually is, rather than the very top edge.
    const current = clamp(Math.floor((top + el.clientHeight * 0.34) / stride) + 1, 1, pageCount);

    // Record it as already-reached before reporting it. The reported page comes
    // straight back as the `page` prop, and without this the jump effect below
    // would treat the reader's own scrolling as an external jump and yank the
    // column back to the top of that page mid-scroll.
    jumpedTo.current = current;
    onPageChangeRef.current(current);
  }, [geometry, pageCount]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;

    let frame = 0;
    function onScroll() {
      // Coalesced to one recompute per frame; a scroll event fires far more
      // often than a paint.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        recompute();
      });
    }

    el.addEventListener('scroll', onScroll, { passive: true });
    recompute();

    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [recompute]);

  /* ── Jumping ─────────────────────────────────────────────────── */

  useEffect(() => {
    const el = scroller.current;
    if (!el || !geometry) return;
    if (page === jumpedTo.current) return;

    jumpedTo.current = page;
    el.scrollTo({ top: (page - 1) * geometry.stride, behavior: 'auto' });
  }, [page, geometry]);

  /* ── Selection ───────────────────────────────────────────────── */

  const captureSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      onSelectRef.current?.(null);
      return;
    }

    const text = normalizeWhitespace(selection.toString());
    if (text.length < 2 || !geometry) {
      onSelectRef.current?.(null);
      return;
    }

    const layer = selection.anchorNode?.parentElement?.closest<HTMLElement>('.pdf-text-layer');
    const pageNumber = Number(layer?.dataset.page);
    if (!layer || !Number.isFinite(pageNumber)) {
      onSelectRef.current?.(null);
      return;
    }

    // The render scale is stamped onto the layer by the page that drew it, so
    // rectangles can be divided back into the PDF's own units — which is what
    // makes a stored highlight land correctly at any other zoom.
    const scale = Number(layer.dataset.scale);
    if (!Number.isFinite(scale) || scale <= 0) {
      onSelectRef.current?.(null);
      return;
    }

    const layerRect = layer.getBoundingClientRect();
    const range = selection.getRangeAt(0);

    const rects = Array.from(range.getClientRects())
      .filter((r) => r.width > 1 && r.height > 1)
      .filter((r) => r.top >= layerRect.top - 2 && r.bottom <= layerRect.bottom + 2)
      .map(
        (r): [number, number, number, number] => [
          (r.left - layerRect.left) / scale,
          (r.top - layerRect.top) / scale,
          r.width / scale,
          r.height / scale,
        ],
      );

    if (!rects.length) {
      onSelectRef.current?.(null);
      return;
    }

    const bounds = range.getBoundingClientRect();
    onSelectRef.current?.({
      text,
      page: pageNumber,
      rects,
      rect: { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height },
    });
  }, [geometry]);

  useEffect(() => {
    const el = scroller.current;
    function onPointerUp() {
      requestAnimationFrame(captureSelection);
    }
    el?.addEventListener('pointerup', onPointerUp);
    el?.addEventListener('touchend', onPointerUp);
    return () => {
      el?.removeEventListener('pointerup', onPointerUp);
      el?.removeEventListener('touchend', onPointerUp);
    };
  }, [captureSelection]);

  const colors = TONE_COLORS[tone];

  return (
    <div
      ref={scroller}
      className="h-full w-full overflow-y-auto overflow-x-hidden"
      style={{ background: colors.surround }}
      // The reader owns this scroller; Lenis inertia on a page column fights
      // every jump and makes the position readout lag behind.
      data-lenis-prevent
    >
      {geometry && (
        <div
          className="relative mx-auto"
          style={{ width: geometry.width, height: pageCount * geometry.stride + GAP }}
        >
          {Array.from({ length: visible.to - visible.from + 1 }, (_, i) => visible.from + i).map(
            (pageNumber) => (
              <ScrollPage
                key={pageNumber}
                doc={doc}
                pageNumber={pageNumber}
                width={geometry.width}
                height={geometry.height}
                top={(pageNumber - 1) * geometry.stride + GAP}
                tone={tone}
                rotation={rotation}
                highlights={highlights}
                background={colors.background}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** One page in the column. Renders on mount, cancels on unmount. */
function ScrollPage({
  doc,
  pageNumber,
  width,
  height,
  top,
  tone,
  rotation,
  highlights,
  background,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  height: number;
  top: number;
  tone: ReaderTone;
  rotation: number;
  highlights: HighlightRow[];
  background: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;

    let cancelled = false;

    void renderPage({
      doc,
      pageNumber,
      canvas: target,
      textLayerEl: textLayer.current,
      cssWidth: width,
      rotation,
      tone,
    }).then((result) => {
      if (!cancelled && result) setScale(result.scale);
    });

    return () => {
      cancelled = true;
      // Scrolling quickly unmounts pages mid-render. Telling pdf.js to stop
      // frees the worker for the pages actually on screen instead of letting it
      // finish rasterising ones that have already gone by.
      cancelRender(target);
    };
  }, [doc, pageNumber, width, rotation, tone]);

  const forThisPage = highlights.filter((h) => h.page === pageNumber);

  return (
    <div className="page-sheet absolute left-0" style={{ top, width, height, background }}>
      <canvas ref={canvas} className="block" />

      <div className="pointer-events-none absolute inset-0 z-1" aria-hidden="true">
        {forThisPage.map((highlight) => {
          const geometry = parsePdfHighlight(highlight.position);
          if (!geometry) return null;
          return geometry.rects.map((rect, i) => (
            <span
              key={`${highlight.$id}-${i}`}
              className="absolute"
              style={{
                left: rect[0] * scale,
                top: rect[1] * scale,
                width: rect[2] * scale,
                height: rect[3] * scale,
                background:
                  highlight.color === 'ribbon'
                    ? 'rgb(193 18 31 / 0.22)'
                    : highlight.color === 'ink'
                      ? 'rgb(10 10 10 / 0.14)'
                      : 'rgb(255 229 133 / 0.55)',
                mixBlendMode: 'multiply',
              }}
            />
          ));
        })}
      </div>

      {/* data-page says which page a selection landed in; data-scale lets it be
          converted back into PDF units. */}
      <div
        ref={textLayer}
        data-page={pageNumber}
        data-scale={scale}
        className="pdf-text-layer"
        aria-live="off"
      />

      <span className="absolute -bottom-5 right-0 text-[0.625rem] text-mute tnum" aria-hidden="true">
        {pageNumber}
      </span>
    </div>
  );
}
