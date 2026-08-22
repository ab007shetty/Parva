'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { BookObject } from '@/components/books/book-object';
import type { Book } from '@/types';

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * The browse grid.
 *
 * Books keep their real proportions rather than being cropped to a uniform
 * tile, and each row aligns to a shelf line at its base — so a tall folio and a
 * squat paperback sit on the same shelf at their true heights, the way they
 * would on a real one. `items-end` is what does the work: covers grow upward
 * from the line instead of being centred in a box.
 */
export function BookGrid({
  books,
  progressByBookId,
}: {
  books: Book[];
  progressByBookId?: Record<string, number>;
}) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        // Batched so a 24-book page is one animation with a stagger rather than
        // 24 independent ScrollTriggers.
        ScrollTrigger.batch('[data-grid-item]', {
          start: 'top 94%',
          once: true,
          onEnter: (batch) =>
            gsap.fromTo(
              batch,
              { y: 22, opacity: 0 },
              { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out', stagger: 0.045, overwrite: true },
            ),
        });
      });

      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set('[data-grid-item]', { opacity: 1, y: 0 });
      });

      return () => mm.revert();
    },
    { scope, dependencies: [books.length] },
  );

  return (
    <div ref={scope}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 sm:gap-x-8 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {books.map((book, index) => (
          <div key={book.$id} data-grid-item className="will-reveal flex flex-col justify-end">
            <BookObject
              book={book}
              size="md"
              priority={index < 6}
              progressPercent={progressByBookId?.[book.$id] ?? null}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
