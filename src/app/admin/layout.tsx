import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth/session';
import { AdminNav } from '@/components/admin/admin-nav';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

/**
 * Everything under /admin is gated here, once, rather than in each page.
 *
 * The check reads the Appwrite account's labels, which only the server can set
 * — so unlike a row field or a cookie flag, a reader cannot grant themselves
 * access. Non-admins are sent to the shelf rather than shown a locked door.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  if (!user) redirect('/sign-in?next=/admin');
  if (!user.isAdmin) redirect('/');

  return (
    <div className="px-[var(--page-gutter)] pt-10 pb-20">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <p className="min-w-0 text-[0.8125rem] break-words text-graphite">
          Signed in as {user.name} · {user.email}
        </p>
        <Link href="/" className="link-rule text-[0.8125rem] text-graphite hover:text-ink">
          View the shelf
        </Link>
      </div>

      <div className="shelf-rule mt-5" />

      <AdminNav />

      <div className="mt-10">{children}</div>
    </div>
  );
}
