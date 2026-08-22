'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import gsap from 'gsap';

import { renderPage, cancelRender } from '@/lib/reader/pdf-engine';
import { TONE_COLORS, type ReaderLayout, type ReaderTone } from '@/lib/config';
import { clamp, normalizeWhitespace } from '@/lib/utils';
import type { HighlightRow } from '@/types';

/**
 * The spread.
 *
 * Two canvases side by side with a gutter shadow between them — that shadow is
 * what makes it read as one bound book instead of two images. Page turns rotate
 * the outgoing leaf about the gutter, so the motion has a hinge where a real
 * book has its spine.
 *
 * Sizing is measured, not guessed: the container is measured, the page's own
 * aspect ratio decides how much of it a page can fill, and both pages of a
 * spread are rendered to the same height so the gutter stays straight even when
 * a book mixes portrait and landscape scans.
 */

export type PdfViewHandle = {
  /** Re-render at the current size. */
  refresh: () => void;
  textLayers: () => HTMLElement[];
};

/** A highlight's stored geometry: page plus rectangles in unscaled PDF units,
 *  so it survives any zoom, window size or device. */
export type PdfHighlightGeometry = { page: number; rects: [number, number, number, number][] };

export function parsePdfHighlight(position: string): PdfHighlightGeometry | null {
  try {
    const parsed = JSON.parse(position);
    if (typeof parsed?.page !== 'number' || !Array.isArray(parsed?.rects)) return null;
    return parsed as PdfHighlightGeometry;
  } catch {
    return null;
  }
}

export type PdfSelection = {
  text: string;
  page: number;
  rects: [number, number, number, number][];
  /** Viewport box, for placing the popover. */
  rect: { top: number; left: number; width: number; height: number };
};

export type PdfViewProps = {
  doc: PDFDocumentProxy;
  /** 1-based. In spread mode this is the left page. */
  page: number;
  pageCount: number;
  layout: ReaderLayout;
  tone: ReaderTone;
  zoom: number;
  fit: 'page' | 'width' | 'actual' | 'custom';
  rotation: number;
  animateTurns: boolean;
  turnDirection: 1 | -1 | 0;
  highlights: HighlightRow[];
  onSelect?: (selection: PdfSelection | null) => void;
  ref?: React.Ref<PdfViewHandle>;
};

export function PdfView({
  doc,
  page,
  pageCount,
  layout,
  tone,
  zoom,
  fit,
  rotation,
  animateTurns,
  turnDirection,
  highlights,
  onSelect,
  ref,
}: PdfViewProps) {
  const frame = useRef<HTMLDivElement>(null);
  const leftCanvas = useRef<HTMLCanvasElement>(null);
  const rightCanvas = useRef<HTMLCanvasElement>(null);
  const leftText = useRef<HTMLDivElement>(null);
  const rightText = useRef<HTMLDivElement>(null);
  const leaf = useRef<HTMLDivElement>(null);

  const [box, setBox] = useState({ width: 0, height: 0 });
  /** Render scale, needed to place highlight overlays and read selections. */
  const [scale, setScale] = useState(1);
  const renderToken = useRef(0);

  const isSpread = layout === 'spread';
  const rightPage = isSpread && page + 1 <= pageCount ? page + 1 : null;

  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  /* ── Measure ──────────────────────────────────────────────────── */

  useEffect(() => {
    const el = frame.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setBox({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* ── Render ───────────────────────────────────────────────────── */

  const draw = useCallback(async () => {
    if (!doc || !box.width || !box.height || !leftCanvas.current) return;

    const token = ++renderToken.current;

    // How wide one page may be. In a spread, two pages plus the gutter share
    // the width; the gutter is deliberately thin so the pages nearly touch.
    const columns = rightPage ? 2 : 1;
    const gutter = rightPage ? 18 : 0;
    const availableWidth = (box.width - gutter) / columns;

    const firstPage = await doc.getPage(page);
    // Loading a page is a round-trip to the worker; the view may be gone by now.
    if (token !== renderToken.current) return;

    const natural = firstPage.getViewport({ scale: 1, rotation });
    const pageRatio = natural.width / natural.height;

    let targetWidth: number;
    if (fit === 'width') {
      targetWidth = availableWidth;
    } else if (fit === 'actual') {
      // 96 CSS px per inch against the PDF's 72 pt per inch.
      targetWidth = natural.width * (96 / 72);
    } else {
      // 'page' and 'custom': the largest that fits both axes, so a tall page
      // never overflows a view that claims to show the whole page.
      const byHeight = box.height * pageRatio;
      targetWidth = Math.min(availableWidth, byHeight);
    }

    const cssWidth = clamp(Math.floor(targetWidth * zoom), 80, 6000);

    const left = await renderPage({
      doc,
      pageNumber: page,
      canvas: leftCanvas.current,
      textLayerEl: leftText.current,
      cssWidth,
      rotation,
      tone,
    });

    // A newer render started while this one was working — drop this result.
    if (token !== renderToken.current) return;
    if (left) setScale(left.scale);

    if (rightPage && rightCanvas.current) {
      // Render the right page to the SAME height as the left, not the same
      // width. Matching heights is what keeps the gutter a straight line when a
      // scan's pages differ by a millimetre.
      const rightPdfPage = await doc.getPage(rightPage);
      if (token !== renderToken.current) return;

      const rightNatural = rightPdfPage.getViewport({ scale: 1, rotation });
      const targetHeight = left?.cssHeight ?? box.height;
      const rightWidth = (rightNatural.width / rightNatural.height) * targetHeight;

      await renderPage({
        doc,
        pageNumber: rightPage,
        canvas: rightCanvas.current,
        textLayerEl: rightText.current,
        cssWidth: Math.floor(rightWidth),
        rotation,
        tone,
      });

      if (token !== renderToken.current) return;
    } else if (rightCanvas.current) {
      // Clear a stale right page when leaving spread mode or hitting the end.
      cancelRender(rightCanvas.current);
      const ctx = rightCanvas.current.getContext('2d');
      ctx?.clearRect(0, 0, rightCanvas.current.width, rightCanvas.current.height);
      rightCanvas.current.style.width = '0px';
      rightText.current?.replaceChildren();
    }
  }, [doc, box.width, box.height, page, rightPage, fit, zoom, rotation, tone]);

  useEffect(() => {
    // Captured now, because by cleanup time React has nulled the refs — which
    // is the whole reason the cleanup is needed.
    const left = leftCanvas.current;
    const right = rightCanvas.current;

    void draw();

    return () => {
      // Switching layout unmounts this view, but an in-flight draw() would keep
      // going — awaiting a page, then reaching for refs that are already gone.
      // Bumping the token makes it abandon its result, and cancelling hands the
      // worker back to whichever view took over.
      renderToken.current += 1;
      cancelRender(left);
      cancelRender(right);
    };
  }, [draw]);

  useImperativeHandle(ref, () => ({
    refresh: () => void draw(),
    textLayers: () =>
      [leftText.current, rightText.current].filter((el): el is HTMLDivElement => Boolean(el)),
  }));

  /* ── Selection ────────────────────────────────────────────────── */

  /**
   * Reads the current selection and converts it into unscaled PDF rectangles.
   *
   * Storing viewport pixels would break the moment the reader zoomed or opened
   * the book on another screen, so every rectangle is divided back down by the
   * render scale before it leaves here.
   */
  const captureSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      onSelectRef.current?.(null);
      return;
    }

    const text = normalizeWhitespace(selection.toString());
    if (text.length < 2) {
      onSelectRef.current?.(null);
      return;
    }

    // Which page the selection started in decides where it is stored. A
    // selection dragged across the gutter is clipped to its first page rather
    // than being split — one highlight, one page.
    const anchor = selection.anchorNode?.parentElement?.closest('.pdf-text-layer');
    const layer =
      anchor === rightText.current ? rightText.current : anchor === leftText.current ? leftText.current : null;
    if (!layer) {
      onSelectRef.current?.(null);
      return;
    }

    const pageNumber = layer === rightText.current && rightPage ? rightPage : page;
    const layerRect = layer.getBoundingClientRect();
    const range = selection.getRangeAt(0);
    const clientRects = Array.from(range.getClientRects()).filter(
      (r) => r.width > 1 && r.height > 1,
    );
    if (!clientRects.length) {
      onSelectRef.current?.(null);
      return;
    }

    const rects = clientRects
      // Keep only the parts that fall inside this page's layer.
      .filter(
        (r) =>
          r.left >= layerRect.left - 2 &&
          r.right <= layerRect.right + 2 &&
          r.top >= layerRect.top - 2 &&
          r.bottom <= layerRect.bottom + 2,
      )
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
  }, [page, rightPage, scale]);

  useEffect(() => {
    // `pointerup` rather than `selectionchange`: the latter fires continuously
    // while dragging, and a popover that follows a growing selection is
    // unusable.
    function onPointerUp() {
      // One frame, so the browser has settled the selection before it is read.
      requestAnimationFrame(captureSelection);
    }

    const el = frame.current;
    el?.addEventListener('pointerup', onPointerUp);
    el?.addEventListener('touchend', onPointerUp);
    return () => {
      el?.removeEventListener('pointerup', onPointerUp);
      el?.removeEventListener('touchend', onPointerUp);
    };
  }, [captureSelection]);

  /* ── The turn ─────────────────────────────────────────────────── */

  // Runs after the new pages are painted, so the animation reveals real
  // content rather than sliding a blank sheet across.
  useEffect(() => {
    if (!animateTurns || !turnDirection || !leaf.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const forward = turnDirection === 1;

    const tl = gsap.timeline();
    tl.fromTo(
      leaf.current,
      {
        // The hinge is the gutter: turning forward pivots about the binding edge
        // so the leaf lifts away from the spine.
        transformOrigin: isSpread ? (forward ? 'left center' : 'right center') : 'center center',
        rotateY: forward ? -14 : 14,
        opacity: 0.35,
        // A slight scale keeps the lift from reading as a flat slide.
        scale: 0.985,
      },
      {
        rotateY: 0,
        opacity: 1,
        scale: 1,
        duration: 0.44,
        ease: 'power3.out',
        clearProps: 'transform,opacity',
      },
    );

    return () => {
      tl.kill();
    };
  }, [page, turnDirection, animateTurns, isSpread]);

  const colors = TONE_COLORS[tone];

  return (
    <div
      ref={frame}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{ background: colors.surround }}
    >
      <div ref={leaf} className="relative [perspective:2400px] will-change-transform">
        <div className="relative flex items-stretch justify-center">
          <Sheet
            canvasRef={leftCanvas}
            textRef={leftText}
            background={colors.background}
            highlights={highlights}
            pageNumber={page}
            scale={scale}
          />

          {rightPage && (
            <>
              {/* The gutter. Thin, dark at the centre, and the single detail
                  that makes two canvases read as one open book. */}
              <div className="book-gutter relative -mx-px w-[18px] shrink-0" aria-hidden="true" />

              <Sheet
                canvasRef={rightCanvas}
                textRef={rightText}
                background={colors.background}
                highlights={highlights}
                pageNumber={rightPage}
                scale={scale}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One page: the canvas, the highlight overlay, and the text layer on top.
 *
 * Order matters. Highlights sit under the text layer so selection still works
 * through them, and over the canvas so they read as ink on the page.
 */
function Sheet({
  canvasRef,
  textRef,
  background,
  highlights,
  pageNumber,
  scale,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  textRef: React.RefObject<HTMLDivElement | null>;
  background: string;
  highlights: HighlightRow[];
  pageNumber: number;
  scale: number;
}) {
  const forThisPage = highlights.filter((h) => h.page === pageNumber);

  return (
    <div className="page-sheet relative" style={{ background }}>
      <canvas ref={canvasRef} className="block" />

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

      <div ref={textRef} className="pdf-text-layer" aria-live="off" />
    </div>
  );
}
