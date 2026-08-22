'use client';

import Link from 'next/link';
import { useRef } from 'react';
import gsap from 'gsap';

import { cn, formatAuthors, readableInk } from '@/lib/utils';
import type { Book } from '@/types';

/**
 * The book object — the one element in this app with mass.
 *
 * Everything else is flat ink on white. A book gets a darkened spine down its
 * binding edge, a stack of page-edges on the fore-edge, and a contact shadow
 * that deepens as it lifts off the wall. On hover it tilts a couple of degrees
 * on its Y axis, the way a book does when you tip it off a shelf.
 *
 * Covers keep their real aspect ratio rather than being cropped to a uniform
 * grid, so a shelf has the ragged top edge a real one has.
 */

export type BookObjectSize = 'sm' | 'md' | 'lg' | 'xl';

const WIDTHS: Record<BookObjectSize, string> = {
  sm: 'w-[104px] sm:w-[116px]',
  md: 'w-[140px] sm:w-[158px]',
  lg: 'w-[180px] sm:w-[208px]',
  xl: 'w-[240px] sm:w-[300px]',
};

/** Rendered pixel width per size, so Appwrite resizes to what we actually paint. */
const PIXEL_WIDTHS: Record<BookObjectSize, number> = { sm: 232, md: 316, lg: 416, xl: 600 };

export function BookObject({
  book,
  size = 'md',
  href,
  priority = false,
  showMeta = true,
  progressPercent,
  className,
}: {
  book: Pick<Book, '$id' | 'title' | 'slug' | 'authors' | 'coverId' | 'coverColor' | 'coverRatio' | 'format'>;
  size?: BookObjectSize;
  href?: string;
  priority?: boolean;
  showMeta?: boolean;
  /** When present, a hairline progress bar sits on the bottom edge of the cover. */
  progressPercent?: number | null;
  className?: string;
}) {
  const root = useRef<HTMLAnchorElement>(null);
  const plate = useRef<HTMLDivElement>(null);

  // A real cover ratio means we can reserve the exact box before the image
  // arrives, so the shelf never reflows. 0.66 is the common trade-paperback
  // ratio and only stands in when we have no measurement.
  const ratio = book.coverRatio && book.coverRatio > 0.2 && book.coverRatio < 3 ? book.coverRatio : 0.66;
  const bloom = book.coverColor ?? '#e9e9e9';

  function lift(entering: boolean) {
    const el = plate.current;
    if (!el) return;
    // gsap.matchMedia would be overkill for one tween; the media query keeps
    // the tilt off for readers who asked for less motion.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.to(el, {
      rotateY: entering ? -6 : 0,
      rotateX: entering ? 1.5 : 0,
      y: entering ? -6 : 0,
      scale: entering ? 1.015 : 1,
      duration: entering ? 0.5 : 0.65,
      ease: entering ? 'power3.out' : 'power2.out',
      overwrite: 'auto',
    });
  }

  const cover = book.coverId
    ? `/api/cover/${book.coverId}?w=${PIXEL_WIDTHS[size]}`
    : null;

  const content = (
    <>
      {/* perspective lives on the wrapper so the tilt reads as depth rather
          than a skew */}
      <div className="[perspective:1200px]">
        <div
          ref={plate}
          className={cn('book-object w-full will-change-transform', WIDTHS[size])}
          style={{ aspectRatio: `${ratio}`, ['--bloom' as string]: bloom }}
        >
          {cover ? (
            /* A plain img, not next/image, and deliberately so.
             *
             * Covers come from /api/cover already sized for this slot — resized
             * at upload rather than per request, because Appwrite's own image
             * transformations are a paid feature and a free plan refuses them —
             * and cached hard for a week. next/image would add a second
             * re-encode of an already-appropriate image, and in Next 16 it also
             * needs images.localPatterns opened to arbitrary query strings,
             * which Next's docs flag as an enumeration vector. Lazy loading,
             * async decode and caching are all covered without it.
             *
             * `w` still rides along: it is honoured the moment the project is on
             * a plan that allows transforms, with no code change. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt=""
              // The first few covers are above the fold; the rest wait.
              loading={priority ? 'eager' : 'lazy'}
              fetchPriority={priority ? 'high' : 'auto'}
              decoding="async"
              // Without this, dragging a shelf sideways picks up the cover as a
              // drag image instead of scrolling.
              draggable={false}
              className="absolute inset-0 size-full rounded-[var(--book-radius)] object-cover"
            />
          ) : (
            <GeneratedCover title={book.title} authors={book.authors} bloom={bloom} />
          )}

          {/* The two pieces that make it a book and not a card. */}
          <span className="book-spine" aria-hidden="true" />
          <span className="book-edges" aria-hidden="true" />

          {typeof progressPercent === 'number' && progressPercent > 0 && (
            <span
              className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden rounded-b-[var(--book-radius)] bg-black/10"
              aria-hidden="true"
            >
              <span
                className="block h-full bg-ink"
                style={{ width: `${Math.min(100, Math.max(2, progressPercent))}%` }}
              />
            </span>
          )}
        </div>
      </div>

      {showMeta && (
        <div className={cn('mt-3.5', WIDTHS[size])}>
          <h3 className="display text-[0.9375rem] leading-[1.15] text-ink group-hover:underline group-hover:decoration-from-font group-hover:underline-offset-2">
            {book.title}
          </h3>
          <p className="mt-1 truncate text-[0.75rem] text-graphite">{formatAuthors(book.authors)}</p>
          {typeof progressPercent === 'number' && progressPercent > 0 && (
            <p className="mt-1 text-[0.6875rem] text-mute tnum">{Math.round(progressPercent)}% read</p>
          )}
        </div>
      )}
    </>
  );

  const target = href ?? `/book/${book.slug}`;

  return (
    <Link
      ref={root}
      href={target}
      className={cn('group block shrink-0 focus-visible:outline-offset-4', className)}
      onMouseEnter={() => lift(true)}
      onMouseLeave={() => lift(false)}
      onFocus={() => lift(true)}
      onBlur={() => lift(false)}
      aria-label={`${book.title} by ${formatAuthors(book.authors)}`}
    >
      {content}
    </Link>
  );
}

/**
 * When a book has no cover we set one rather than showing a grey box. Fraunces
 * at a large size on the sampled bloom colour, with the title broken across
 * lines — a real typographic cover, which is what a publisher would do.
 */
export function GeneratedCover({
  title,
  authors,
  bloom,
}: {
  title: string;
  authors?: string[] | null;
  bloom: string;
}) {
  const ink = readableInk(bloom);
  // Long titles need to step down or they overflow the plate.
  const scale = title.length > 60 ? 'text-[0.8rem]' : title.length > 32 ? 'text-[1rem]' : 'text-[1.35rem]';

  return (
    <div
      className="absolute inset-0 flex flex-col justify-between overflow-hidden rounded-[var(--book-radius)] p-[10%]"
      style={{ background: bloom, color: ink }}
      aria-hidden="true"
    >
      <p className="display" style={{ fontSize: 'inherit' }}>
        <span className={cn('display block leading-[1.05]', scale)}>{title}</span>
      </p>
      <p className="text-[0.5625rem] tracking-[0.14em] uppercase opacity-70">
        {formatAuthors(authors, 1)}
      </p>
    </div>
  );
}
