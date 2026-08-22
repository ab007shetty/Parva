'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Bookmark, BookMarked, Heart, LayoutGrid, LogOut, Settings2 } from 'lucide-react';

import { ButtonLink } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SessionUser } from '@/types';

/** Initials, rendered rather than fetched — no third-party avatar request. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase();
}

export function UserMenu({ user, stacked = false }: { user: SessionUser | null; stacked?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) {
    // Signing in is optional here, so the invitation states what it buys you
    // rather than demanding an account.
    return (
      <ButtonLink
        href={`/sign-in?next=${encodeURIComponent(pathname ?? '/')}`}
        variant="outline"
        size="sm"
        className={stacked ? 'w-full' : undefined}
      >
        Sign in
      </ButtonLink>
    );
  }

  if (stacked) {
    return (
      <div className="space-y-1">
        <div className="mb-3 flex items-center gap-3">
          <Avatar user={user} />
          <div className="min-w-0">
            <p className="truncate text-[0.8125rem] font-medium">{user.name}</p>
            <p className="truncate text-[0.75rem] text-graphite">{user.email}</p>
          </div>
        </div>
        <MenuLinks isAdmin={user.isAdmin} />
        <SignOutButton className="w-full justify-start px-0" />
      </div>
    );
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 border border-transparent p-0.5 transition-colors hover:border-rule"
      >
        <Avatar user={user} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.5rem)] w-60 border border-ink bg-paper p-1.5 shadow-[0_12px_40px_-16px_rgb(0_0_0/0.3)]"
        >
          <div className="border-b border-rule px-2.5 pb-3 pt-2">
            <p className="truncate text-[0.8125rem] font-medium">{user.name}</p>
            <p className="truncate text-[0.75rem] text-graphite">{user.email}</p>
            {user.isAdmin && <p className="label mt-2">Administrator</p>}
          </div>
          <div className="mt-1.5">
            <MenuLinks isAdmin={user.isAdmin} onNavigate={() => setOpen(false)} />
            <SignOutButton />
          </div>
        </div>
      )}
    </div>
  );
}

function Avatar({ user }: { user: SessionUser }) {
  return (
    <span
      className="grid size-8 shrink-0 place-items-center border border-rule bg-wash text-[0.6875rem] font-semibold tracking-[0.04em] text-ink"
      aria-hidden="true"
    >
      {initials(user.name)}
    </span>
  );
}

const ITEM =
  'flex items-center gap-2.5 px-2.5 py-2 text-[0.8125rem] text-ink-soft transition-colors hover:bg-wash hover:text-ink';

function MenuLinks({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  return (
    <>
      <Link href="/me" role="menuitem" onClick={onNavigate} className={ITEM}>
        <BookMarked className="size-3.5" strokeWidth={1.5} />
        Your shelf
      </Link>
      <Link href="/me/favorites" role="menuitem" onClick={onNavigate} className={ITEM}>
        <Heart className="size-3.5" strokeWidth={1.5} />
        Favourites
      </Link>
      <Link href="/me/bookmarks" role="menuitem" onClick={onNavigate} className={ITEM}>
        <Bookmark className="size-3.5" strokeWidth={1.5} />
        Bookmarks
      </Link>
      <Link href="/me/settings" role="menuitem" onClick={onNavigate} className={ITEM}>
        <Settings2 className="size-3.5" strokeWidth={1.5} />
        Reading settings
      </Link>
      {isAdmin && (
        <Link href="/admin" role="menuitem" onClick={onNavigate} className={cn(ITEM, 'border-t border-rule mt-1.5 pt-2.5')}>
          <LayoutGrid className="size-3.5" strokeWidth={1.5} />
          Admin
        </Link>
      )}
    </>
  );
}

/**
 * A form POST rather than a fetch. Sign-out has to work with JavaScript broken,
 * and a POST cannot be triggered by a remote page embedding an image.
 */
function SignOutButton({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <form action={`/api/auth/signout?next=${encodeURIComponent(pathname ?? '/')}`} method="post">
      <button type="submit" role="menuitem" className={cn(ITEM, 'w-full text-left', className)}>
        <LogOut className="size-3.5" strokeWidth={1.5} />
        Sign out
      </button>
    </form>
  );
}
