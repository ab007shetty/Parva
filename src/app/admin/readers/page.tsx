import { Query } from 'node-appwrite';

import { createAdminClient } from '@/lib/appwrite/server';
import { DB_ID, TABLES } from '@/lib/config';
import { formatRelative } from '@/lib/utils';
import type { UserRow } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * The users table.
 *
 * Deliberately read-only and deliberately thin. It answers "who uses this and
 * when were they last here", which is what a librarian needs. It does not show
 * what anyone is reading: progress and bookmarks belong to the reader, and
 * putting them on an admin screen would make this a surveillance tool rather
 * than a catalogue.
 */
export default async function AdminReadersPage() {
  const { tables } = createAdminClient();

  let readers: UserRow[] = [];
  let total = 0;
  let failed = false;

  try {
    const result = await tables.listRows<UserRow>({
      databaseId: DB_ID,
      tableId: TABLES.users,
      queries: [Query.orderDesc('lastSeenAt'), Query.limit(100)],
      total: true,
    });
    readers = result.rows;
    total = result.total;
  } catch {
    failed = true;
  }

  if (failed) {
    return (
      <div className="max-w-xl border border-ribbon p-6">
        <p className="label mb-3">Cannot read the reader list</p>
        <p className="prose-read text-[0.9375rem]">
          If this is a new install, run <code className="font-mono">npm run setup</code> once to create the
          tables.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="display text-[2rem]">Readers</h1>
      <p className="mt-2 max-w-lg text-[0.8125rem] text-graphite">
        {total} {total === 1 ? 'person has' : 'people have'} signed in. Reading is open to
        everyone, so most visitors never appear here.
      </p>

      <div className="shelf-rule mt-5" />

      {readers.length ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className="label py-3 pr-4">
                  Reader
                </th>
                <th scope="col" className="label py-3 pr-4">
                  Email
                </th>
                <th scope="col" className="label py-3 pr-4">
                  Last seen
                </th>
                <th scope="col" className="label py-3">
                  Joined
                </th>
              </tr>
            </thead>
            <tbody>
              {readers.map((reader) => (
                <tr key={reader.$id} className="border-b border-rule-soft">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-3">
                      <span
                        className="grid size-8 shrink-0 place-items-center border border-rule bg-wash text-[0.625rem] font-semibold"
                        aria-hidden="true"
                      >
                        {initials(reader.name)}
                      </span>
                      <span className="truncate text-[0.875rem]">{reader.name || 'Reader'}</span>
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-[0.8125rem] text-graphite">{reader.email}</td>
                  <td className="py-3 pr-4 text-[0.75rem] text-graphite">
                    {formatRelative(reader.lastSeenAt)}
                  </td>
                  <td className="py-3 text-[0.75rem] text-mute">{formatRelative(reader.$createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="py-20 text-center">
          <p className="display text-[1.5rem]">Nobody has signed in yet</p>
          <p className="mt-2.5 max-w-md mx-auto text-[0.875rem] text-graphite">
            That is not a problem — books open without an account. People appear here once
            they sign in to keep a place or a bookmark.
          </p>
        </div>
      )}
    </div>
  );
}

function initials(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase();
}
