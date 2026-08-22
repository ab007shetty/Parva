import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth/session';
import { ReadingSettingsPanel } from '@/components/me/reading-settings-panel';
import { OfflineLibrary } from '@/components/me/offline-library';

export const metadata: Metadata = { title: 'Reading settings', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in?next=/me/settings');

  return (
    <div className="mx-auto max-w-2xl px-[var(--page-gutter)] pt-12 pb-20 sm:pt-16">
      <h1 className="display text-[clamp(2rem,5vw,3rem)]">Reading settings</h1>
      <p className="prose-read mt-4">
        These belong to this device rather than your account, so the way you read on a
        phone can differ from the way you read on a desk. They apply to every book you
        open here.
      </p>

      <div className="mt-12 space-y-14">
        <ReadingSettingsPanel />
        <OfflineLibrary />

        <section className="border-t border-rule pt-10">
          <p className="label mb-4">Account</p>
          <dl className="space-y-3 text-[0.875rem]">
            <div className="flex justify-between gap-4">
              <dt className="text-graphite">Name</dt>
              <dd>{user.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-graphite">Email</dt>
              <dd className="truncate">{user.email}</dd>
            </div>
            {user.isAdmin && (
              <div className="flex justify-between gap-4">
                <dt className="text-graphite">Role</dt>
                <dd>Administrator</dd>
              </div>
            )}
          </dl>

          <form action="/api/auth/signout?next=/" method="post" className="mt-6">
            <button
              type="submit"
              className="link-rule text-[0.8125rem] text-graphite hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
