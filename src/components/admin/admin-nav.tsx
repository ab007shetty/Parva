'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/books', label: 'Books' },
  { href: '/admin/books/new', label: 'Add a book' },
  { href: '/admin/readers', label: 'Readers' },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="mt-8 flex flex-wrap items-center gap-1" aria-label="Admin">
      {LINKS.map((link) => {
        // /admin must not light up for every child route, but /admin/books
        // should stay lit while editing a book under it.
        const active =
          link.href === '/admin'
            ? pathname === '/admin'
            : link.href === '/admin/books'
              ? pathname === '/admin/books' || /^\/admin\/books\/[^/]+$/.test(pathname ?? '')
              : pathname === link.href;

        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'flex h-10 items-center border px-3.5 text-[0.8125rem] transition-colors sm:h-9',
              active ? 'border-ink ink-fill' : 'border-rule text-graphite hover:border-ink hover:text-ink',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
