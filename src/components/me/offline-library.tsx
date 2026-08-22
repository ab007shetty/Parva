'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trash2 } from 'lucide-react';

import { toast } from '@/components/ui/toast';
import {
  isOfflineSupported,
  listOfflineBooks,
  removeOfflineBook,
  type OfflineMeta,
} from '@/lib/reader/offline';
import { CoverThumb } from '@/components/books/cover-thumb';
import { formatBytes, formatRelative } from '@/lib/utils';

/** The slice of the search index this list needs to name a stored file. */
type IndexedBook = {
  title: string;
  slug: string;
  coverId: string | null;
  coverColor: string | null;
};

/**
 * What is stored on this device, and how much room it takes.
 *
 * Books saved for offline reading are invisible by design while they work, so
 * there has to be one place that says what is being kept and lets it go. Anyone
 * who has had an app quietly fill their phone knows why.
 */
export function OfflineLibrary() {
  const [records, setRecords] = useState<OfflineMeta[] | null>(null);
  const [known, setKnown] = useState<Record<string, IndexedBook>>({});

  useEffect(() => {
    // listOfflineBooks already answers with an empty list where IndexedDB is
    // unavailable, so both paths resolve asynchronously and neither writes
    // state during the effect itself.
    void listOfflineBooks().then(async (stored) => {
      setRecords(stored);
      if (!stored.length) return;

      // The store keeps bytes, not titles — a row of ids would be useless, so
      // resolve them against the catalogue.
      try {
        const response = await fetch('/api/search-index');
        const data = await response.json();
        const map: Record<string, IndexedBook> = {};
        for (const book of data.items ?? []) {
          map[book.$id] = {
            title: book.title,
            slug: book.slug,
            coverId: book.coverId ?? null,
            coverColor: book.coverColor ?? null,
          };
        }
        setKnown(map);
      } catch {
        // Ids will have to do.
      }
    });
  }, []);

  async function forget(bookId: string) {
    await removeOfflineBook(bookId);
    setRecords((current) => (current ?? []).filter((record) => record.bookId !== bookId));
    toast.done('Removed the offline copy.');
  }

  if (records === null) return null;

  const total = records.reduce((sum, record) => sum + record.bytes, 0);

  return (
    <section className="border-t border-rule pt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="label">Saved on this device</p>
        {records.length > 0 && (
          <p className="text-[0.75rem] text-graphite tnum">{formatBytes(total)} used</p>
        )}
      </div>

      {records.length ? (
        <ul className="mt-5 divide-y divide-rule-soft border-y border-rule-soft">
          {records.map((record) => {
            const book = known[record.bookId];
            return (
              <li key={record.bookId} className="flex items-center gap-3.5 py-3.5">
                {book && (
                  <CoverThumb
                    coverId={book.coverId}
                    coverColor={book.coverColor}
                    title={book.title}
                    width={28}
                    className="h-10 w-7"
                  />
                )}
                <div className="min-w-0 flex-1">
                  {book ? (
                    <Link href={`/book/${book.slug}`} className="link-rule block truncate text-[0.875rem]">
                      {book.title}
                    </Link>
                  ) : (
                    <p className="truncate font-mono text-[0.75rem] text-graphite">{record.bookId}</p>
                  )}
                  <p className="mt-0.5 text-[0.6875rem] text-mute tnum">
                    {formatBytes(record.bytes)} · opened {formatRelative(new Date(record.lastOpenedAt).toISOString())}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void forget(record.bookId)}
                  aria-label="Remove this offline copy"
                  className="shrink-0 p-1.5 text-mute transition-colors hover:text-ribbon"
                >
                  <Trash2 className="size-3.5" strokeWidth={1.5} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 max-w-md text-[0.8125rem] leading-relaxed text-graphite">
          {isOfflineSupported()
            ? 'Nothing saved yet. On any book, “Save offline” keeps the file here so it opens without a connection.'
            : 'This browser cannot store books for offline reading.'}
        </p>
      )}
    </section>
  );
}
