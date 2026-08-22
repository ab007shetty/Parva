'use client';

import Link from 'next/link';
import { BookX } from 'lucide-react';

import { Button, ButtonLink } from '@/components/ui/button';
import { formatAuthors } from '@/lib/utils';
import type { Book } from '@/types';

/**
 * Opening cover.
 *
 * A large book opening is worth a moment, so instead of a spinner the reader
 * gets the book's own title while the file streams — and a real percentage,
 * because "loading" with no end in sight is what makes a wait feel broken.
 */
export function ReaderLoading({ book, percent }: { book: Book; percent: number }) {
  return (
    <div className="absolute inset-0 z-70 flex flex-col items-center justify-center bg-paper px-6">
      <p className="label mb-5">Opening</p>
      <p className="display max-w-xl text-center text-[clamp(1.75rem,5vw,3rem)]">{book.title}</p>
      <p className="mt-3 text-[0.8125rem] text-graphite">{formatAuthors(book.authors)}</p>

      <div className="mt-10 h-[2px] w-56 max-w-full bg-rule" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div
          className="h-full bg-ink transition-[width] duration-200 ease-out"
          style={{ width: `${percent > 0 ? percent : 6}%` }}
        />
      </div>

      <p className="mt-3 text-[0.6875rem] text-mute tnum">
        {percent > 0 ? `${percent}%` : 'Reaching for it'}
      </p>
    </div>
  );
}

/**
 * The book did not open. Says what happened and offers the two things that
 * actually help, rather than apologising.
 */
export function ReaderError({
  message,
  bookSlug,
  onRetry,
}: {
  message: string | null;
  bookSlug: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper px-6 text-center">
      <BookX className="size-6 text-faint" strokeWidth={1.25} />
      <h1 className="display mt-6 max-w-lg text-[clamp(1.75rem,5vw,2.75rem)]">This book would not open</h1>
      <p className="prose-read mt-4 max-w-md text-[0.9375rem]">
        {message ?? 'Something went wrong while reading the file.'}
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button variant="ink" onClick={onRetry}>
          Try again
        </Button>
        <ButtonLink href={`/book/${bookSlug}`} variant="outline">
          Back to the book
        </ButtonLink>
      </div>

      <Link href="/library" className="link-rule mt-6 text-[0.8125rem] text-graphite">
        Browse the shelf instead
      </Link>
    </div>
  );
}
