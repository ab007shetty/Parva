'use client';

import { useEffect, useState } from 'react';
import { Check, Info, TriangleAlert, X } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * A small toast system, written rather than installed.
 *
 * A library would bring its own visual language — rounded cards, drop shadows,
 * a coloured left border — and every one of those fights the flat-ink-on-white
 * rule. Sixty lines here buys total control, and the API is the same shape a
 * library would give us.
 *
 * Toasts speak in the interface's voice: they say what happened, in the past
 * tense, and never apologise.
 */

export type ToastTone = 'note' | 'done' | 'warn';

type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
  /** Optional single action, e.g. Undo on a deleted bookmark. */
  action?: { label: string; run: () => void };
};

const listeners = new Set<(toasts: Toast[]) => void>();
let queue: Toast[] = [];
let nextId = 1;

function publish() {
  for (const listener of listeners) listener([...queue]);
}

function push(message: string, tone: ToastTone, action?: Toast['action'], ms = 4200) {
  const toast: Toast = { id: nextId++, message, tone, action };
  queue = [...queue, toast].slice(-3);
  publish();
  // An action needs longer to be noticed and clicked.
  setTimeout(() => dismiss(toast.id), action ? ms + 2400 : ms);
  return toast.id;
}

function dismiss(id: number) {
  queue = queue.filter((t) => t.id !== id);
  publish();
}

export const toast = {
  note: (message: string, action?: Toast['action']) => push(message, 'note', action),
  done: (message: string, action?: Toast['action']) => push(message, 'done', action),
  warn: (message: string, action?: Toast['action']) => push(message, 'warn', action),
  dismiss,
};

const ICONS = { note: Info, done: Check, warn: TriangleAlert } as const;

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    listeners.add(setToasts);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);

  if (!toasts.length) return null;

  return (
    <div
      // polite, not assertive: a saved bookmark should not interrupt a screen
      // reader mid-sentence.
      aria-live="polite"
      aria-atomic="false"
      className="safe-b [--safe-pad-b:1.5rem] pointer-events-none fixed inset-x-0 bottom-0 z-90 flex flex-col items-center gap-2 px-4 sm:items-end sm:px-6"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 border bg-paper px-4 py-3 shadow-[0_8px_30px_-12px_rgb(0_0_0/0.25)]',
              'animate-[toast-in_260ms_cubic-bezier(0.22,1,0.36,1)]',
              t.tone === 'warn' ? 'border-ribbon' : 'border-ink',
            )}
          >
            <Icon
              className={cn('mt-0.5 size-4 shrink-0', t.tone === 'warn' ? 'text-ribbon' : 'text-ink')}
              strokeWidth={1.75}
            />
            {/* min-w-0 overrides a flex item's default min-width: auto — without
                it, a message with no early wrap point (a filename, a long
                unbroken title) can force this row wider than its box instead of
                wrapping. break-words is the second line of defence, for a
                single token too long to wrap at all. */}
            <p className="min-w-0 flex-1 leading-snug break-words text-[0.8125rem] text-ink">
              {t.message}
            </p>

            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.run();
                  dismiss(t.id);
                }}
                className="link-rule shrink-0 text-[0.75rem] font-medium text-ink"
              >
                {t.action.label}
              </button>
            )}

            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="-mr-1 shrink-0 text-mute transition-colors hover:text-ink"
            >
              <X className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        );
      })}

      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
