'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { ArrowRight } from 'lucide-react';

import { BookObject } from '@/components/books/book-object';
import { ButtonLink } from '@/components/ui/button';
import { formatAuthors } from '@/lib/utils';
import type { Book } from '@/types';

gsap.registerPlugin(useGSAP, SplitText);

/**
 * The hero: an epigraph and a book.
 *
 * The quote is the page's opening statement rather than a caption to one — it
 * says why this shelf opens without an account better than any marketing line
 * would, so it is set at heading size and given the whole left column. The
 * featured book stands beside it as the proof: a physical object, tipped
 * slightly, with a real contact shadow on the white.
 *
 * There is no explanatory paragraph on purpose. The quote makes the argument and
 * the two buttons are the answer to it; a blurb between them would only restate
 * both.
 *
 * The featured book sits in its own frame — a hairline border around the
 * cover with a caption plate underneath, the way a museum sets a specimen in
 * a case with its placard fixed to the bottom rather than propped beside it.
 * Title and author live inside that same frame, not as loose text nearby.
 *
 * The load sequence follows that reading: the quote's lines lift in, the
 * framed book rises and settles onto its shadow as one piece, then the
 * hairline draws and the attribution and buttons arrive under it.
 */
export function Hero({ book }: { book: Book }) {
  const scope = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        let split: SplitText | undefined;
        let tl: gsap.core.Timeline | undefined;
        let cancelled = false;

        // Fraunces loads with display:swap, so splitting before it arrives
        // would measure fallback line breaks and then never re-measure. Waiting
        // for fonts.ready means the split matches what the reader actually sees.
        document.fonts.ready.then(() => {
          if (cancelled) return;

          split = new SplitText('[data-hero-title]', {
            type: 'lines',
            // Each line gets a clipping parent so the lift reads as text rising
            // from behind a mask rather than sliding over the page.
            linesClass: 'overflow-hidden',
            // SplitText restores a readable copy for assistive tech itself.
            aria: 'auto',
          });

          tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

          tl.fromTo(split.lines, { yPercent: 108 }, { yPercent: 0, duration: 1, stagger: 0.08 })
            .fromTo(
              '[data-hero-book]',
              { opacity: 0, y: 44, rotateY: -14, rotateX: 4 },
              { opacity: 1, y: 0, rotateY: -7, rotateX: 1, duration: 1.15, ease: 'power3.out' },
              '-=0.85',
            )
            // The rule draws from the left, the way every shelf rule in the app
            // does, and closes the quote before the name under it.
            .fromTo(
              '[data-hero-rule]',
              { scaleX: 0, opacity: 0 },
              // Opacity as well as scale, so `will-reveal` can hold the rule
              // hidden until this runs. fonts.ready gates the whole timeline,
              // and a hairline sitting at full width until then would flash.
              { scaleX: 1, opacity: 1, duration: 0.8, ease: 'power3.inOut', transformOrigin: 'left center' },
              '-=0.7',
            )
            .fromTo('[data-hero-cite]', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.55 }, '-=0.3')
            .fromTo(
              '[data-hero-actions] > *',
              { opacity: 0, y: 10 },
              { opacity: 1, y: 0, duration: 0.5, stagger: 0.08 },
              '-=0.25',
            );
        });

        return () => {
          cancelled = true;
          tl?.kill();
          // Puts the original markup back, so copy-paste and screen readers are
          // unaffected by the split.
          split?.revert();
        };
      });

      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(
          [
            '[data-hero-title]',
            '[data-hero-book]',
            '[data-hero-rule]',
            '[data-hero-cite]',
            '[data-hero-actions] > *',
          ],
          { opacity: 1, y: 0, scaleX: 1, clearProps: 'transform' },
        );
      });

      return () => mm.revert();
    },
    { scope },
  );

  return (
    <section
      ref={scope}
      // Nearly no top padding: the header above already gives the page a top
      // edge, and on a 1080p-class laptop viewport every extra pixel here was
      // the difference between the featured card fitting above the fold and
      // its caption being cut off by the window. Trimmed again now that the
      // quote is a fixed three lines everywhere — that's real height it
      // didn't reliably take up before, and the padding had to give it room.
      className="relative px-[var(--page-gutter)] pt-10 pb-10 sm:pt-3 sm:pb-14"
      style={{ ['--bloom' as string]: book.coverColor ?? '#e9e9e9' }}
    >
      {/* Capped and centred rather than stretched to the window. Past about
          1350px a two-column hero either leaves a hole between the columns or
          sets the quote to an unreadable measure; holding the composition and
          letting the margins grow is the only version that stays composed on a
          wide monitor. */}
      <div className="mx-auto grid max-w-[84rem] items-center gap-10 sm:gap-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-20">
        {/* The quote carries the page, so it carries the h1 as well — figure and
            blockquote keep it a quotation rather than a slogan the app is
            claiming as its own.

            No max-width of its own: the grid track is the measure. A narrower
            cap inside a wide track is what left a column of empty page between
            the quote and the book.

            Broken onto three fixed lines with explicit <br />s rather than
            left to the browser's own wrapping. A wide grid track gives the
            browser room to fit more words per line than it did on a phone, so
            natural wrapping wasn't three lines everywhere the way it needs to
            be — it was three lines only on the widths narrow enough to force
            it. Fixing the break points makes the shape the same at every
            width instead of a function of viewport. */}
        <figure className="min-w-0">
          <blockquote>
            <h1
              data-hero-title
              // Capped lower than before (was 5.75rem): on a wide monitor the
              // uncapped size was most of the reason three lines of quote
              // needed more height than a laptop screen has to give.
              className="display text-[clamp(2rem,5.2vw,4.25rem)] leading-[1.18] text-ink"
            >
              &ldquo;Culture shouldn&rsquo;t exist
              <br />
              only for those who can
              <br />
              afford it&rdquo;
            </h1>
          </blockquote>

          {/* A short mark, not a divider. Under a quote this size a rule of
              middling length reads as an accident of layout. */}
          <div data-hero-rule className="shelf-rule will-reveal mt-6 w-24 sm:mt-8 sm:w-32" />

          <figcaption data-hero-cite className="label will-reveal mt-4">
            Arsi &ldquo;Hakita&rdquo; Patala · <cite className="not-italic">Ultrakill</cite>
          </figcaption>

          <div data-hero-actions className="mt-8 flex flex-wrap items-center gap-3 sm:mt-10">
            <ButtonLink href={`/read/${book.$id}`} variant="ink" size="lg" className="will-reveal">
              Start reading {book.title.length > 26 ? 'this' : book.title}
              <ArrowRight className="size-4" strokeWidth={1.5} />
            </ButtonLink>
            <ButtonLink href="/library" variant="outline" size="lg" className="will-reveal">
              Browse the shelf
            </ButtonLink>
          </div>
        </figure>

        {/* The featured book, held in one frame: cover on top, a caption plate
            fixed to the bottom of the same border. `perspective` sits on this
            static outer box rather than on the piece GSAP tilts — a rotated
            element needs an unrotated ancestor with perspective set, or the
            tilt below renders as a flat skew instead of a book leaning off a
            shelf. */}
        <div className="shrink-0 justify-self-center [perspective:1400px] lg:justify-self-end pt-8">
          <div
            data-hero-book
            className="will-reveal border border-ink bg-paper"
            // A deliberate lift off the page — the one shadow in the whole app
            // stronger than the book's own, because this is the one thing on
            // the page meant to look raised rather than flat. Inline rather
            // than an arbitrary Tailwind class: a shadow this soft needs two
            // layers, and that reads far better as real CSS than as one
            // underscore-escaped utility string.
            style={{ boxShadow: '0 1px 2px rgba(10,10,10,0.06), 0 34px 64px -30px rgba(10,10,10,0.4)' }}
          >
            <div className="p-5 sm:p-6">
              <BookObject book={book} size="xl" showMeta={false} priority href={`/book/${book.slug}`} />
            </div>

            {/* Title and author on one line rather than a labelled block —
                the eyebrow said what the frame already makes obvious, and
                stacking two more short lines under it cost more height than
                the words needed. */}
            <Link
              href={`/book/${book.slug}`}
              className="link-rule flex flex-wrap items-baseline gap-x-2 border-t border-rule px-5 py-3.5 sm:px-6"
            >
              <span className="display text-[1.0625rem] leading-tight text-ink">{book.title}</span>
              <span aria-hidden="true" className="text-mute">
                ·
              </span>
              <span className="text-[0.8125rem] text-graphite">{formatAuthors(book.authors)}</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
