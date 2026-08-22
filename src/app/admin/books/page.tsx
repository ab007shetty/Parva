import Link from 'next/link';
import { Query } from 'node-appwrite';
import { ArrowRight, ExternalLink } from 'lucide-react';

import { createAdminClient } from '@/lib/appwrite/server';
import { DB_ID, TABLES } from '@/lib/config';
import { ButtonLink } from '@/components/ui/button';
import { CoverThumb } from '@/components/books/cover-thumb';
import { cn, formatBytes, formatRelative } from '@/lib/utils';
import type { BookRow } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * The whole catalogue, drafts included. Reads directly rather than through the
 * public helpers, because this is the one view that must show unpublished rows.
 */
export default async function AdminBooksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter = status === 'draft' || status === 'published' ? status : null;

  const { tables } = createAdminClient();

  let books: BookRow[] = [];
  let total = 0;
  let failed = false;

  try {
    const queries = [Query.orderDesc('$createdAt'), Query.limit(100)];
    if (filter) queries.unshift(Query.equal('status', filter));

    const result = await tables.listRows<BookRow>({
      databaseId: DB_ID,
      tableId: TABLES.books,
      queries,
      total: true,
    });
    books = result.rows;
    total = result.total;
  } catch {
    failed = true;
  }

  if (failed) {
    return (
      <div className="max-w-xl border border-ribbon p-6">
        <p className="label mb-3">Cannot read the catalogue</p>
        <p className="prose-read text-[0.9375rem]">
          Appwrite did not answer. If this is a new install, run <code className="font-mono">npm run setup</code>{' '}
          once to create the tables.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[2rem]">Books</h1>
          <p className="mt-2 text-[0.8125rem] text-graphite tnum">{total} in the catalogue</p>
        </div>
        <ButtonLink href="/admin/books/new" variant="ink" size="md">
          Add a book
          <ArrowRight className="size-4" strokeWidth={1.5} />
        </ButtonLink>
      </div>

      <div className="mt-6 flex items-center gap-1">
        <FilterTab href="/admin/books" label="All" active={!filter} />
        <FilterTab href="/admin/books?status=published" label="On the shelf" active={filter === 'published'} />
        <FilterTab href="/admin/books?status=draft" label="Drafts" active={filter === 'draft'} />
      </div>

      <div className="shelf-rule mt-5" />

      {books.length ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className="label py-3 pr-4">
                  Book
                </th>
                <th scope="col" className="label py-3 pr-4">
                  Format
                </th>
                <th scope="col" className="label py-3 pr-4">
                  Size
                </th>
                <th scope="col" className="label py-3 pr-4 text-right">
                  Opens
                </th>
                <th scope="col" className="label py-3 pr-4">
                  Status
                </th>
                <th scope="col" className="label py-3 pr-4">
                  Added
                </th>
                <th scope="col" className="label py-3">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {books.map((book) => (
                <tr key={book.$id} className="group border-b border-rule-soft transition-colors hover:bg-wash">
                  <td className="py-3 pr-4">
                    <Link href={`/admin/books/${book.$id}`} className="flex items-center gap-3">
                      <CoverThumb
                        coverId={book.coverId}
                        coverColor={book.coverColor}
                        title={book.title}
                        width={28}
                        className="h-10 w-7"
                      />
                      <span className="min-w-0">
                        <span className="block max-w-[22rem] truncate text-[0.875rem] text-ink">
                          {book.title}
                        </span>
                        <span className="block max-w-[22rem] truncate text-[0.75rem] text-graphite">
                          {(book.authors ?? []).join(', ') || 'Unknown author'}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-[0.75rem] text-graphite uppercase">{book.format}</td>
                  <td className="py-3 pr-4 text-[0.75rem] text-graphite tnum">
                    {formatBytes(book.fileSize)}
                  </td>
                  <td className="py-3 pr-4 text-right text-[0.75rem] text-graphite tnum">
                    {book.readCount ?? 0}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={cn(
                        'inline-flex h-6 items-center border px-2 text-[0.625rem] tracking-[0.1em] uppercase',
                        book.status === 'published'
                          ? 'border-ink text-ink'
                          : 'border-rule text-mute',
                      )}
                    >
                      {book.status === 'published' ? 'Shelved' : 'Draft'}
                    </span>
                    {book.featured && <span className="label ml-2">Featured</span>}
                  </td>
                  <td className="py-3 pr-4 text-[0.75rem] text-mute">{formatRelative(book.$createdAt)}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/admin/books/${book.$id}`}
                        className="px-2 py-1 text-[0.75rem] text-graphite hover:text-ink"
                      >
                        Edit
                      </Link>
                      {book.status === 'published' && (
                        <Link
                          href={`/book/${book.slug}`}
                          aria-label={`View ${book.title} on the shelf`}
                          className="p-1.5 text-mute hover:text-ink"
                        >
                          <ExternalLink className="size-3.5" strokeWidth={1.5} />
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="py-20 text-center">
          <p className="display text-[1.5rem]">
            {filter === 'draft' ? 'No drafts' : 'Nothing shelved yet'}
          </p>
          <p className="mt-2.5 text-[0.875rem] text-graphite">
            {filter === 'draft'
              ? 'Every book in the catalogue is visible to readers.'
              : 'Add the first book and it appears here.'}
          </p>
        </div>
      )}
    </div>
  );
}

function FilterTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'flex h-8 items-center border px-3 text-[0.75rem] transition-colors',
        active ? 'border-ink ink-fill' : 'border-rule text-graphite hover:border-ink hover:text-ink',
      )}
    >
      {label}
    </Link>
  );
}
