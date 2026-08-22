'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Page-by-page rather than infinite scroll. A library is something you come
 * back to, and a URL that means "page 3 of the Sanskrit texts" is worth more
 * than a scroll position that cannot be shared or bookmarked.
 */
export function Pager({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (lastPage <= 1) return null;

  function go(target: number) {
    const next = new URLSearchParams(searchParams.toString());
    if (target <= 1) next.delete('page');
    else next.set('page', String(target));
    router.push(`/library?${next.toString()}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Window of pages around the current one, always including first and last, so
  // the control stays a fixed width on a 40-page collection.
  const numbers = pageWindow(page, lastPage);

  return (
    <nav className="mt-16 flex items-center justify-between border-t border-rule pt-6" aria-label="Pages">
      <button
        type="button"
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        className="flex h-9 items-center gap-2 border border-rule px-3 text-[0.8125rem] transition-colors enabled:hover:border-ink disabled:opacity-30"
      >
        <ChevronLeft className="size-3.5" strokeWidth={1.5} />
        <span className="hidden sm:inline">Previous</span>
      </button>

      <ul className="flex items-center gap-1">
        {numbers.map((entry, i) =>
          entry === null ? (
            <li key={`gap-${i}`} className="px-1 text-[0.75rem] text-mute" aria-hidden="true">
              ·
            </li>
          ) : (
            <li key={entry}>
              <button
                type="button"
                onClick={() => go(entry)}
                aria-current={entry === page ? 'page' : undefined}
                className={cn(
                  'grid size-9 place-items-center text-[0.8125rem] tnum transition-colors',
                  entry === page ? 'ink-fill' : 'text-graphite hover:bg-wash hover:text-ink',
                )}
              >
                {entry}
              </button>
            </li>
          ),
        )}
      </ul>

      <button
        type="button"
        onClick={() => go(page + 1)}
        disabled={page >= lastPage}
        className="flex h-9 items-center gap-2 border border-rule px-3 text-[0.8125rem] transition-colors enabled:hover:border-ink disabled:opacity-30"
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight className="size-3.5" strokeWidth={1.5} />
      </button>
    </nav>
  );
}

/** `null` marks an elision. */
function pageWindow(page: number, last: number): (number | null)[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);

  const around = [page - 1, page, page + 1].filter((n) => n > 1 && n < last);
  const set = new Set<number>([1, ...around, last]);
  const sorted = Array.from(set).sort((a, b) => a - b);

  const out: (number | null)[] = [];
  let previous = 0;
  for (const n of sorted) {
    if (previous && n - previous > 1) out.push(null);
    out.push(n);
    previous = n;
  }
  return out;
}
