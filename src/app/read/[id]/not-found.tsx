import Link from 'next/link';

import { ButtonLink } from '@/components/ui/button';

/**
 * The reader is full-screen and the site header and footer hide themselves on
 * /read/*, so an unresolved book id would otherwise land on a page with no way
 * out. This one carries its own exits.
 */
export default function ReadNotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-[var(--page-gutter)] text-center">
      <p className="label">404</p>
      <h1 className="display mt-6 max-w-lg text-[clamp(2rem,5.5vw,3.5rem)]">
        This book will not open.
      </h1>
      <p className="prose-read mt-5 max-w-md">
        The link points at a book that is no longer on the shelf, or at an id that never
        held one. Nothing you were reading has been lost.
      </p>

      <ButtonLink href="/library" variant="ink" size="lg" className="mt-9">
        Browse the library
      </ButtonLink>

      <Link href="/me" className="link-rule mt-8 text-[0.8125rem] text-graphite">
        Or pick up where you left off
      </Link>
    </div>
  );
}
