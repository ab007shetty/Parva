'use client';

import { useEffect, useState } from 'react';
import { CornerDownRight, X } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * "Where you left off."
 *
 * Deliberately an offer, not an action. Being teleported to page 84 the instant
 * a book opens is disorienting — especially when you came back to re-read
 * something earlier. So the reader gets a quiet pill that says where they
 * stopped, and can ignore it.
 *
 * It steps aside on its own after a while, because an offer that never leaves
 * becomes furniture.
 */
export function ResumePill({
  page,
  percent,
  isPdf,
  onResume,
  onDismiss,
}: {
  page: number;
  percent: number;
  isPdf: boolean;
  onResume: () => void;
  onDismiss: () => void;
}) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    // One frame so the transition has something to animate from.
    const raf = requestAnimationFrame(() => setEntered(true));
    const timer = setTimeout(onDismiss, 12_000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [onDismiss]);

  return (
    <div
      className={cn(
        'absolute bottom-20 left-1/2 z-50 -translate-x-1/2 transition-all duration-500 sm:bottom-24',
        entered ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
      )}
      style={{ transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' }}
    >
      <div className="flex items-center gap-1 border border-ink bg-paper shadow-[0_10px_36px_-14px_rgb(0_0_0/0.35)]">
        <button
          type="button"
          onClick={onResume}
          className="flex items-center gap-2.5 px-4 py-2.5 text-[0.8125rem] text-ink transition-colors hover:bg-wash"
        >
          <CornerDownRight className="size-3.5 shrink-0 text-graphite" strokeWidth={1.5} />
          <span>
            Resume at {isPdf ? `page ${page}` : `${Math.round(percent)}%`}
          </span>
        </button>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Stay on this page"
          className="border-l border-rule px-2.5 py-3 text-mute transition-colors hover:text-ink"
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
