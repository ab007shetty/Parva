'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Book as EpubBook } from 'epubjs';

import { LIMITS, READER_DEFAULTS, TONE_COLORS } from '@/lib/config';
import { clamp, debounce } from '@/lib/utils';
import { useReaderSettings, readLocalPosition, writeLocalPosition, readCachedLocations, writeCachedLocations } from '@/lib/reader/store';
import { destroyPdf, loadOutline, loadPdf, pageText, type LoadedPdf } from '@/lib/reader/pdf-engine';
import { destroyEpub, loadEpub, readToc, serializeLocations, type EpubPosition } from '@/lib/reader/epub-engine';
import { offlineObjectUrl } from '@/lib/reader/offline';
import { readAloud } from '@/lib/reader/speech';
import { toast } from '@/components/ui/toast';
import { PdfView, type PdfSelection, type PdfViewHandle } from '@/components/reader/pdf-view';
import { PdfScrollView } from '@/components/reader/pdf-scroll-view';
import { SelectionPopover, type SelectionPayload } from '@/components/reader/selection-popover';
import { EpubView, type EpubViewHandle } from '@/components/reader/epub-view';
import { ReaderChrome } from '@/components/reader/reader-chrome';
import { ReaderPanels, type PanelKey } from '@/components/reader/reader-panels';
import { ResumePill } from '@/components/reader/resume-pill';
import { ReaderLoading, ReaderError } from '@/components/reader/reader-status';
import {
  useHotkeys,
  useIdleChrome,
  useMediaQuery,
  useReadingClock,
  useSwipe,
} from '@/hooks/use-reader-interaction';
import type {
  Book,
  BookmarkRow,
  HighlightColor,
  HighlightRow,
  ReaderPosition,
  SessionUser,
  TocItem,
} from '@/types';

/**
 * The reader.
 *
 * One shell drives both engines. Everything above the engine boundary — chrome,
 * panels, keyboard, position, saving, read-aloud — is shared, and the two
 * engines only have to agree on a `ReaderPosition` and a handful of imperative
 * commands. That is what keeps a PDF and an EPUB feeling like the same product
 * rather than two viewers stapled together.
 */

export type ReaderShellProps = {
  book: Book;
  user: SessionUser | null;
  /** Signed, expiring URL for the book file. */
  fileUrl: string;
  savedPosition: {
    locator: string;
    page: number;
    percent: number;
  } | null;
  bookmarks: BookmarkRow[];
  highlights: HighlightRow[];
  isFavorite: boolean;
};

export function ReaderShell({
  book,
  user,
  fileUrl,
  savedPosition,
  bookmarks: initialBookmarks,
  highlights: initialHighlights,
  isFavorite: initialFavorite,
}: ReaderShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const settings = useReaderSettings();

  /* ── Loading ──────────────────────────────────────────────────── */

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadPercent, setLoadPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pdfRef = useRef<LoadedPdf | null>(null);
  const epubRef = useRef<EpubBook | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [epubBook, setEpubBook] = useState<EpubBook | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  /* ── Position ─────────────────────────────────────────────────── */

  const [position, setPosition] = useState<ReaderPosition>({
    page: 1,
    totalPages: book.pageCount ?? 1,
    percent: 0,
    locator: '1',
  });
  const [toc, setToc] = useState<TocItem[]>([]);
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const [highlights, setHighlights] = useState(initialHighlights);
  const [isFavorite, setIsFavorite] = useState(initialFavorite);

  /* ── UI ───────────────────────────────────────────────────────── */

  const [panel, setPanel] = useState<PanelKey | null>(null);
  const [rotation, setRotation] = useState(0);
  const [turn, setTurn] = useState<{ direction: 1 | -1 | 0; nonce: number }>({ direction: 0, nonce: 0 });
  const [resumeTarget, setResumeTarget] = useState<{ page: number; percent: number; locator: string } | null>(null);
  const [ribbonVisible, setRibbonVisible] = useState(false);
  const [selection, setSelection] = useState<SelectionPayload | null>(null);

  const pdfView = useRef<PdfViewHandle>(null);
  const epubView = useRef<EpubViewHandle>(null);

  const chromeVisible = useIdleChrome(READER_DEFAULTS.idleHideMs, panel !== null || status !== 'ready');
  const clock = useReadingClock(status === 'ready');

  // A spread needs width. Below the breakpoint it is forced to a single page
  // regardless of the saved preference, because two columns on a phone is not a
  // layout, it is a punishment.
  const wideEnough = useMediaQuery(`(min-width: ${READER_DEFAULTS.spreadMinWidth}px)`);
  const layout = settings.layout === 'spread' && !wideEnough ? 'single' : settings.layout;

  const isPdf = book.format === 'pdf';

  /* ═══════════════════════════════════════════════════════════════
     Load the book
     ═══════════════════════════════════════════════════════════════ */

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function run() {
      setStatus('loading');
      setLoadPercent(0);

      try {
        // A book saved for offline reading is used in place of the network, so
        // the reader keeps working in a tunnel.
        const offline = await offlineObjectUrl(book.$id);
        if (offline) objectUrlRef.current = offline;
        const source = offline ?? fileUrl;

        if (isPdf) {
          const loaded = await loadPdf(source, {
            signal: controller.signal,
            onProgress: ({ loaded: got, total }) => {
              if (!cancelled && total > 0) setLoadPercent(Math.round((got / total) * 100));
            },
          });
          if (cancelled) {
            void destroyPdf(loaded);
            return;
          }

          pdfRef.current = loaded;
          setPdfDoc(loaded.doc);
          setPosition((p) => ({ ...p, totalPages: loaded.pageCount }));

          // The outline is a nice-to-have; a book without one still opens.
          void loadOutline(loaded.doc).then((items) => {
            if (!cancelled) setToc(items);
          });
        } else {
          const loaded = await loadEpub(source, {
            cachedLocations: readCachedLocations(book.$id),
            signal: controller.signal,
            onProgress: (got, total) => {
              if (!cancelled && total > 0) setLoadPercent(Math.round((got / total) * 100));
            },
          });
          if (cancelled) {
            destroyEpub(null, loaded.book);
            return;
          }

          epubRef.current = loaded.book;
          setEpubBook(loaded.book);
          setToc(readToc(loaded.book));
          setPosition((p) => ({ ...p, totalPages: loaded.locationCount || 1 }));

          // Cache the generated index so the next open is instant.
          const serialized = serializeLocations(loaded.book);
          if (serialized) writeCachedLocations(book.$id, serialized);
        }

        if (!cancelled) setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        console.error('[parva] could not open book', error);
        setErrorMessage(
          error instanceof Error && /password/i.test(error.message)
            ? 'This file is password protected, so it cannot be opened here.'
            : 'That book would not open. The file may be damaged, or its link may have expired — reloading usually fixes the second one.',
        );
        setStatus('error');
      }
    }

    void run();

    return () => {
      cancelled = true;
      controller.abort();
      void destroyPdf(pdfRef.current);
      destroyEpub(null, epubRef.current);
      pdfRef.current = null;
      epubRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      readAloud.stop();
    };
  }, [book.$id, fileUrl, isPdf]);

  /* ═══════════════════════════════════════════════════════════════
     Navigation
     ═══════════════════════════════════════════════════════════════ */

  const pageStep = layout === 'spread' ? 2 : 1;

  const goToPage = useCallback(
    (target: number, options: { animate?: boolean } = {}) => {
      if (!isPdf) return;
      const total = pdfRef.current?.pageCount ?? position.totalPages;
      const next = clamp(Math.round(target), 1, total);

      // In a spread, the left page is always odd-relative to the start so the
      // pairing stays stable instead of shuffling on every jump.
      const aligned = layout === 'spread' ? next - ((next - 1) % 2) : next;

      setTurn((t) => ({
        direction: options.animate === false ? 0 : aligned > position.page ? 1 : -1,
        nonce: t.nonce + 1,
      }));

      setPosition((p) => ({
        ...p,
        page: aligned,
        totalPages: total,
        percent: total > 1 ? ((aligned - 1) / (total - 1)) * 100 : 100,
        locator: String(aligned),
      }));
    },
    [isPdf, layout, position.page, position.totalPages],
  );

  const advance = useCallback(
    (direction: 1 | -1) => {
      if (isPdf) {
        goToPage(position.page + direction * pageStep);
      } else if (direction === 1) {
        epubView.current?.next();
      } else {
        epubView.current?.previous();
      }
    },
    [isPdf, goToPage, position.page, pageStep],
  );

  const goToPercent = useCallback(
    (percent: number) => {
      if (isPdf) {
        const total = position.totalPages;
        goToPage(Math.round((percent / 100) * (total - 1)) + 1, { animate: false });
      } else {
        epubView.current?.goToPercent(percent);
      }
    },
    [isPdf, goToPage, position.totalPages],
  );

  /* ═══════════════════════════════════════════════════════════════
     Resume

     A deep link (?p=84) wins over a saved position — following a shared link
     should land you where the link points. Otherwise, if there is a saved
     position we offer it rather than jumping, because being moved without
     being asked is disorienting.

     Declared after the navigation callbacks so it can call them without
     referencing a binding that has not been initialised yet.
     ═══════════════════════════════════════════════════════════════ */

  const appliedResume = useRef(false);

  useEffect(() => {
    if (status !== 'ready' || appliedResume.current) return;
    appliedResume.current = true;

    const deepLink = searchParams.get('p');
    if (deepLink) {
      if (isPdf) {
        const page = Number(deepLink);
        if (Number.isFinite(page) && page >= 1) goToPage(page, { animate: false });
      } else {
        epubView.current?.goToCfi(deepLink);
      }
      return;
    }

    const saved = savedPosition ?? readLocalPosition(book.$id);
    if (!saved) return;

    // Right at the very start is not worth an offer.
    const meaningful = isPdf ? saved.page > 1 : saved.percent > 0.5;
    if (!meaningful) return;

    // Offered on the next frame, so the pill animates in over a book that is
    // already on screen rather than appearing in the same paint as the page.
    const raf = requestAnimationFrame(() =>
      setResumeTarget({ page: saved.page, percent: saved.percent, locator: saved.locator }),
    );
    return () => cancelAnimationFrame(raf);
  }, [status, isPdf, book.$id, savedPosition, searchParams, goToPage]);

  const goToTocItem = useCallback(
    (item: TocItem) => {
      if (isPdf && typeof item.target === 'number') {
        goToPage(item.target, { animate: false });
      } else if (!isPdf && typeof item.target === 'string') {
        epubView.current?.goToHref(item.target);
      }
      setPanel(null);
    },
    [isPdf, goToPage],
  );

  const goToLocator = useCallback(
    (locator: string | number) => {
      if (isPdf) {
        goToPage(Number(locator), { animate: false });
      } else {
        epubView.current?.goToCfi(String(locator));
      }
    },
    [isPdf, goToPage],
  );

  /**
   * In continuous scroll the reader moves the column and the view tells us
   * which page they landed on — the opposite direction from paged mode, where
   * we set the page and the view follows.
   */
  const onScrolledToPage = useCallback((next: number) => {
    setPosition((p) => {
      if (p.page === next) return p;
      return {
        ...p,
        page: next,
        percent: p.totalPages > 1 ? ((next - 1) / (p.totalPages - 1)) * 100 : 100,
        locator: String(next),
      };
    });
  }, []);

  /** EPUB reports its own position; PDF's is computed on navigation. */
  const onEpubPosition = useCallback((next: EpubPosition) => {
    setPosition({
      page: Math.max(1, next.location),
      totalPages: Math.max(1, next.locationCount),
      percent: next.percent,
      locator: next.cfi,
    });
  }, []);

  /* ═══════════════════════════════════════════════════════════════
     Saving

     Debounced while reading, and flushed on the way out — a reader who closes
     the tab mid-chapter should still be put back there.
     ═══════════════════════════════════════════════════════════════ */

  const saveNow = useCallback(
    async (current: ReaderPosition, seconds: number) => {
      // Always write locally: it is the fallback for signed-out readers and for
      // a failed network call.
      writeLocalPosition({
        bookId: book.$id,
        locator: current.locator,
        page: current.page,
        totalPages: current.totalPages,
        percent: current.percent,
      });

      if (!user) return;

      try {
        await fetch('/api/progress', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // keepalive lets the request survive the page unloading.
          keepalive: true,
          body: JSON.stringify({
            bookId: book.$id,
            format: book.format,
            locator: current.locator,
            page: current.page,
            totalPages: current.totalPages,
            percent: current.percent,
            secondsDelta: seconds,
            day: new Date().toLocaleDateString('en-CA'),
          }),
        });
      } catch {
        // The local write already happened, so the reader loses nothing.
      }
    },
    [book.$id, book.format, user],
  );

  /**
   * One debounced saver for the life of the reader.
   *
   * It debounces a *thunk* rather than a position, so each call supplies its own
   * fresh closure. That keeps the timer alive across re-renders — a saver
   * rebuilt on every page turn would drop the pending write each time — without
   * needing a ref to smuggle the latest callback in.
   */
  const debouncedSave = useMemo(
    () => debounce((run: () => void) => run(), LIMITS.progressSaveMs),
    [],
  );

  useEffect(() => {
    if (status !== 'ready') return;
    debouncedSave(() => void saveNow(position, clock.take()));
  }, [position, status, debouncedSave, saveNow, clock]);

  // Flush on the way out. `pagehide` fires reliably on mobile Safari, where
  // `beforeunload` does not, and `visibilitychange` covers a backgrounded tab
  // that the OS later kills without either firing.
  useEffect(() => {
    function flush() {
      debouncedSave.cancel();
      void saveNow(position, clock.take());
    }

    function onVisibility() {
      if (document.visibilityState === 'hidden') flush();
    }

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('pagehide', flush);
      // The listener was previously left attached, which leaked one per render.
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [position, saveNow, debouncedSave, clock]);

  /* ═══════════════════════════════════════════════════════════════
     Bookmarks, favourites, highlights
     ═══════════════════════════════════════════════════════════════ */

  const bookmarkHere = useCallback(async () => {
    if (!user) {
      toast.note('Sign in to keep bookmarks.', {
        label: 'Sign in',
        run: () => router.push(`/sign-in?next=/read/${book.$id}`),
      });
      return;
    }

    // The ribbon drops before the request resolves. It is the reader's own
    // action, so it should feel instant.
    setRibbonVisible(true);
    setTimeout(() => setRibbonVisible(false), 1600);

    // Label the bookmark with the opening words of the page, so a list of
    // bookmarks is readable instead of a column of page numbers.
    let label: string | null = null;
    if (isPdf && pdfRef.current) {
      const text = await pageText(pdfRef.current.doc, position.page);
      label = text ? text.slice(0, 90) : null;
    }

    try {
      const response = await fetch('/api/bookmarks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookId: book.$id,
          position: position.locator,
          page: isPdf ? position.page : null,
          percent: position.percent,
          label,
        }),
      });
      if (!response.ok) throw new Error('failed');
      const created = await response.json();
      setBookmarks((list) => [...list, created.bookmark].sort((a, b) => a.percent - b.percent));
      toast.done(isPdf ? `Bookmarked page ${position.page}.` : 'Bookmarked this spot.');
    } catch {
      toast.warn('That bookmark did not save. Check your connection and try again.');
    }
  }, [user, book.$id, isPdf, position, router]);

  const removeBookmark = useCallback(async (id: string) => {
    const previous = bookmarks;
    setBookmarks((list) => list.filter((b) => b.$id !== id));
    try {
      const response = await fetch(`/api/bookmarks/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('failed');
    } catch {
      setBookmarks(previous);
      toast.warn('That bookmark could not be removed.');
    }
  }, [bookmarks]);

  const toggleFavorite = useCallback(async () => {
    if (!user) {
      toast.note('Sign in to keep favourites.', {
        label: 'Sign in',
        run: () => router.push(`/sign-in?next=/read/${book.$id}`),
      });
      return;
    }
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      const response = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookId: book.$id }),
      });
      if (!response.ok) throw new Error('failed');
      const data = await response.json();
      setIsFavorite(data.favorite);
    } catch {
      setIsFavorite(!next);
      toast.warn('That did not save.');
    }
  }, [user, isFavorite, book.$id, router]);

  /* ═══════════════════════════════════════════════════════════════
     Selecting a passage

     The two engines describe a selection in their own terms — a PDF gives
     rectangles on a page, an EPUB gives a CFI range — so each is translated
     into one payload here and everything downstream is format-agnostic.
     ═══════════════════════════════════════════════════════════════ */

  const onPdfSelect = useCallback(
    (picked: PdfSelection | null) => {
      if (!picked) {
        setSelection(null);
        return;
      }
      setSelection({
        text: picked.text,
        rect: picked.rect,
        // Rectangles in unscaled PDF units, so the highlight lands in the right
        // place at any zoom and on any screen.
        locator: JSON.stringify({ page: picked.page, rects: picked.rects }),
        page: picked.page,
        percent: position.percent,
      });
    },
    [position.percent],
  );

  const onEpubSelect = useCallback(
    ({ cfiRange, text }: { cfiRange: string; text: string }) => {
      // epub.js reports the range but not where it sits on screen, and the text
      // lives inside its iframe — so the box is read from that frame and offset
      // by the frame's own position, falling back to the centre of the view.
      let rect = { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 };

      try {
        const contents = epubView.current?.rendition()?.getContents() as unknown as
          | { window: Window }[]
          | { window: Window }
          | undefined;
        const frames = Array.isArray(contents) ? contents : contents ? [contents] : [];

        for (const frame of frames) {
          const selected = frame.window.getSelection();
          if (!selected || selected.rangeCount === 0) continue;
          const box = selected.getRangeAt(0).getBoundingClientRect();
          if (!box || box.width === 0) continue;

          const host = frame.window.frameElement?.getBoundingClientRect();
          rect = {
            top: box.top + (host?.top ?? 0),
            left: box.left + (host?.left ?? 0),
            width: box.width,
            height: box.height,
          };
          break;
        }
      } catch {
        // Cross-frame reads can be refused; the fallback placement still works.
      }

      setSelection({ text, rect, locator: cfiRange, page: null, percent: position.percent });
    },
    [position.percent],
  );

  const createHighlight = useCallback(
    async (color: HighlightColor) => {
      const picked = selection;
      setSelection(null);
      if (!picked) return;

      if (!user) {
        toast.note('Sign in to keep highlights.', {
          label: 'Sign in',
          run: () => router.push(`/sign-in?next=/read/${book.$id}`),
        });
        return;
      }

      try {
        const response = await fetch('/api/highlights', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            bookId: book.$id,
            position: picked.locator,
            page: picked.page,
            percent: picked.percent,
            text: picked.text,
            color,
          }),
        });
        if (!response.ok) throw new Error('failed');

        const created = await response.json();
        setHighlights((list) => [...list, created.highlight].sort((a, b) => a.percent - b.percent));

        // Drop the browser selection so what remains visible is the highlight
        // itself rather than a blue overlay sitting on top of it.
        window.getSelection()?.removeAllRanges();
        toast.done('Highlighted.');
      } catch {
        toast.warn('That highlight did not save.');
      }
    },
    [selection, user, book.$id, router],
  );

  const removeHighlight = useCallback(
    async (id: string) => {
      const previous = highlights;
      setHighlights((list) => list.filter((h) => h.$id !== id));
      try {
        const response = await fetch(`/api/highlights/${id}`, { method: 'DELETE' });
        if (!response.ok && response.status !== 204) throw new Error('failed');
      } catch {
        setHighlights(previous);
        toast.warn('That highlight could not be removed.');
      }
    },
    [highlights],
  );

  /* ═══════════════════════════════════════════════════════════════
     Read aloud
     ═══════════════════════════════════════════════════════════════ */

  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    return readAloud.subscribe((handle) => setSpeaking(handle.state === 'speaking'));
  }, []);

  /** Reads just the selected passage, rather than the whole page. */
  const readSelectionAloud = useCallback(() => {
    const picked = selection;
    setSelection(null);
    if (!picked || !readAloud.supported) return;
    readAloud.configure({ voiceURI: settings.speechVoiceURI, rate: settings.speechRate });
    readAloud.start(picked.text);
  }, [selection, settings.speechVoiceURI, settings.speechRate]);

  const toggleReadAloud = useCallback(async () => {
    if (!readAloud.supported) {
      toast.warn('This browser has no speech voices available.');
      return;
    }
    if (speaking) {
      readAloud.stop();
      return;
    }

    readAloud.configure({ voiceURI: settings.speechVoiceURI, rate: settings.speechRate });

    const text = isPdf
      ? pdfRef.current
        ? await pageText(pdfRef.current.doc, position.page)
        : ''
      : (epubView.current?.visibleText() ?? '');

    if (!text.trim()) {
      toast.warn('There is no selectable text on this page to read aloud.');
      return;
    }
    readAloud.start(text);
  }, [speaking, isPdf, position.page, settings.speechVoiceURI, settings.speechRate]);

  /* ═══════════════════════════════════════════════════════════════
     Input
     ═══════════════════════════════════════════════════════════════ */

  useSwipe(advance, { enabled: status === 'ready' && panel === null });

  useHotkeys(
    [
      { key: 'ArrowRight', run: () => advance(1) },
      { key: 'ArrowLeft', run: () => advance(-1) },
      { key: 'ArrowDown', run: () => advance(1) },
      { key: 'ArrowUp', run: () => advance(-1) },
      { key: 'PageDown', run: () => advance(1) },
      { key: 'PageUp', run: () => advance(-1) },
      { key: ' ', run: () => advance(1) },
      { key: 'Home', run: () => (isPdf ? goToPage(1, { animate: false }) : goToPercent(0)) },
      { key: 'End', run: () => (isPdf ? goToPage(position.totalPages, { animate: false }) : goToPercent(100)) },
      { key: 'b', run: () => void bookmarkHere() },
      { key: 'f', run: () => void toggleFullscreen() },
      { key: 't', run: () => setPanel((p) => (p === 'contents' ? null : 'contents')) },
      { key: 's', run: () => setPanel((p) => (p === 'search' ? null : 'search')) },
      { key: 'g', run: () => setPanel((p) => (p === 'settings' ? null : 'settings')) },
      { key: 'm', run: () => setPanel((p) => (p === 'bookmarks' ? null : 'bookmarks')) },
      { key: 'h', run: () => setPanel((p) => (p === 'highlights' ? null : 'highlights')) },
      { key: '?', shift: true, run: () => setPanel((p) => (p === 'shortcuts' ? null : 'shortcuts')) },
      { key: '+', run: () => settings.set('zoom', clamp(settings.zoom + 0.1, 0.4, 4)) },
      { key: '=', run: () => settings.set('zoom', clamp(settings.zoom + 0.1, 0.4, 4)) },
      { key: '-', run: () => settings.set('zoom', clamp(settings.zoom - 0.1, 0.4, 4)) },
      { key: '0', run: () => settings.patch({ zoom: 1, fit: 'page' }) },
      {
        key: 'Escape',
        whileTyping: true,
        run: () => {
          if (panel) setPanel(null);
          else if (document.fullscreenElement) void document.exitFullscreen();
          else router.push(`/book/${book.slug}`);
        },
      },
    ],
    status === 'ready',
  );

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Denied by the browser; nothing to recover from.
    }
  }

  /* ── Tone applied to the page itself, so the letterbox matches ── */

  useEffect(() => {
    const colors = TONE_COLORS[settings.tone];
    document.documentElement.style.background = colors.surround;
    return () => {
      document.documentElement.style.background = '';
    };
  }, [settings.tone]);

  /* ═══════════════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════════════ */

  if (status === 'error') {
    return <ReaderError message={errorMessage} bookSlug={book.slug} onRetry={() => router.refresh()} />;
  }

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{ background: TONE_COLORS[settings.tone].surround }}
    >
      {status === 'loading' && <ReaderLoading book={book} percent={loadPercent} />}

      {/* The page surface. Click zones sit on top of it rather than inside the
          engines, so both formats page identically. */}
      <div className="relative min-h-0 flex-1">
        {/* Continuous scroll is a different layout, not a different setting on
            the same one, so it is its own view rather than a branch inside the
            paged one. */}
        {isPdf && pdfDoc && layout === 'scroll' && (
          <PdfScrollView
            doc={pdfDoc}
            page={position.page}
            pageCount={position.totalPages}
            tone={settings.tone}
            zoom={settings.zoom}
            fit={settings.fit}
            rotation={rotation}
            highlights={highlights}
            onPageChange={onScrolledToPage}
            onSelect={onPdfSelect}
          />
        )}

        {isPdf && pdfDoc && layout !== 'scroll' && (
          <PdfView
            ref={pdfView}
            doc={pdfDoc}
            page={position.page}
            pageCount={position.totalPages}
            layout={layout}
            tone={settings.tone}
            zoom={settings.zoom}
            fit={settings.fit}
            rotation={rotation}
            animateTurns={settings.animatePageTurn}
            turnDirection={turn.direction}
            highlights={highlights}
            onSelect={onPdfSelect}
          />
        )}

        {!isPdf && epubBook && (
          <EpubView
            ref={epubView}
            book={epubBook}
            settings={settings}
            layout={layout}
            highlights={highlights}
            initialCfi={savedPosition?.locator ?? null}
            onPosition={onEpubPosition}
            onSelection={onEpubSelect}
          />
        )}

        {/* Click either outer edge to turn. Kept narrow so selecting text in
            the middle of a page still works, and left out of scroll mode
            entirely — there the right-hand zone would sit over the scrollbar
            and swallow the drag. */}
        {status === 'ready' && panel === null && layout !== 'scroll' && (
          <>
            <button
              type="button"
              aria-label="Previous page"
              onClick={() => advance(-1)}
              className="absolute inset-y-0 left-0 w-[18%] cursor-w-resize focus-visible:outline-offset-[-4px]"
            />
            <button
              type="button"
              aria-label="Next page"
              onClick={() => advance(1)}
              className="absolute inset-y-0 right-0 w-[18%] cursor-e-resize focus-visible:outline-offset-[-4px]"
            />
          </>
        )}

        {/* The bookmark ribbon: a strip of silk that drops from the top edge
            when you bookmark. The one place --color-ribbon is ever used. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 right-[8%] z-30 w-3 origin-top bg-ribbon transition-transform duration-500"
          style={{
            height: '96px',
            transform: ribbonVisible ? 'scaleY(1)' : 'scaleY(0)',
            transitionTimingFunction: ribbonVisible
              ? 'cubic-bezier(0.34, 1.4, 0.64, 1)'
              : 'cubic-bezier(0.4, 0, 1, 1)',
            clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 82%, 0 100%)',
          }}
        />
      </div>

      <ReaderChrome
        book={book}
        user={user}
        visible={chromeVisible}
        position={position}
        isPdf={isPdf}
        isFavorite={isFavorite}
        bookmarkCount={bookmarks.length}
        highlightCount={highlights.length}
        speaking={speaking}
        activePanel={panel}
        onPanel={(key) => setPanel((current) => (current === key ? null : key))}
        onTurn={advance}
        onGoToPage={(page) => goToPage(page, { animate: false })}
        onScrub={goToPercent}
        onBookmark={() => void bookmarkHere()}
        onToggleFavorite={() => void toggleFavorite()}
        onToggleReadAloud={() => void toggleReadAloud()}
        onRotate={() => setRotation((r) => (r + 90) % 360)}
        onFullscreen={() => void toggleFullscreen()}
      />

      <ReaderPanels
        open={panel}
        onClose={() => setPanel(null)}
        book={book}
        isPdf={isPdf}
        pdfDoc={pdfDoc}
        epubBook={epubBook}
        toc={toc}
        bookmarks={bookmarks}
        highlights={highlights}
        position={position}
        onGoToToc={goToTocItem}
        onGoToLocator={goToLocator}
        onGoToPage={(page) => goToPage(page, { animate: false })}
        onRemoveBookmark={(id) => void removeBookmark(id)}
        onRemoveHighlight={(id) => void removeHighlight(id)}
      />

      {selection && (
        <SelectionPopover
          selection={selection}
          onHighlight={(color) => void createHighlight(color)}
          onReadAloud={readSelectionAloud}
          onDismiss={() => setSelection(null)}
        />
      )}

      {resumeTarget && (
        <ResumePill
          page={resumeTarget.page}
          percent={resumeTarget.percent}
          isPdf={isPdf}
          onResume={() => {
            if (isPdf) goToPage(resumeTarget.page, { animate: false });
            else epubView.current?.goToCfi(resumeTarget.locator);
            setResumeTarget(null);
          }}
          onDismiss={() => setResumeTarget(null)}
        />
      )}
    </div>
  );
}
