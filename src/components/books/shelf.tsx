'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';

import { BookObject, type BookObjectSize } from '@/components/books/book-object';
import { cn } from '@/lib/utils';
import type { Book } from '@/types';

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * A shelf: a row of books resting on a hairline.
 *
 * The load sequence is the point. The rule draws itself in from the left, then
 * the books rise into place above it with a stagger and their shadows settle.
 * It reads as someone shelving books, which is a truer description of what
 * this page is than a grid fading in.
 */
export function Shelf({
  title,
  books,
  size = 'md',
  moreHref,
  moreLabel = 'See all',
  progressByBookId,
  emptyMessage,
  eyebrow,
}: {
  title: string;
  books: Book[];
  size?: BookObjectSize;
  moreHref?: string;
  moreLabel?: string;
  /** Book id → percent, for the progress hairline on continue-reading shelves. */
  progressByBookId?: Record<string, number>;
  emptyMessage?: string;
  eyebrow?: string;
}) {
  const scope = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const rule = scope.current?.querySelector('[data-shelf-rule]');
      const items = gsap.utils.toArray<HTMLElement>('[data-shelf-item]', scope.current);
      if (!items.length) return;

      // matchMedia is how GSAP scopes animation to a media query and reverts it
      // cleanly when the query stops matching.
      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const tl = gsap.timeline({
          scrollTrigger: { trigger: scope.current, start: 'top 88%', once: true },
        });

        if (rule) {
          tl.fromTo(
            rule,
            { scaleX: 0 },
            { scaleX: 1, duration: 0.9, ease: 'power3.inOut', transformOrigin: 'left center' },
          );
        }

        tl.fromTo(
          items,
          { y: 26, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.7,
            ease: 'power3.out',
            stagger: 0.055,
          },
          rule ? '-=0.55' : 0,
        );
      });

      // Reduced motion still needs the books visible — they start at opacity 0.
      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set([...items, rule].filter(Boolean), { opacity: 1, scaleX: 1, y: 0 });
      });

      return () => mm.revert();
    },
    { scope, dependencies: [books.length] },
  );

  function nudge(direction: -1 | 1) {
    const el = scroller.current;
    if (!el) return;
    // Scroll by most of a viewport so a click always lands on a fresh set of
    // books rather than half-revealing the one you were already looking at.
    el.scrollBy({ left: direction * el.clientWidth * 0.82, behavior: 'smooth' });
  }

  if (!books.length) {
    if (!emptyMessage) return null;
    return (
      <section className="px-[var(--page-gutter)] py-14">
        <ShelfHeading title={title} eyebrow={eyebrow} />
        <div data-shelf-rule className="shelf-rule mt-5" />
        <p className="mt-6 max-w-md text-sm text-graphite">{emptyMessage}</p>
      </section>
    );
  }

  return (
    <section ref={scope} className="py-14">
      <div className="px-[var(--page-gutter)]">
        <div className="flex items-end justify-between gap-6">
          <ShelfHeading title={title} eyebrow={eyebrow} />

          <div className="flex items-center gap-1">
            {moreHref && (
              <Link
                href={moreHref}
                className="link-rule mr-3 hidden items-center gap-1.5 text-[0.8125rem] text-ink sm:inline-flex"
              >
                {moreLabel}
                <ArrowRight className="size-3.5" strokeWidth={1.5} />
              </Link>
            )}
            {/* Arrows are a convenience on top of native scroll, so they are
                hidden where a trackpad or thumb already does the job. */}
            <div className="hidden items-center gap-1 md:flex">
              <ShelfArrow direction="left" onClick={() => nudge(-1)} />
              <ShelfArrow direction="right" onClick={() => nudge(1)} />
            </div>
          </div>
        </div>

        <div data-shelf-rule className="shelf-rule mt-5" />
      </div>

      {/* The scroller is padded rather than margined so the first book aligns
          with the page gutter while its lift shadow is not clipped. */}
      <div
        ref={scroller}
        className="no-bar mt-7 flex snap-x snap-mandatory gap-7 overflow-x-auto scroll-pl-[var(--page-gutter)] px-[var(--page-gutter)] pb-4 sm:gap-9"
      >
        {books.map((book, index) => (
          <div key={book.$id} data-shelf-item className="snap-start will-reveal">
            <BookObject
              book={book}
              size={size}
              priority={index < 4}
              progressPercent={progressByBookId?.[book.$id] ?? null}
            />
          </div>
        ))}
      </div>

      {moreHref && (
        <div className="mt-2 px-[var(--page-gutter)] sm:hidden">
          <Link href={moreHref} className="link-rule inline-flex items-center gap-1.5 text-[0.8125rem]">
            {moreLabel}
            <ArrowRight className="size-3.5" strokeWidth={1.5} />
          </Link>
        </div>
      )}
    </section>
  );
}

function ShelfHeading({ title, eyebrow }: { title: string; eyebrow?: string }) {
  return (
    <div>
      {eyebrow && <p className="label mb-2.5">{eyebrow}</p>}
      <h2 className="display text-[1.75rem] sm:text-[2.125rem]">{title}</h2>
    </div>
  );
}

function ShelfArrow({ direction, onClick }: { direction: 'left' | 'right'; onClick: () => void }) {
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === 'left' ? 'Scroll shelf left' : 'Scroll shelf right'}
      className={cn(
        'grid size-9 place-items-center border border-rule text-ink transition-colors',
        'hover:border-ink hover:ink-fill',
      )}
    >
      <Icon className="size-4" strokeWidth={1.5} />
    </button>
  );
}
