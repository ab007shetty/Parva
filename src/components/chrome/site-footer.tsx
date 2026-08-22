'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Mail } from 'lucide-react';

import { APP_NAME } from '@/lib/config';

/** Where a reader offers a book that isn't on the shelf yet. Kept as one
 *  constant rather than typed twice, since a mailto: and its own display text
 *  drifting apart is exactly the kind of thing nobody notices until a reader
 *  reports a dead link. */
const CONTRIBUTE_EMAIL = 'ab007shetty@gmail.com';

/**
 * The footer states what the app is and what it costs you — which for this app
 * is nothing, and that is worth saying plainly rather than burying in an About
 * page nobody opens.
 */
export function SiteFooter() {
  const pathname = usePathname();
  if (pathname?.startsWith('/read/')) return null;

  return (
    <footer className="mt-24 border-t border-rule">
      {/* grid-cols-2 from the base breakpoint up — Browse and Your shelf sit
          side by side even on a phone, rather than stacking into one long
          column a thumb has to scroll through. */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-10 px-[var(--page-gutter)] py-14 sm:gap-12 sm:py-16 lg:grid-cols-4">
        <div className="col-span-2">
          <p className="display-tight text-[2rem]">{APP_NAME}</p>
          <p className="prose-read mt-3 max-w-sm text-[0.9375rem]">
            Every book here opens without an account. Sign in and the shelf starts
            remembering — your place, your bookmarks, what you meant to finish.
          </p>

          {/* A framed callout rather than a plain line — this is the one thing
              in the footer meant to catch an eye that's already scrolled past
              the nav links, not blend in with them. */}
          <p className="mt-6 inline-flex max-w-sm items-center gap-2.5 border border-rule bg-wash px-3.5 py-2.5 text-[0.75rem] text-ink-soft">
            <Mail className="size-4 shrink-0 text-graphite" strokeWidth={1.5} />
            <span>
              Know a book that belongs here?{' '}
              <a href={`mailto:${CONTRIBUTE_EMAIL}`} className="link-rule text-ink">
                Email {CONTRIBUTE_EMAIL}
              </a>
              .
            </span>
          </p>
        </div>

        <nav aria-label="Browse">
          <p className="label mb-4">Browse</p>
          <ul className="space-y-2.5 text-[0.8125rem]">
            <FooterLink href="/library">All books</FooterLink>
            <FooterLink href="/authors">Authors</FooterLink>
            <FooterLink href="/library?sort=recent">Recently added</FooterLink>
            <FooterLink href="/library?sort=popular">Most read</FooterLink>
          </ul>
        </nav>

        <nav aria-label="Your shelf">
          <p className="label mb-4">Your shelf</p>
          <ul className="space-y-2.5 text-[0.8125rem]">
            <FooterLink href="/me">Continue reading</FooterLink>
            <FooterLink href="/me/favorites">Favourites</FooterLink>
            <FooterLink href="/me/bookmarks">Bookmarks</FooterLink>
            <FooterLink href="/me/settings">Reading settings</FooterLink>
          </ul>
        </nav>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-rule px-[var(--page-gutter)] py-6 text-[0.75rem] text-graphite">
        <Link href="/privacy" className="link-rule shrink-0 transition-colors hover:text-ink">
          Privacy
        </Link>
        <p className="shrink-0">
          Press <kbd className="border border-rule px-1.5 py-0.5 font-mono text-[0.625rem]">/</kbd> anywhere to
          search.
        </p>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="link-rule text-graphite transition-colors hover:text-ink">
        {children}
      </Link>
    </li>
  );
}
