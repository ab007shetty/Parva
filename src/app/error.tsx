'use client';

import { useEffect } from 'react';

import { Button, ButtonLink } from '@/components/ui/button';

/**
 * The last line of defence. Says what a reader can do, not what went wrong
 * internally — the stack trace belongs in the logs, not on the page.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[parva] unhandled error', error);
  }, [error]);

  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-[var(--page-gutter)] text-center">
      <p className="label">Something broke</p>
      <h1 className="display mt-6 max-w-xl text-[clamp(2rem,5.5vw,3.5rem)]">
        This page did not load.
      </h1>
      <p className="prose-read mt-5 max-w-md">
        Trying again usually works. If it does not, the library is still there.
      </p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <Button variant="ink" size="lg" onClick={reset}>
          Try again
        </Button>
        <ButtonLink href="/library" variant="outline" size="lg">
          Browse the library
        </ButtonLink>
      </div>

      {error.digest && (
        <p className="mt-8 font-mono text-[0.6875rem] text-mute">Reference {error.digest}</p>
      )}
    </div>
  );
}
