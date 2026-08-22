'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Heart,
  Highlighter,
  List,
  Maximize2,
  RotateCw,
  Search,
  Settings2,
  Sliders,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

import { IconButton } from '@/components/ui/button';
import { cn, clamp, describeTimeLeft, estimateMinutesLeft } from '@/lib/utils';
import type { PanelKey } from '@/components/reader/reader-panels';
import type { Book, ReaderPosition, SessionUser } from '@/types';

/**
 * Reader chrome: a top bar for identity and exits, a bottom bar for movement.
 *
 * Both fade out once the reader stops touching anything, leaving only the
 * progress hairline at the very bottom of the screen. That hairline is the one
 * piece of interface that never hides — it is the only thing you actually need
 * while reading.
 */
export function ReaderChrome({
  book,
  user,
  visible,
  position,
  isPdf,
  isFavorite,
  bookmarkCount,
  highlightCount,
  speaking,
  activePanel,
  onPanel,
  onTurn,
  onGoToPage,
  onScrub,
  onBookmark,
  onToggleFavorite,
  onToggleReadAloud,
  onRotate,
  onFullscreen,
}: {
  book: Book;
  user: SessionUser | null;
  visible: boolean;
  position: ReaderPosition;
  isPdf: boolean;
  isFavorite: boolean;
  bookmarkCount: number;
  highlightCount: number;
  speaking: boolean;
  activePanel: PanelKey | null;
  onPanel: (key: PanelKey) => void;
  onTurn: (direction: 1 | -1) => void;
  onGoToPage: (page: number) => void;
  onScrub: (percent: number) => void;
  onBookmark: () => void;
  onToggleFavorite: () => void;
  onToggleReadAloud: () => void;
  onRotate: () => void;
  onFullscreen: () => void;
}) {
  const minutesLeft = estimateMinutesLeft(Math.max(0, position.totalPages - position.page));

  return (
    <>
      {/* ── Top ─────────────────────────────────────────────────── */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 z-40 transition-all duration-300',
          visible ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0',
        )}
      >
        {/* Faded out is not the same as gone: without dropping pointer events
            the invisible bar still swallows clicks along the top edge, so
            tapping there to turn a page would silently hit a hidden button. */}
        <div
          className={cn(
            'safe-t [--safe-pad-t:0.5rem] flex items-center gap-3 border-b border-rule bg-paper/95 px-3 pb-2 backdrop-blur-[2px] sm:px-4',
            visible ? 'pointer-events-auto' : 'pointer-events-none',
          )}
        >
          <Link
            href={`/book/${book.slug}`}
            aria-label="Close the book"
            className="touch-target relative grid size-9 shrink-0 place-items-center text-graphite transition-colors hover:text-ink"
          >
            <X className="size-4" strokeWidth={1.5} />
          </Link>

          <div className="min-w-0 flex-1">
            <p className="display truncate text-[0.9375rem] leading-tight">{book.title}</p>
            {position.label && (
              <p className="truncate text-[0.6875rem] text-graphite">{position.label}</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              label="Contents"
              size="sm"
              active={activePanel === 'contents'}
              onClick={() => onPanel('contents')}
            >
              <List className="size-4" strokeWidth={1.5} />
            </IconButton>

            <IconButton
              label="Search in book"
              size="sm"
              active={activePanel === 'search'}
              onClick={() => onPanel('search')}
            >
              <Search className="size-4" strokeWidth={1.5} />
            </IconButton>

            <IconButton
              label={`Bookmarks${bookmarkCount ? ` (${bookmarkCount})` : ''}`}
              size="sm"
              active={activePanel === 'bookmarks'}
              onClick={() => onPanel('bookmarks')}
              className="relative"
            >
              <Bookmark className="size-4" strokeWidth={1.5} />
              {bookmarkCount > 0 && (
                <span className="absolute top-1 right-1 size-1.5 rounded-full bg-ribbon" aria-hidden="true" />
              )}
            </IconButton>

            <IconButton label="Add a bookmark here" size="sm" onClick={onBookmark}>
              <Bookmark className="size-4 fill-current" strokeWidth={1.5} />
            </IconButton>

            <IconButton
              label={`Highlights${highlightCount ? ` (${highlightCount})` : ''}`}
              size="sm"
              active={activePanel === 'highlights'}
              onClick={() => onPanel('highlights')}
              className="relative"
            >
              <Highlighter className="size-4" strokeWidth={1.5} />
              {highlightCount > 0 && (
                <span
                  className="absolute top-1 right-1 size-1.5 rounded-full bg-marker-deep"
                  aria-hidden="true"
                />
              )}
            </IconButton>

            <IconButton
              label={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
              size="sm"
              onClick={onToggleFavorite}
            >
              <Heart className={cn('size-4', isFavorite && 'fill-ribbon text-ribbon')} strokeWidth={1.5} />
            </IconButton>

            <IconButton
              label={speaking ? 'Stop reading aloud' : 'Read aloud'}
              size="sm"
              active={speaking}
              onClick={onToggleReadAloud}
            >
              {speaking ? <VolumeX className="size-4" strokeWidth={1.5} /> : <Volume2 className="size-4" strokeWidth={1.5} />}
            </IconButton>

            <IconButton
              label="Reading settings"
              size="sm"
              active={activePanel === 'settings'}
              onClick={() => onPanel('settings')}
            >
              <Settings2 className="size-4" strokeWidth={1.5} />
            </IconButton>
          </div>
        </div>
      </div>

      {/* ── Bottom ──────────────────────────────────────────────── */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 z-40 transition-all duration-300',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
        )}
      >
        <div
          className={cn(
            'border-t border-rule bg-paper/95 backdrop-blur-[2px]',
            visible ? 'pointer-events-auto' : 'pointer-events-none',
          )}
        >
          <div className="safe-b [--safe-pad-b:0.625rem] flex items-center gap-3 px-3 pt-2.5 sm:px-4">
            <IconButton label="Previous page" size="sm" onClick={() => onTurn(-1)}>
              <ChevronLeft className="size-4" strokeWidth={1.5} />
            </IconButton>

            {isPdf ? (
              <PageJump page={position.page} total={position.totalPages} onGoToPage={onGoToPage} />
            ) : (
              <span className="shrink-0 text-[0.75rem] text-graphite tnum">
                {Math.round(position.percent)}%
              </span>
            )}

            <IconButton label="Next page" size="sm" onClick={() => onTurn(1)}>
              <ChevronRight className="size-4" strokeWidth={1.5} />
            </IconButton>

            <Scrubber percent={position.percent} onScrub={onScrub} />

            <span className="hidden shrink-0 text-[0.6875rem] text-graphite sm:inline">
              {describeTimeLeft(minutesLeft)}
            </span>

            <div className="flex shrink-0 items-center gap-0.5">
              <IconButton
                label="Page thumbnails"
                size="sm"
                active={activePanel === 'thumbnails'}
                onClick={() => onPanel('thumbnails')}
                className="hidden sm:inline-grid"
              >
                <Sliders className="size-4 rotate-90" strokeWidth={1.5} />
              </IconButton>
              {isPdf && (
                <IconButton label="Rotate pages" size="sm" onClick={onRotate} className="hidden sm:inline-grid">
                  <RotateCw className="size-4" strokeWidth={1.5} />
                </IconButton>
              )}
              <IconButton label="Full screen" size="sm" onClick={onFullscreen}>
                <Maximize2 className="size-4" strokeWidth={1.5} />
              </IconButton>
            </div>
          </div>
        </div>
      </div>

      {/* The one always-visible element: how far through the book you are. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-50 h-[2px] bg-transparent"
        aria-hidden="true"
      >
        <div
          className="h-full bg-ink transition-[width] duration-300 ease-out"
          style={{ width: `${clamp(position.percent, 0, 100)}%` }}
        />
      </div>

      {!user && visible && (
        <div className="pointer-events-auto absolute bottom-16 left-1/2 z-40 -translate-x-1/2 sm:bottom-20">
          <Link
            href={`/sign-in?next=/read/${book.$id}`}
            className="flex items-center gap-2 border border-rule bg-paper px-3.5 py-2 text-[0.75rem] text-graphite shadow-sm transition-colors hover:border-ink hover:text-ink"
          >
            Sign in to keep your place
          </Link>
        </div>
      )}
    </>
  );
}

/** Editable page number. Typing a page and pressing enter jumps there. */
function PageJump({
  page,
  total,
  onGoToPage,
}: {
  page: number;
  total: number;
  onGoToPage: (page: number) => void;
}) {
  // `draft` only holds what the reader is typing. The rest of the time the
  // field simply shows the current page, derived — so there is no state to keep
  // in sync with the book, and no chance of the two disagreeing.
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const shown = draft ?? String(page);

  function commit() {
    const next = Number(draft);
    setDraft(null);
    if (Number.isFinite(next) && next >= 1 && next <= total) onGoToPage(next);
  }

  return (
    <div className="flex shrink-0 items-center gap-1 text-[0.75rem] text-graphite">
      <input
        ref={input}
        value={shown}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onFocus={() => setDraft(String(page))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            input.current?.blur();
          }
          if (e.key === 'Escape') {
            // Abandon the edit; the field falls back to showing the real page.
            setDraft(null);
            input.current?.blur();
          }
        }}
        aria-label={`Page number, ${page} of ${total}`}
        inputMode="numeric"
        className="w-11 border border-rule bg-transparent px-1.5 py-1 text-center text-ink tnum outline-none focus:border-ink"
      />
      <span className="tnum whitespace-nowrap">/ {total}</span>
    </div>
  );
}

/**
 * The scrubber. Drag to move through the book.
 *
 * A native range input would be one line, but it cannot be styled down to a
 * hairline with a square thumb in every browser, and this is the most-touched
 * control in the app.
 */
function Scrubber({ percent, onScrub }: { percent: number; onScrub: (percent: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);

  function percentAt(clientX: number) {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
  }

  useEffect(() => {
    if (!dragging) return;

    function onMove(event: PointerEvent) {
      setPreview(percentAt(event.clientX));
    }
    function onUp(event: PointerEvent) {
      const value = percentAt(event.clientX);
      setDragging(false);
      setPreview(null);
      onScrub(value);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, onScrub]);

  const shown = preview ?? percent;

  return (
    <div className="relative min-w-0 flex-1">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Position in book"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${Math.round(shown)} percent`}
        onPointerDown={(event) => {
          event.preventDefault();
          setDragging(true);
          setPreview(percentAt(event.clientX));
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') onScrub(clamp(percent + 1, 0, 100));
          if (event.key === 'ArrowLeft') onScrub(clamp(percent - 1, 0, 100));
          if (event.key === 'PageUp') onScrub(clamp(percent + 10, 0, 100));
          if (event.key === 'PageDown') onScrub(clamp(percent - 10, 0, 100));
        }}
        className="group relative flex h-9 cursor-pointer touch-none items-center"
      >
        <div className="h-[3px] w-full bg-rule">
          <div className="h-full bg-ink" style={{ width: `${shown}%` }} />
        </div>
        {/* A square thumb, because the whole design has no rounded controls. */}
        <div
          className={cn(
            'absolute size-2.5 -translate-x-1/2 bg-ink transition-transform',
            dragging ? 'scale-150' : 'scale-100 group-hover:scale-125',
          )}
          style={{ left: `${shown}%` }}
        />
      </div>

      {dragging && preview !== null && (
        <div
          className="pointer-events-none absolute -top-8 -translate-x-1/2 border border-ink bg-paper px-2 py-1 text-[0.6875rem] text-ink tnum"
          style={{ left: `${preview}%` }}
        >
          {Math.round(preview)}%
        </div>
      )}
    </div>
  );
}
