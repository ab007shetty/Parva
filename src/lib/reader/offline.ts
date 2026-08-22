'use client';

/**
 * Offline book storage.
 *
 * A reader who has opened a book on a train should keep reading when the tunnel
 * arrives. Book files are large, so they go in IndexedDB rather than
 * localStorage, keyed by book id, with the total size capped and the least
 * recently opened evicted first.
 *
 * This is opt-in per book ("Save for offline"), because silently downloading
 * 200 MB onto someone's phone is not a favour.
 */

const DB_NAME = 'parva-offline';
const DB_VERSION = 1;
const STORE = 'books';

/** Total budget across all saved books. Browsers will refuse well before this
 *  on a phone; the cap keeps us from being the reason storage fills up. */
const MAX_TOTAL_BYTES = 600 * 1024 * 1024;

export type OfflineRecord = {
  bookId: string;
  blob: Blob;
  contentType: string;
  bytes: number;
  savedAt: number;
  lastOpenedAt: number;
};

export type OfflineMeta = Omit<OfflineRecord, 'blob'>;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'bookId' });
        // Eviction walks in last-opened order, so it needs an index.
        store.createIndex('lastOpenedAt', 'lastOpenedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      }),
  );
}

export function isOfflineSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function getOfflineBook(bookId: string): Promise<OfflineRecord | null> {
  if (!isOfflineSupported()) return null;
  try {
    const record = await tx<OfflineRecord | undefined>('readonly', (store) => store.get(bookId));
    if (!record) return null;

    // Touch it so eviction keeps the books actually being read.
    void tx('readwrite', (store) => store.put({ ...record, lastOpenedAt: Date.now() })).catch(() => {});
    return record;
  } catch {
    return null;
  }
}

export async function listOfflineBooks(): Promise<OfflineMeta[]> {
  if (!isOfflineSupported()) return [];
  try {
    const all = await tx<OfflineRecord[]>('readonly', (store) => store.getAll());
    return all
      .map(({ blob: _blob, ...meta }) => meta)
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  } catch {
    return [];
  }
}

/**
 * Downloads and stores a book. Reports progress so the UI can show it, because
 * a silent multi-minute download reads as a broken button.
 */
export async function saveBookOffline(
  bookId: string,
  url: string,
  options: { onProgress?: (received: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<OfflineMeta> {
  if (!isOfflineSupported()) throw new Error('This browser cannot store books offline.');

  const response = await fetch(url, { signal: options.signal });
  if (!response.ok) throw new Error('That book could not be downloaded.');

  const total = Number(response.headers.get('content-length') ?? 0);
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';

  let blob: Blob;

  if (response.body && total > 0) {
    // Read in chunks so progress is real rather than a spinner.
    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value as unknown as BlobPart);
        received += value.byteLength;
        options.onProgress?.(received, total);
      }
    }
    blob = new Blob(chunks, { type: contentType });
  } else {
    blob = await response.blob();
  }

  await evictUntilRoomFor(blob.size, bookId);

  const record: OfflineRecord = {
    bookId,
    blob,
    contentType,
    bytes: blob.size,
    savedAt: Date.now(),
    lastOpenedAt: Date.now(),
  };

  await tx('readwrite', (store) => store.put(record));

  const { blob: _blob, ...meta } = record;
  return meta;
}

export async function removeOfflineBook(bookId: string): Promise<void> {
  if (!isOfflineSupported()) return;
  try {
    await tx('readwrite', (store) => store.delete(bookId));
  } catch {
    // Nothing stored.
  }
}

/** Frees space by dropping the least recently opened books first. */
async function evictUntilRoomFor(incomingBytes: number, keepBookId: string): Promise<void> {
  const all = await listOfflineBooks();
  let used = all.reduce((sum, record) => sum + record.bytes, 0);

  // A book being re-saved does not count against itself.
  const existing = all.find((record) => record.bookId === keepBookId);
  if (existing) used -= existing.bytes;

  if (used + incomingBytes <= MAX_TOTAL_BYTES) return;

  const oldestFirst = all
    .filter((record) => record.bookId !== keepBookId)
    .sort((a, b) => a.lastOpenedAt - b.lastOpenedAt);

  for (const record of oldestFirst) {
    if (used + incomingBytes <= MAX_TOTAL_BYTES) break;
    await removeOfflineBook(record.bookId);
    used -= record.bytes;
  }
}

/**
 * A blob: URL for a stored book, or null if it is not stored. pdf.js and
 * epub.js both accept one in place of a network URL, so the reader needs no
 * other change to work offline.
 *
 * The caller must revoke the URL when the book closes.
 */
export async function offlineObjectUrl(bookId: string): Promise<string | null> {
  const record = await getOfflineBook(bookId);
  if (!record) return null;
  return URL.createObjectURL(record.blob);
}
