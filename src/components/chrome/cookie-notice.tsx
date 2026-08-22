'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';

import { APP_NAME } from '@/lib/config';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/hooks/use-reader-interaction';

/**
 * A notice, not a consent gate.
 *
 * Parva sets exactly one cookie and only at sign-in, and it is the session
 * itself — there is no version of this app where you can refuse it and still be
 * signed in. Offering an "accept or reject" choice over a cookie that cannot be
 * declined would be theatre, so this states the fact once and gets out of the
 * way. It does not dim the page, trap focus or block anything.
 */

const NOTICED_KEY = 'parva.noticed-cookies';

const listeners = new Set<() => void>();

/** Held in the module as well as in storage, so a browser that refuses
 *  localStorage still only shows the notice once per visit. */
let dismissedThisVisit = false;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Dismissing in one tab should settle every tab that is open.
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function hasNoticed() {
  if (dismissedThisVisit) return true;
  try {
    return localStorage.getItem(NOTICED_KEY) === '1';
  } catch {
    return false;
  }
}

/** The server has no storage to read. Nothing renders until `useHydrated`
 *  flips, so this value only ever has to match the empty server output. */
const noticedOnServer = () => false;

function markNoticed() {
  dismissedThisVisit = true;
  try {
    localStorage.setItem(NOTICED_KEY, '1');
  } catch {
    // Private mode, or storage is full. The dismissal holds for this visit.
  }
  for (const listener of listeners) listener();
}

export function CookieNotice() {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const noticed = useSyncExternalStore(subscribe, hasNoticed, noticedOnServer);

  // The reader is full-screen and deliberately uninterrupted.
  if (pathname?.startsWith('/read/')) return null;
  if (!hydrated || noticed) return null;

  return (
    <aside
      aria-label="Cookies"
      aria-live="polite"
      className="no-print fixed inset-x-0 bottom-0 z-80 animate-[cookie-notice-in_360ms_cubic-bezier(0.22,1,0.36,1)_both] border-t border-rule bg-paper"
    >
      <div className="safe-b [--safe-pad-b:0.875rem] flex flex-col gap-3 px-[var(--page-gutter)] pt-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:gap-5">
          <p className="label-ink shrink-0">Cookies</p>
          <p className="max-w-2xl text-[0.8125rem] leading-relaxed text-graphite">
            {APP_NAME} sets one cookie, and only when you sign in. It keeps you signed in
            and does nothing else — no analytics, no tracking, no third parties.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-5 sm:border-l sm:border-rule sm:pl-8">
          <Link
            href="/privacy"
            className="link-rule text-[0.75rem] text-graphite transition-colors hover:text-ink"
          >
            What is stored
          </Link>
          <Button variant="outline" size="sm" onClick={markNoticed}>
            Got it
          </Button>
        </div>
      </div>

      {/* The global reduced-motion rule in globals.css collapses this to
          nothing, so the bar simply appears. */}
      <style>{`
        @keyframes cookie-notice-in {
          from { opacity: 0; transform: translateY(100%); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </aside>
  );
}
