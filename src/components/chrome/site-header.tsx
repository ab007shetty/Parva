'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, Search, X } from 'lucide-react';

import { APP_NAME } from '@/lib/config';
import { cn } from '@/lib/utils';
import { UserMenu } from '@/components/chrome/user-menu';
import { openCommandPalette } from '@/components/chrome/command-palette';
import type { SessionUser } from '@/types';

const NAV = [
  { href: '/library', label: 'Library' },
  { href: '/authors', label: 'Authors' },
  { href: '/me', label: 'Your shelf' },
];

/**
 * The header is a hairline and a wordmark. It stays flat and un-blurred: a
 * frosted bar would put a translucent grey band across the top of a design
 * whose entire premise is that the white is real.
 */
export function SiteHeader({ user }: { user: SessionUser | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  /**
   * Dismisses the mobile panel.
   *
   * Every control in this header that navigates or opens something else has to
   * call this. Route changes are not enough on their own: tapping the wordmark
   * while already on the home page, or a nav link for the page you are on,
   * leaves the pathname untouched and would strand the panel open over the
   * content.
   */
  const close = () => setOpen(false);

  // The reader is full-screen and owns its own chrome.
  if (pathname?.startsWith('/read/')) return null;

  return (
    <header className="safe-t sticky top-0 z-60 border-b border-rule bg-paper">
      <div className="flex h-16 items-center gap-4 px-[var(--page-gutter)] sm:h-[4.5rem]">
        <Link
          href="/"
          onClick={close}
          className="display-tight shrink-0 text-[1.5rem] tracking-[-0.04em] sm:text-[1.75rem]"
          aria-label={`${APP_NAME} home`}
        >
          {APP_NAME}
        </Link>

        <nav className="ml-6 hidden items-center gap-7 md:flex" aria-label="Main">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'link-rule text-[0.8125rem] transition-colors',
                  active ? 'text-ink after:scale-x-100' : 'text-graphite hover:text-ink',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* The search affordance is a button, not an input: search lives in
              the command palette so one interaction covers books, authors and
              navigation. The visible shortcut teaches the keyboard path. */}
          <button
            type="button"
            onClick={() => {
              close();
              openCommandPalette();
            }}
            className="flex h-9 items-center gap-2.5 border border-rule px-3 text-[0.8125rem] text-graphite transition-colors hover:border-ink hover:text-ink"
          >
            <Search className="size-3.5" strokeWidth={1.5} />
            <span className="hidden sm:inline">Search books</span>
            <kbd className="ml-1 hidden border border-rule px-1.5 py-0.5 font-mono text-[0.625rem] text-mute sm:inline">
              /
            </kbd>
          </button>

          <div className="hidden md:block">
            <UserMenu user={user} />
          </div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="grid size-9 place-items-center border border-rule text-ink transition-colors hover:border-ink md:hidden"
          >
            {open ? <X className="size-4" strokeWidth={1.5} /> : <Menu className="size-4" strokeWidth={1.5} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-rule px-[var(--page-gutter)] py-6 md:hidden">
          <nav className="flex flex-col gap-1" aria-label="Main">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                // Closing on click rather than on route change also covers
                // tapping the page you are already on.
                onClick={close}
                className="display border-b border-rule-soft py-3 text-[1.375rem]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-6">
            <UserMenu user={user} stacked onNavigate={close} />
          </div>
        </div>
      )}
    </header>
  );
}
