import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { adminCounts } from '@/lib/appwrite/reader-data';
import { getRecentBooks } from '@/lib/appwrite/books';
import { ButtonLink } from '@/components/ui/button';
import { CoverThumb } from '@/components/books/cover-thumb';
import { formatRelative, pluralize } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function AdminOverview() {
  // A fresh install has no tables yet; the dashboard should say so rather than
  // crashing with an Appwrite 404.
  let counts: Awaited<ReturnType<typeof adminCounts>> | null = null;
  let setupError: string | null = null;

  try {
    counts = await adminCounts();
  } catch (error) {
    setupError =
      (error as { code?: number } | null)?.code === 404
        ? 'The database is not set up yet. Run `npm run setup` once and reload this page.'
        : 'Could not reach Appwrite. Check the values in .env.';
  }

  const recent = counts ? await getRecentBooks(6).catch(() => []) : [];

  if (setupError) {
    return (
      <div className="max-w-xl border border-ribbon p-6">
        <p className="label mb-3">Not ready yet</p>
        <p className="prose-read text-[0.9375rem]">{setupError}</p>
        <p className="mt-4 font-mono text-[0.75rem] text-graphite">npm run setup</p>
      </div>
    );
  }

  const stats = [
    { label: 'On the shelf', value: counts!.published, hint: 'Visible to readers' },
    { label: 'Drafts', value: counts!.drafts, hint: 'Not yet published' },
    { label: 'Readers', value: counts!.readers, hint: 'Signed in at least once' },
    { label: 'Books opened', value: counts!.sessions, hint: 'Reading positions saved' },
  ];

  return (
    <div className="space-y-14">
      <section>
        <dl className="grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="bg-paper p-6">
              <dt className="label">{stat.label}</dt>
              <dd className="display mt-3 text-[2.5rem] tnum">{stat.value}</dd>
              <p className="mt-1 text-[0.6875rem] text-mute">{stat.hint}</p>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="label">Latest additions</p>
            <h2 className="display mt-2.5 text-[1.75rem]">Recently shelved</h2>
          </div>
          <ButtonLink href="/admin/books/new" variant="ink" size="md">
            Add a book
            <ArrowRight className="size-4" strokeWidth={1.5} />
          </ButtonLink>
        </div>

        <div className="shelf-rule mt-5" />

        {recent.length ? (
          <ul className="divide-y divide-rule-soft">
            {recent.map((book) => (
              <li key={book.$id}>
                <Link
                  href={`/admin/books/${book.$id}`}
                  className="flex items-center gap-4 py-3.5 transition-colors hover:bg-wash"
                >
                  <CoverThumb
                    coverId={book.coverId}
                    coverColor={book.coverColor}
                    title={book.title}
                    width={32}
                    className="h-11 w-8"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.875rem] text-ink">{book.title}</span>
                    <span className="block truncate text-[0.75rem] text-graphite">
                      {(book.authors ?? []).join(', ') || 'Unknown author'}
                    </span>
                  </span>
                  <span className="label shrink-0">{book.format}</span>
                  <span className="hidden shrink-0 text-[0.6875rem] text-mute sm:inline">
                    {formatRelative(book.$createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-12 text-[0.875rem] text-graphite">
            Nothing shelved yet. {pluralize(0, 'book')} — add the first one.
          </p>
        )}
      </section>
    </div>
  );
}
