import Link from 'next/link';

import { ButtonLink } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-[var(--page-gutter)] text-center">
      <p className="label">404</p>
      <h1 className="display mt-6 max-w-xl text-[clamp(2.25rem,6vw,4rem)]">
        That page is not on the shelf.
      </h1>
      <p className="prose-read mt-5 max-w-md">
        The link may be old, or the book may have been unshelved. The library is one click
        away either way.
      </p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <ButtonLink href="/library" variant="ink" size="lg">
          Browse the library
        </ButtonLink>
        <ButtonLink href="/" variant="outline" size="lg">
          Back to the shelf
        </ButtonLink>
      </div>

      <Link href="/authors" className="link-rule mt-8 text-[0.8125rem] text-graphite">
        Or look through the authors
      </Link>
    </div>
  );
}
