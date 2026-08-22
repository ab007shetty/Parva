'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, CornerDownLeft, Search } from 'lucide-react';

import { cn, formatAuthors, looseIncludes } from '@/lib/utils';
import { CoverThumb } from '@/components/books/cover-thumb';

/**
 * Search and navigation in one surface, opened with / or ⌘K.
 *
 * The whole published catalogue is small enough to fetch once and filter in the
 * browser, which makes matching instant and diacritic-insensitive — "Gita"
 * finds "Gītā" — without a round-trip per keystroke. A server-side fulltext
 * search on `title` is still there for deep links and no-JS browsing.
 */

type IndexEntry = {
  $id: string;
  title: string;
  slug: string;
  authors: string[];
  format: 'pdf' | 'epub';
  coverId: string | null;
  coverColor: string | null;
};

const OPEN_EVENT = 'parva:open-palette';

export function openCommandPalette(initialQuery = '') {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: initialQuery }));
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<IndexEntry[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  /* ── Opening ─────────────────────────────────────────────────────── */

  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<string>).detail;
      setQuery(detail ?? '');
      setOpen(true);
    }
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;

      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /* ── Data ────────────────────────────────────────────────────────── */

  // Fetched on first open, not on mount: most visits never open the palette.
  useEffect(() => {
    if (!open || index) return;
    let cancelled = false;
    fetch('/api/search-index')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => {
        if (!cancelled) setIndex(data.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setIndex([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, index]);

  useEffect(() => {
    if (open) {
      // Focus after paint so the caret lands reliably.
      requestAnimationFrame(() => inputRef.current?.focus());
      document.documentElement.style.overflow = 'hidden';
    } else {
      document.documentElement.style.overflow = '';
    }
    return () => {
      document.documentElement.style.overflow = '';
    };
  }, [open]);

  const results = useMemo(() => {
    if (!index) return [];
    const q = query.trim();
    if (!q) return index.slice(0, 8);

    const scored = index
      .map((entry) => {
        const title = entry.title ?? '';
        const authors = (entry.authors ?? []).join(' ');
        // Rank a title hit above an author hit, and a prefix above a
        // mid-string match, so the obvious answer is first.
        let score = 0;
        if (looseIncludes(title, q)) score += title.toLowerCase().startsWith(q.toLowerCase()) ? 100 : 60;
        if (looseIncludes(authors, q)) score += 30;
        return { entry, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));

    return scored.slice(0, 12).map((r) => r.entry);
  }, [index, query]);

  const go = useCallback(
    (entry: IndexEntry) => {
      setOpen(false);
      router.push(`/book/${entry.slug}`);
    },
    [router],
  );

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const picked = results[cursor];
      if (picked) go(picked);
      else if (query.trim()) {
        setOpen(false);
        router.push(`/library?q=${encodeURIComponent(query.trim())}`);
      }
    }
  }

  // Keep the active row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-100">
      <button
        type="button"
        aria-label="Close search"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-paper/70"
      />

      <div className="safe-t relative mx-auto mt-[8dvh] w-[min(38rem,calc(100vw-2rem))] sm:mt-[12dvh]">
        <div className="border border-ink bg-paper shadow-[0_24px_70px_-24px_rgb(0_0_0/0.35)]">
          <div className="flex items-center gap-3 border-b border-rule px-4">
            <Search className="size-4 shrink-0 text-graphite" strokeWidth={1.5} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                // A new query means a new result list, so the highlighted row
                // goes back to the top. Done here rather than in an effect —
                // it is a consequence of the keystroke, not of the render.
                setCursor(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search by title or author"
              aria-label="Search books"
              className="h-14 min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-mute"
            />
            <kbd className="border border-rule px-1.5 py-0.5 font-mono text-[0.625rem] text-mute">esc</kbd>
          </div>

          {index === null ? (
            <p className="px-4 py-8 text-center text-[0.8125rem] text-graphite">Loading the shelf…</p>
          ) : results.length ? (
            <ul ref={listRef} className="max-h-[min(52dvh,26rem)] overflow-y-auto py-1.5" role="listbox">
              {results.map((entry, i) => (
                <li key={entry.$id} role="option" aria-selected={i === cursor}>
                  <button
                    type="button"
                    onClick={() => go(entry)}
                    onMouseEnter={() => setCursor(i)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                      i === cursor ? 'bg-wash' : 'bg-transparent',
                    )}
                  >
                    <CoverThumb
                      coverId={entry.coverId}
                      coverColor={entry.coverColor}
                      title={entry.title}
                      width={24}
                      className="h-9 w-6"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.875rem] text-ink">{entry.title}</span>
                      <span className="block truncate text-[0.75rem] text-graphite">
                        {formatAuthors(entry.authors)}
                      </span>
                    </span>
                    <span className="label shrink-0">{entry.format}</span>
                    {i === cursor && (
                      <CornerDownLeft className="size-3.5 shrink-0 text-mute" strokeWidth={1.5} />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-10 text-center">
              <BookOpen className="mx-auto size-5 text-faint" strokeWidth={1.25} />
              <p className="mt-3 text-[0.8125rem] text-graphite">
                Nothing matches “{query.trim()}”.
              </p>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push('/library');
                }}
                className="link-rule mt-2 text-[0.8125rem] text-ink"
              >
                Browse the whole shelf
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
