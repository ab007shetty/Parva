'use client';

// Types only — these are erased at compile time, so importing them here does
// not pull pdf.js into the server bundle. See loadPdfjs() below.
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  RenderTask,
  TextLayer,
} from 'pdfjs-dist';

import { excerptAround, normalizeWhitespace } from '@/lib/utils';
import type { SearchHit, TocItem } from '@/types';
import { TONE_COLORS, type ReaderTone } from '@/lib/config';

/**
 * PDF rendering, built directly on pdf.js.
 *
 * A wrapper component library would be less code, but the two-page spread needs
 * canvas-level control: matched page heights across the gutter, high-DPI
 * rasterisation, a text layer aligned to the exact render scale, page-turn
 * animation on top of live canvases, and cancellation when a reader flicks
 * through pages faster than they render. All of that is the thing being built
 * here, so the abstraction would be in the way.
 *
 * Assets (worker, cmaps, standard fonts, ICC profiles, wasm decoders) are
 * copied to /public/pdfjs at postinstall, so a book renders with no CDN and
 * works offline.
 */

const ASSET_BASE = '/pdfjs/';

/**
 * pdf.js is loaded on demand, never at module scope.
 *
 * Every component here is a Client Component, but Next still server-renders
 * those for the initial HTML — and pdf.js reaches for browser-only globals
 * (`DOMMatrix`) as soon as its module is evaluated. Importing it at the top
 * therefore threw during SSR on every reader load, and Next quietly fell back
 * to client-only rendering. Deferring the import to first use keeps the rest of
 * the reader server-renderable and the console clean. The module is cached
 * after the first call, so this costs one dynamic import per session.
 */
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  pdfjsPromise ??= import('pdfjs-dist').then((pdfjs) => {
    // The worker is version-pinned by the postinstall copy, so the API and
    // worker builds can never drift apart.
    pdfjs.GlobalWorkerOptions.workerSrc = `${ASSET_BASE}pdf.worker.min.mjs`;
    return pdfjs;
  });
  return pdfjsPromise;
}

export type LoadedPdf = {
  doc: PDFDocumentProxy;
  /** Only the loading task can tear down the worker and abort in-flight range
   *  requests, so it is kept alongside the document for cleanup. */
  task: PDFDocumentLoadingTask;
  pageCount: number;
  /** Intrinsic size of page 1 at scale 1, used to lay out before first render. */
  firstPageRatio: number;
  title: string | null;
  author: string | null;
};

export type PdfLoadProgress = { loaded: number; total: number };

export async function loadPdf(
  url: string,
  options: { onProgress?: (p: PdfLoadProgress) => void; signal?: AbortSignal } = {},
): Promise<LoadedPdf> {
  const { getDocument } = await loadPdfjs();

  const task = getDocument({
    url,
    // Range requests + streaming are what make a 200 MB scan open on the first
    // page instead of after a full download. Appwrite serves Range, so leave
    // both enabled and keep autoFetch off so we only pull what is read.
    disableRange: false,
    disableStream: false,
    disableAutoFetch: true,
    rangeChunkSize: 262_144,
    cMapUrl: `${ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
    wasmUrl: `${ASSET_BASE}wasm/`,
    iccUrl: `${ASSET_BASE}iccs/`,
    // Some PDFs reference fonts by system name; letting pdf.js use local fonts
    // renders them correctly rather than substituting.
    useSystemFonts: true,
  });

  if (options.onProgress) {
    task.onProgress = ({ loaded, total }: PdfLoadProgress) => options.onProgress?.({ loaded, total });
  }

  options.signal?.addEventListener('abort', () => {
    void task.destroy();
  });

  const doc = await task.promise;

  const firstPage = await doc.getPage(1);
  const viewport = firstPage.getViewport({ scale: 1 });
  const firstPageRatio = viewport.width / viewport.height;

  let title: string | null = null;
  let author: string | null = null;
  try {
    const meta = await doc.getMetadata();
    const info = meta.info as { Title?: string; Author?: string } | undefined;
    title = info?.Title?.trim() || null;
    author = info?.Author?.trim() || null;
  } catch {
    // Metadata is optional; a missing dictionary is not an error.
  }

  return { doc, task, pageCount: doc.numPages, firstPageRatio, title, author };
}

/* ═══════════════════════════════════════════════════════════════════
   Rendering
   ═══════════════════════════════════════════════════════════════════ */

export type RenderRequest = {
  doc: PDFDocumentProxy;
  pageNumber: number;
  /**
   * Nullable on purpose. Callers pass a React ref's `current`, and a view can
   * unmount between scheduling a render and running it — at which point React
   * has already set the ref to null. Typing this as non-null let that through:
   * narrowing on `ref.current` survives an `await` in the type system but not at
   * runtime, so a detached view reached a WeakMap with a null key and threw.
   */
  canvas: HTMLCanvasElement | null;
  /** Container the text layer spans. Omit to skip the text layer. */
  textLayerEl?: HTMLElement | null;
  /** CSS pixels the page should occupy. Height follows from the aspect ratio. */
  cssWidth: number;
  rotation?: number;
  tone?: ReaderTone;
  /** Caps the backing store on very high-DPI screens. */
  maxPixelRatio?: number;
};

export type RenderResult = {
  cssWidth: number;
  cssHeight: number;
  scale: number;
  viewport: PageViewport;
};

/**
 * One in-flight render per canvas. pdf.js throws if two renders target the same
 * canvas, and a reader holding the arrow key down will absolutely try.
 */
type CanvasJob = {
  task?: RenderTask;
  /** Set by whoever supersedes this job; checked after every await. */
  superseded: boolean;
};

const activeJobs = new WeakMap<HTMLCanvasElement, CanvasJob>();
const activeTextLayers = new WeakMap<HTMLElement, TextLayer>();

/**
 * One render at a time per canvas, enforced by a queue.
 *
 * pdf.js throws outright if a second render() targets a canvas the first is
 * still drawing to, and cancelling before starting is not enough on its own:
 * there are two awaits between the cancel and the point where the new task
 * becomes visible to the next caller, so two calls can both pass the check and
 * then collide. Continuous-scroll mode makes that likely rather than
 * theoretical — a screenful of pages mounts at once and re-renders when the
 * measured width settles.
 *
 * The queue is registered synchronously, so a third and fourth caller land
 * behind the second rather than racing it.
 */
const canvasQueues = new WeakMap<HTMLCanvasElement, Promise<unknown>>();

export function renderPage(request: RenderRequest): Promise<RenderResult | null> {
  const { canvas } = request;

  // The view went away before this render got to run. Nothing to draw on — and
  // a WeakMap cannot be keyed by null, so this must be caught before the queue.
  if (!canvas) return Promise.resolve(null);

  // Tell the job currently drawing to stop, synchronously, so the queue ahead
  // of us drains immediately instead of finishing work nobody wants.
  const current = activeJobs.get(canvas);
  if (current) {
    current.superseded = true;
    current.task?.cancel();
  }

  const queued = (canvasQueues.get(canvas) ?? Promise.resolve())
    // A failed or cancelled predecessor must not stall the queue.
    .catch(() => {})
    .then(() => drawPage(request));

  canvasQueues.set(
    canvas,
    queued.catch(() => {}),
  );

  return queued;
}

/**
 * Draws one page, checking after every await whether it has been superseded.
 *
 * Only ever entered one-at-a-time per canvas — renderPage owns that guarantee.
 */
async function drawPage(request: RenderRequest): Promise<RenderResult | null> {
  const { doc, pageNumber, cssWidth, rotation = 0, tone = 'paper' } = request;
  const canvas = request.canvas;
  // renderPage guarantees this, but the ref could in principle be cleared while
  // this job sat in the queue.
  if (!canvas) return null;

  const job: CanvasJob = { superseded: false };
  activeJobs.set(canvas, job);

  try {
    const page: PDFPageProxy = await doc.getPage(pageNumber);
    // Superseded while the page was loading — do not touch the canvas at all.
    if (job.superseded) return null;

    const base = page.getViewport({ scale: 1, rotation });
    const scale = cssWidth / base.width;
    const viewport = page.getViewport({ scale, rotation });

    // Render at device resolution so text is crisp on retina, but cap it: a 3x
    // canvas of a full-bleed spread costs a lot of memory for little gain.
    const dpr = Math.min(window.devicePixelRatio || 1, request.maxPixelRatio ?? 2);

    const cssHeight = viewport.height;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(cssHeight)}px`;

    const colors = TONE_COLORS[tone];

    const task = page.render({
      canvas,
      viewport,
      // Scale the whole drawing up rather than the canvas's own transform, which
      // pdf.js uses for its internal maths.
      transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      // Night and sepia recolour during rasterisation. A CSS `filter: invert`
      // would also flip photographs and turn diagrams into negatives; pageColors
      // remaps only the drawing operations, so a scanned page stays legible.
      pageColors: { background: colors.background, foreground: colors.foreground },
      background: colors.background,
    });

    job.task = task;

    try {
      await task.promise;
    } catch (error) {
      const { RenderingCancelledException } = await loadPdfjs();
      if (error instanceof RenderingCancelledException) return null;
      throw error;
    }

    if (job.superseded) return null;

    if (request.textLayerEl) {
      await paintTextLayer(page, request.textLayerEl, viewport);
    }

    return { cssWidth: viewport.width, cssHeight, scale, viewport };
  } finally {
    // Whatever happened, this canvas is free for the next job in the queue.
    if (activeJobs.get(canvas) === job) activeJobs.delete(canvas);
  }
}

/**
 * The invisible, precisely positioned glyph layer. It is what makes selection,
 * search highlighting, read-aloud and screen readers work on a PDF — without it
 * a page is just a picture.
 */
async function paintTextLayer(page: PDFPageProxy, container: HTMLElement, viewport: PageViewport) {
  activeTextLayers.get(container)?.cancel();
  container.replaceChildren();

  // pdf.js positions spans using these custom properties.
  container.style.setProperty('--scale-factor', String(viewport.scale));
  container.style.setProperty('--total-scale-factor', String(viewport.scale));
  container.style.width = `${Math.floor(viewport.width)}px`;
  container.style.height = `${Math.floor(viewport.height)}px`;

  const { TextLayer } = await loadPdfjs();

  const layer = new TextLayer({
    textContentSource: page.streamTextContent({ includeMarkedContent: false }),
    container,
    viewport,
  });
  activeTextLayers.set(container, layer);

  try {
    await layer.render();
  } catch {
    // A failed text layer costs selection on one page, not the render.
  }
}

/**
 * Stops whatever this canvas is drawing.
 *
 * Marks the job superseded as well as cancelling the task, so anything it was
 * about to do after an await — painting the text layer, reporting a scale —
 * is abandoned too.
 */
export function cancelRender(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const job = activeJobs.get(canvas);
  if (!job) return;
  job.superseded = true;
  job.task?.cancel();
}

/* ═══════════════════════════════════════════════════════════════════
   Thumbnails
   ═══════════════════════════════════════════════════════════════════ */

const thumbnailCache = new Map<string, string>();

/** Small raster for the page-strip and the scrubber preview. Cached as a data
 *  URL because the same thumbnails are asked for repeatedly while scrubbing. */
export async function renderThumbnail(
  doc: PDFDocumentProxy,
  pageNumber: number,
  width = 128,
  cacheKey = 'default',
): Promise<string | null> {
  const key = `${cacheKey}:${pageNumber}:${width}`;
  const cached = thumbnailCache.get(key);
  if (cached) return cached;

  try {
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    await page.render({ canvas, viewport, background: '#ffffff' }).promise;

    const url = canvas.toDataURL('image/webp', 0.7);
    // Keep the cache bounded — a 900-page book would otherwise hold 900 rasters.
    if (thumbnailCache.size > 240) {
      const oldest = thumbnailCache.keys().next().value;
      if (oldest) thumbnailCache.delete(oldest);
    }
    thumbnailCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Outline / table of contents
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Turns the PDF outline into a flat-addressable tree. Each entry's destination
 * has to be resolved to a page number, which means a lookup per node — done
 * concurrently, and tolerant of the broken destinations real-world PDFs carry.
 */
export async function loadOutline(doc: PDFDocumentProxy): Promise<TocItem[]> {
  let outline: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>;
  try {
    outline = await doc.getOutline();
  } catch {
    return [];
  }
  if (!outline?.length) return [];

  async function pageOf(dest: string | unknown[] | null): Promise<number | null> {
    try {
      const resolved = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      const ref = Array.isArray(resolved) ? resolved[0] : null;
      if (!ref) return null;
      // An explicit destination can hold a page index directly instead of a ref.
      if (typeof ref === 'number') return ref + 1;
      const index = await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0]);
      return index + 1;
    } catch {
      return null;
    }
  }

  type RawNode = (typeof outline)[number];

  async function walk(nodes: RawNode[], level: number, path: string): Promise<TocItem[]> {
    const built = await Promise.all(
      nodes.map(async (node, i): Promise<TocItem | null> => {
        const id = `${path}${i}`;
        const page = await pageOf(node.dest);
        const children = node.items?.length ? await walk(node.items as RawNode[], level + 1, `${id}-`) : [];

        // A heading with no resolvable page is still useful as a parent, but
        // useless as a leaf — drop it rather than render a dead row.
        if (page === null && !children.length) return null;

        return {
          id,
          label: normalizeWhitespace(node.title) || 'Untitled section',
          target: page ?? children[0]?.target ?? 1,
          level,
          children: children.length ? children : undefined,
        };
      }),
    );

    return built.filter((item): item is TocItem => item !== null);
  }

  return walk(outline, 0, '');
}

/* ═══════════════════════════════════════════════════════════════════
   Search

   Extracting text from every page of a long book takes a while, so search
   streams: it reports hits per page as it goes and can be cancelled the moment
   the reader edits the query.
   ═══════════════════════════════════════════════════════════════════ */

const textCache = new WeakMap<PDFDocumentProxy, Map<number, string>>();

export async function pageText(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  let cache = textCache.get(doc);
  if (!cache) {
    cache = new Map();
    textCache.set(doc, cache);
  }
  const cached = cache.get(pageNumber);
  if (cached !== undefined) return cached;

  try {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = normalizeWhitespace(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        // pdf.js marks line ends; a joined page reads better with real spaces.
        .replace(/­/g, ''),
    );
    cache.set(pageNumber, text);
    return text;
  } catch {
    cache.set(pageNumber, '');
    return '';
  }
}

export type SearchProgress = {
  hits: SearchHit[];
  pagesScanned: number;
  pageCount: number;
  done: boolean;
};

export async function searchPdf(
  doc: PDFDocumentProxy,
  query: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: SearchProgress) => void;
    /** Stop early once this many hits are found. */
    maxHits?: number;
    /** Page to start from, so search feels instant near where you are reading. */
    startPage?: number;
  } = {},
): Promise<SearchHit[]> {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const maxHits = options.maxHits ?? 300;
  const total = doc.numPages;
  const hits: SearchHit[] = [];

  // Scan outward from where the reader is, then wrap, so the first results are
  // the nearby ones.
  const start = Math.min(Math.max(1, options.startPage ?? 1), total);
  const order = [
    ...Array.from({ length: total - start + 1 }, (_, i) => start + i),
    ...Array.from({ length: start - 1 }, (_, i) => i + 1),
  ];

  let scanned = 0;

  for (const pageNumber of order) {
    if (options.signal?.aborted) break;

    const text = await pageText(doc, pageNumber);
    scanned += 1;

    if (text) {
      const haystack = text.toLowerCase();
      let from = 0;
      for (;;) {
        const index = haystack.indexOf(needle, from);
        if (index === -1) break;

        const { excerpt, matchStart, matchLength } = excerptAround(text, index, needle.length);
        hits.push({
          id: `${pageNumber}:${index}`,
          locator: pageNumber,
          page: pageNumber,
          excerpt,
          matchStart,
          matchLength,
        });

        from = index + needle.length;
        if (hits.length >= maxHits) break;
      }
    }

    // Report every page so the panel fills in as it scans, and yield to the
    // event loop so typing stays responsive on a long book.
    options.onProgress?.({ hits: [...hits], pagesScanned: scanned, pageCount: total, done: false });
    if (hits.length >= maxHits) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // Reading order, not scan order, for the final list.
  hits.sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.id.localeCompare(b.id));
  options.onProgress?.({ hits, pagesScanned: scanned, pageCount: total, done: true });
  return hits;
}

/* ═══════════════════════════════════════════════════════════════════
   Teardown
   ═══════════════════════════════════════════════════════════════════ */

/** Releases page caches, then aborts outstanding range requests and shuts the
 *  worker down. Both halves matter: leaving the task alive keeps a worker
 *  thread and its socket open for the life of the tab. */
export async function destroyPdf(loaded: { doc: PDFDocumentProxy; task: PDFDocumentLoadingTask } | null) {
  if (!loaded) return;
  try {
    await loaded.doc.cleanup();
  } catch {
    // Already torn down.
  }
  try {
    await loaded.task.destroy();
  } catch {
    // Already torn down.
  }
}
