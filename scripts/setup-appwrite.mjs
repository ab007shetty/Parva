#!/usr/bin/env node
/**
 * Provisions everything Parva needs inside an Appwrite project:
 * a database, seven tables with their columns and indexes, and storage.
 *
 * Written to survive a free-tier project: it adopts an existing database when
 * the plan allows no more, finds the largest file size the instance accepts,
 * shares one bucket between books and covers, and backs off on rate limits.
 *
 * Safe to run repeatedly. Anything that already exists is left alone, so this
 * doubles as a migration when a new column is added to the schema.
 *
 *   npm run setup
 *
 * Requires NEXT_PUBLIC_APPWRITE_ENDPOINT, NEXT_PUBLIC_APPWRITE_PROJECT_ID and
 * APPWRITE_API_KEY in .env.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Client,
  Compression,
  Permission,
  Role,
  Storage,
  TablesDB,
  TablesDBIndexType,
} from 'node-appwrite';

/* ── Environment ────────────────────────────────────────────────────── */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Minimal .env reader — not worth a dependency for six variables.
 *
 * A value already in the real environment wins, so CI or a shell export can
 * override the file without editing it.
 */
function loadEnv() {
  let contents;
  try {
    contents = readFileSync(resolve(root, '.env'), 'utf8');
  } catch {
    // No .env. The environment may already carry what we need.
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '');
  }
}

loadEnv();

const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY;

/** What .env asks for. */
const DB_ID = process.env.APPWRITE_DATABASE_ID || 'parva';

/** What we actually build in — see ensureDatabase(). */
let activeDbId = DB_ID;
const BOOKS_BUCKET = process.env.APPWRITE_BOOKS_BUCKET_ID || 'parva_books';
const COVERS_BUCKET = process.env.APPWRITE_COVERS_BUCKET_ID || BOOKS_BUCKET;

const ADMIN_LABEL = 'admin';

/**
 * Appwrite refuses a bucket whose maximumFileSize exceeds what the instance
 * allows, and that ceiling varies a lot: Appwrite Cloud's free plan caps a
 * single file at 50,000,000 bytes, Pro much higher, and a self-hosted instance
 * at whatever `_APP_STORAGE_LIMIT` says (30 MiB out of the box).
 *
 * Rather than hardcode a number that fails on most installs, the bucket is
 * created at the largest of these the instance will accept, and the effective
 * value is printed so it can be raised deliberately.
 *
 * The rungs are byte counts rather than "MB × 1024 × 1024", and that is the
 * whole point of this list. Cloud's ceiling is decimal — 50,000,000 — so a
 * rung computed as 50 MiB is 52,428,800, which Appwrite rejects outright with
 * "Value must be a valid range between 1 and 50,000,000". An earlier version
 * of this ladder did exactly that, so the 50 rung could never succeed and
 * every free-plan install silently settled on the 30 MiB rung below it,
 * roughly 18 MB short of what the plan actually allows.
 */
const REQUESTED_BOOK_MB = Number(process.env.NEXT_PUBLIC_MAX_BOOK_MB) || 0;
const MIB = 1024 * 1024;

const BOOK_SIZE_LADDER_BYTES = [
  // An explicit request goes first, whatever its size. Sorting the whole list
  // would bury it — asking for 50 would still try 2 GB first and waste four
  // rejected calls getting back down to it.
  ...(REQUESTED_BOOK_MB > 0 ? [REQUESTED_BOOK_MB * MIB] : []),
  ...[2048 * MIB, 512 * MIB, 200 * MIB, 100 * MIB, 50_000_000, 30 * MIB, 10 * MIB].sort(
    (a, b) => b - a,
  ),
].filter((bytes, i, all) => all.indexOf(bytes) === i);

const MAX_COVER_BYTES = 8 * 1024 * 1024;

const BOOK_EXTENSIONS = ['pdf', 'epub'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'];

/**
 * Whether covers get their own bucket.
 *
 * Appwrite Cloud's free plan allows exactly one bucket per project, so by
 * default covers live alongside the books. Setting APPWRITE_COVERS_BUCKET_ID to
 * something other than the books bucket asks for them to be separated.
 */
const COVERS_SEPARATE = COVERS_BUCKET !== BOOKS_BUCKET;

if (!ENDPOINT || !PROJECT_ID || !API_KEY) {
  console.error(`
  Missing configuration.

  Set these in .env:
    NEXT_PUBLIC_APPWRITE_ENDPOINT   (e.g. https://fra.cloud.appwrite.io/v1)
    NEXT_PUBLIC_APPWRITE_PROJECT_ID
    APPWRITE_API_KEY                (Console → Overview → Integrations → API keys)

  See SETUP.md for where each of these comes from.
`);
  process.exit(1);
}

const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setKey(API_KEY);
const tablesDb = new TablesDB(client);
const storage = new Storage(client);

/* ── Output ─────────────────────────────────────────────────────────── */

const ok = (message) => console.log(`  ✓ ${message}`);
const skip = (message) => console.log(`  · ${message}`);
const warn = (message) => console.log(`  ! ${message}`);
const step = (message) => console.log(`\n${message}`);

const isDuplicate = (error) => error?.code === 409;
const isMissing = (error) => error?.code === 404;
const isRateLimited = (error) => error?.code === 429;

/** Appwrite says this when the plan's quota for a resource is used up. */
const isPlanLimit = (error) =>
  error?.type === 'general_usage_exceeded' ||
  // What Appwrite Cloud actually returns today for an over-quota bucket or
  // database — verified against a live free-plan project. The prose match
  // below already caught it, but only for as long as the wording holds.
  error?.type === 'additional_resource_not_allowed' ||
  /maximum number of|plan has reached|upgrade to increase/i.test(String(error?.message ?? ''));

/** Appwrite rate-limits schema writes; a short pause keeps a long run from
 *  tripping it, and column creation is async server-side anyway. */
const breathe = (ms = 220) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs a create call, treating "already exists" as success. Everything in this
 * script is expressed through it, which is what makes re-running safe.
 */
async function ensure(label, run) {
  // A full schema run is around a hundred sequential writes, and Appwrite
  // rate-limits. Backing off and retrying is the difference between a clean
  // provision and aborting two thirds of the way through.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await run();
      ok(label);
      await breathe();
      return 'created';
    } catch (error) {
      if (isDuplicate(error)) {
        skip(`${label} — already there`);
        return 'exists';
      }
      if (isRateLimited(error) && attempt < 4) {
        const wait = 2000 * (attempt + 1);
        warn(`rate limited — waiting ${wait / 1000}s and retrying ${label}`);
        await breathe(wait);
        continue;
      }
      throw error;
    }
  }
}

/* ── Schema ─────────────────────────────────────────────────────────── */

/**
 * Column definitions, declared rather than imperative, so adding a field to the
 * app means adding one line here and re-running the script.
 *
 * `size` applies to string columns. Appwrite's string limit is
 * generous, but a column sized to its real content indexes far better, so
 * these are deliberate rather than uniform.
 */
const TABLES = [
  {
    id: 'users',
    name: 'Users',
    // Rows are written by the API key only; nobody reads this table from the
    // browser, so no row permissions are granted.
    permissions: [],
    rowSecurity: false,
    columns: [
      { type: 'string', key: 'userId', size: 64, required: true },
      { type: 'string', key: 'name', size: 240, required: false },
      { type: 'string', key: 'email', size: 320, required: false },
      { type: 'string', key: 'avatarUrl', size: 1024, required: false },
      { type: 'datetime', key: 'lastSeenAt', required: false },
    ],
    indexes: [
      { key: 'userId_unique', type: TablesDBIndexType.Unique, columns: ['userId'] },
      { key: 'lastSeen', type: TablesDBIndexType.Key, columns: ['lastSeenAt'] },
    ],
  },

  {
    id: 'books',
    name: 'Books',
    // The catalogue is public reading material. Reads are open; writes only
    // ever happen through the API key.
    permissions: [Permission.read(Role.any())],
    rowSecurity: false,
    columns: [
      { type: 'string', key: 'title', size: 320, required: true },
      { type: 'string', key: 'slug', size: 160, required: true },
      { type: 'string', key: 'subtitle', size: 320, required: false },
      { type: 'string', key: 'authors', size: 200, required: false, array: true },
      // Descriptions can be long; `text` avoids sizing a string column for the
      // worst case.
      { type: 'text', key: 'description', required: false },
      { type: 'string', key: 'tags', size: 80, required: false, array: true },
      { type: 'string', key: 'language', size: 16, required: false },
      { type: 'enum', key: 'format', elements: ['pdf', 'epub'], required: true },

      { type: 'string', key: 'fileId', size: 64, required: true },
      { type: 'string', key: 'fileName', size: 320, required: false },
      { type: 'integer', key: 'fileSize', required: false, min: 0 },

      { type: 'string', key: 'coverId', size: 64, required: false },
      { type: 'string', key: 'coverColor', size: 16, required: false },
      { type: 'float', key: 'coverRatio', required: false, min: 0.05, max: 10 },

      { type: 'integer', key: 'pageCount', required: false, min: 0 },
      { type: 'string', key: 'publisher', size: 240, required: false },
      { type: 'integer', key: 'publishedYear', required: false, min: 0, max: 3000 },
      { type: 'string', key: 'isbn', size: 40, required: false },
      { type: 'string', key: 'series', size: 240, required: false },
      { type: 'float', key: 'seriesIndex', required: false, min: 0 },

      { type: 'boolean', key: 'featured', required: false, xdefault: false },
      { type: 'enum', key: 'status', elements: ['draft', 'published'], required: false, xdefault: 'draft' },
      { type: 'boolean', key: 'allowDownload', required: false, xdefault: false },

      { type: 'string', key: 'uploadedBy', size: 64, required: false },
      { type: 'integer', key: 'readCount', required: false, min: 0, xdefault: 0 },
    ],
    indexes: [
      { key: 'slug_unique', type: TablesDBIndexType.Unique, columns: ['slug'] },
      // Every public query filters on status first.
      { key: 'status', type: TablesDBIndexType.Key, columns: ['status'] },
      // Powers Query.search on the title.
      { key: 'title_search', type: TablesDBIndexType.Fulltext, columns: ['title'] },
      { key: 'title_sort', type: TablesDBIndexType.Key, columns: ['title'] },
      // `authors` and `tags` are deliberately not indexed: Appwrite cannot index
      // an array column. They are still queryable with Query.contains, which is
      // what the author and subject filters use — unindexed, but a library-sized
      // collection is far too small for that to matter.
      { key: 'language', type: TablesDBIndexType.Key, columns: ['language'] },
      { key: 'format', type: TablesDBIndexType.Key, columns: ['format'] },
      { key: 'featured', type: TablesDBIndexType.Key, columns: ['featured'] },
      { key: 'publishedYear', type: TablesDBIndexType.Key, columns: ['publishedYear'] },
      { key: 'readCount', type: TablesDBIndexType.Key, columns: ['readCount'] },
      { key: 'series', type: TablesDBIndexType.Key, columns: ['series'] },
    ],
  },

  /* Reader-owned tables.
   *
   * rowSecurity: true is the important line. Each row is created with
   * owner-only permissions, and with row security on, Appwrite enforces them —
   * so a reader physically cannot read or write anyone else's progress,
   * bookmarks or highlights, regardless of what the app code does.
   *
   * Table-level create is granted to signed-in users so they can make their own
   * rows; read/update/delete are decided per row.
   */
  {
    id: 'progress',
    name: 'Reading progress',
    permissions: [Permission.create(Role.users())],
    rowSecurity: true,
    columns: [
      { type: 'string', key: 'userId', size: 64, required: true },
      { type: 'string', key: 'bookId', size: 64, required: true },
      // A page number for PDF, an EPUB CFI for EPUB. CFIs get long.
      { type: 'string', key: 'position', size: 2048, required: true },
      { type: 'enum', key: 'format', elements: ['pdf', 'epub'], required: false },
      { type: 'integer', key: 'page', required: false, min: 0 },
      { type: 'integer', key: 'totalPages', required: false, min: 0 },
      { type: 'float', key: 'percent', required: false, min: 0, max: 100, xdefault: 0 },
      { type: 'integer', key: 'secondsRead', required: false, min: 0, xdefault: 0 },
      { type: 'boolean', key: 'finished', required: false, xdefault: false },
      { type: 'string', key: 'lastDevice', size: 120, required: false },
    ],
    indexes: [
      { key: 'user_book', type: TablesDBIndexType.Key, columns: ['userId', 'bookId'] },
      { key: 'user_finished', type: TablesDBIndexType.Key, columns: ['userId', 'finished'] },
      { key: 'percent', type: TablesDBIndexType.Key, columns: ['percent'] },
    ],
  },

  {
    id: 'bookmarks',
    name: 'Bookmarks',
    permissions: [Permission.create(Role.users())],
    rowSecurity: true,
    columns: [
      { type: 'string', key: 'userId', size: 64, required: true },
      { type: 'string', key: 'bookId', size: 64, required: true },
      { type: 'string', key: 'position', size: 2048, required: true },
      { type: 'integer', key: 'page', required: false, min: 0 },
      { type: 'float', key: 'percent', required: false, min: 0, max: 100, xdefault: 0 },
      { type: 'string', key: 'label', size: 400, required: false },
      { type: 'text', key: 'note', required: false },
    ],
    indexes: [
      { key: 'user_book', type: TablesDBIndexType.Key, columns: ['userId', 'bookId'] },
      { key: 'percent', type: TablesDBIndexType.Key, columns: ['percent'] },
    ],
  },

  {
    id: 'favorites',
    name: 'Favourites',
    permissions: [Permission.create(Role.users())],
    rowSecurity: true,
    columns: [
      { type: 'string', key: 'userId', size: 64, required: true },
      { type: 'string', key: 'bookId', size: 64, required: true },
    ],
    indexes: [{ key: 'user_book', type: TablesDBIndexType.Key, columns: ['userId', 'bookId'] }],
  },

  {
    id: 'highlights',
    name: 'Highlights',
    permissions: [Permission.create(Role.users())],
    rowSecurity: true,
    columns: [
      { type: 'string', key: 'userId', size: 64, required: true },
      { type: 'string', key: 'bookId', size: 64, required: true },
      // A CFI range, or JSON rects for a PDF selection.
      { type: 'string', key: 'position', size: 4096, required: true },
      { type: 'integer', key: 'page', required: false, min: 0 },
      { type: 'float', key: 'percent', required: false, min: 0, max: 100, xdefault: 0 },
      { type: 'text', key: 'text', required: true },
      { type: 'text', key: 'note', required: false },
      {
        type: 'enum',
        key: 'color',
        elements: ['marker', 'ribbon', 'ink'],
        required: false,
        xdefault: 'marker',
      },
    ],
    indexes: [
      { key: 'user_book', type: TablesDBIndexType.Key, columns: ['userId', 'bookId'] },
      { key: 'percent', type: TablesDBIndexType.Key, columns: ['percent'] },
    ],
  },

  {
    id: 'reading_days',
    name: 'Reading days',
    permissions: [Permission.create(Role.users())],
    rowSecurity: true,
    columns: [
      { type: 'string', key: 'userId', size: 64, required: true },
      // YYYY-MM-DD in the reader's own timezone.
      { type: 'string', key: 'day', size: 10, required: true },
      { type: 'integer', key: 'seconds', required: false, min: 0, xdefault: 0 },
      { type: 'integer', key: 'pages', required: false, min: 0, xdefault: 0 },
    ],
    indexes: [{ key: 'user_day', type: TablesDBIndexType.Key, columns: ['userId', 'day'] }],
  },
];

/* ── Column creation ────────────────────────────────────────────────── */

async function createColumn(tableId, column) {
  const base = { databaseId: activeDbId, tableId, key: column.key, required: Boolean(column.required) };

  // A required column cannot also carry a default — Appwrite rejects the pair.
  const withDefault = (extra) =>
    column.required || column.xdefault === undefined
      ? extra
      : { ...extra, xdefault: column.xdefault };

  switch (column.type) {
    case 'string':
      return tablesDb.createStringColumn(
        withDefault({ ...base, size: column.size ?? 255, array: Boolean(column.array) }),
      );
    case 'text':
      return tablesDb.createTextColumn(withDefault({ ...base, array: Boolean(column.array) }));
    case 'integer':
      return tablesDb.createIntegerColumn(
        withDefault({ ...base, min: column.min, max: column.max, array: Boolean(column.array) }),
      );
    case 'float':
      return tablesDb.createFloatColumn(
        withDefault({ ...base, min: column.min, max: column.max, array: Boolean(column.array) }),
      );
    case 'boolean':
      return tablesDb.createBooleanColumn(withDefault({ ...base, array: Boolean(column.array) }));
    case 'datetime':
      return tablesDb.createDatetimeColumn(withDefault({ ...base, array: Boolean(column.array) }));
    case 'enum':
      return tablesDb.createEnumColumn(
        withDefault({ ...base, elements: column.elements, array: Boolean(column.array) }),
      );
    default:
      throw new Error(`Unknown column type: ${column.type}`);
  }
}

/**
 * An index cannot be built until every column it covers is `available`.
 * Appwrite creates columns asynchronously, so this waits rather than guessing.
 */
async function waitForColumns(tableId, keys, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const { columns } = await tablesDb.listColumns({ databaseId: activeDbId, tableId });
      const byKey = new Map(columns.map((column) => [column.key, column.status]));
      const pending = keys.filter((key) => byKey.get(key) !== 'available');
      if (!pending.length) return true;
    } catch {
      // Transient; try again below.
    }
    await breathe(700);
  }

  return false;
}

/**
 * Gets us a database to build in.
 *
 * Appwrite Cloud's free plan allows exactly one database per project, so
 * insisting on creating one named `parva` fails outright on any project that
 * already has one — and there is nothing the reader can do about it short of
 * upgrading. Adopting the existing database is the right answer instead: Parva's
 * tables are namespaced by their own ids and sit happily alongside anything else.
 *
 * Returns the database id actually in use.
 */
async function ensureDatabase() {
  try {
    await tablesDb.create({ databaseId: DB_ID, name: 'Parva' });
    ok(`Database "${DB_ID}"`);
    await breathe();
    return DB_ID;
  } catch (error) {
    if (isDuplicate(error)) {
      skip(`Database "${DB_ID}" — already there`);
      return DB_ID;
    }
    if (!isPlanLimit(error)) throw error;

    // Out of database quota. Fall back to one that already exists.
    warn('This plan allows no more databases, so an existing one will be used.');

    const { databases } = await tablesDb.list({ queries: [] });
    const adopted = databases.find((db) => db.$id === DB_ID) ?? databases[0];

    if (!adopted) {
      throw new Error(
        'No database exists and the plan will not allow another. Create one in the Appwrite console, then re-run this script.',
      );
    }

    ok(`Using existing database "${adopted.$id}" (${adopted.name})`);

    if (adopted.$id !== DB_ID) {
      warn(`Set APPWRITE_DATABASE_ID=${adopted.$id} in .env, or the app will look for "${DB_ID}".`);
    }

    return adopted.$id;
  }
}

/**
 * Creates the books bucket at the largest size this instance will take.
 *
 * Returns the effective limit in bytes, or null if the bucket already existed —
 * in which case its own setting stands and we read it back rather than guessing.
 */
async function createBooksBucket() {
  const wantedExtensions = COVERS_SEPARATE
    ? BOOK_EXTENSIONS
    : [...BOOK_EXTENSIONS, ...IMAGE_EXTENSIONS];

  /* ── Already there? ──────────────────────────────────────────────
     Looked up rather than probed with a create.

     Appwrite checks the plan's bucket quota *before* it checks whether the
     bucket already exists, so on a project that is out of quota `createBucket`
     answers "maximum number of buckets... upgrade to increase the limit" even
     for a bucket that is sitting right there. That is indistinguishable from a
     rejected file size unless you look first. */
  try {
    const existing = await storage.getBucket({ bucketId: BOOKS_BUCKET });
    const existingMib = (existing.maximumFileSize / (1024 * 1024)).toFixed(1);
    skip(
      `Bucket "${BOOKS_BUCKET}" — already there, files up to ${existingMib} MiB (${existing.maximumFileSize} bytes)`,
    );

    /* Raise the ceiling if this run asks for more than the bucket allows.
       Without this, the size is fixed forever at whatever the very first run
       happened to get: bumping NEXT_PUBLIC_MAX_BOOK_MB and re-running would
       print "already there" and change nothing, which is a confusing way to
       discover that an existing install cannot grow. Only ever upward — a
       lower request is treated as "leave it alone" rather than as an
       instruction to shrink a bucket that already holds larger books. */
    let effectiveSize = existing.maximumFileSize;

    // Driven by an explicit NEXT_PUBLIC_MAX_BOOK_MB, not by the whole ladder.
    // Probing every rung above the current size would mean four rejected calls
    // on every run of a bucket that is already at its instance's ceiling, to
    // discover nothing. An explicit request is the only reason to try.
    const requestedBytes = REQUESTED_BOOK_MB > 0 ? REQUESTED_BOOK_MB * MIB : 0;
    const wanted =
      requestedBytes > existing.maximumFileSize
        ? BOOK_SIZE_LADDER_BYTES.filter(
            (bytes) => bytes > existing.maximumFileSize && bytes <= requestedBytes,
          )
        : [];

    for (const bytes of wanted) {
      try {
        await storage.updateBucket({
          bucketId: BOOKS_BUCKET,
          name: existing.name,
          maximumFileSize: bytes,
          allowedFileExtensions: existing.allowedFileExtensions,
        });
        effectiveSize = bytes;
        ok(`Raised "${BOOKS_BUCKET}" to ${(bytes / (1024 * 1024)).toFixed(1)} MiB (${bytes} bytes)`);
        break;
      } catch (error) {
        if (error?.code !== 400) throw error;
        await breathe();
      }
    }

    // Reconcile it. A bucket made by an earlier version accepted only
    // pdf/epub, which would silently reject every cover.
    const allowed = existing.allowedFileExtensions ?? [];
    const missing = wantedExtensions.filter((ext) => !allowed.includes(ext));

    if (missing.length || !existing.transformations) {
      await storage.updateBucket({
        bucketId: BOOKS_BUCKET,
        name: existing.name,
        permissions: existing.$permissions,
        fileSecurity: existing.fileSecurity,
        enabled: existing.enabled,
        maximumFileSize: effectiveSize,
        allowedFileExtensions: [...new Set([...allowed, ...wantedExtensions])],
        compression: existing.compression,
        encryption: existing.encryption,
        antivirus: existing.antivirus,
        transformations: true,
      });
      ok(`Updated "${BOOKS_BUCKET}" — now accepts ${missing.join(", ") || "transforms"}`);
    }

    return effectiveSize;
  } catch (error) {
    if (!isMissing(error)) throw error;
    // Genuinely absent. Create it below.
  }

  /* ── Create, finding the largest size the instance accepts ────── */
  const settings = {
    bucketId: BOOKS_BUCKET,
    name: 'Parva books',
    // No public read. Book files are only ever reachable through a short-lived
    // file token minted by the server; `create` is granted to the admin label
    // so the browser can upload straight to Appwrite with an admin JWT.
    permissions: [Permission.create(Role.label(ADMIN_LABEL))],
    fileSecurity: false,
    enabled: true,
    allowedFileExtensions: wantedExtensions,
    // PDFs and EPUBs are already compressed containers; re-compressing costs
    // CPU on every read for no gain.
    compression: Compression.None,
    encryption: false,
    antivirus: true,
    // Lets Appwrite resize and re-encode covers stored here.
    transformations: true,
  };

  for (const bytes of BOOK_SIZE_LADDER_BYTES) {
    const mb = (bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1);
    try {
      await storage.createBucket({ ...settings, maximumFileSize: bytes });
      ok(`Bucket "${BOOKS_BUCKET}" (private) — files up to ${mb} MiB (${bytes} bytes)`);
      return bytes;
    } catch (error) {
      // Order matters: a quota error also mentions "limit", so it has to be
      // ruled out before treating this as an oversized request.
      if (isPlanLimit(error)) {
        throw new Error(
          `This plan allows no more storage buckets, so "${BOOKS_BUCKET}" cannot be created. Delete an unused bucket in the Appwrite console, or upgrade the plan, then re-run this script.`,
        );
      }
      if (error?.code !== 400) throw error;

      warn(`${mb} MiB is above this instance's file-size limit — trying smaller`);
      await breathe();
    }
  }

  throw new Error(
    'Appwrite rejected every file size down to 10 MiB. Check _APP_STORAGE_LIMIT, or that storage is enabled for this project.',
  );
}

/* ── Main ───────────────────────────────────────────────────────────── */

async function main() {
  console.log(`
  Parva — Appwrite setup
  ──────────────────────
  Endpoint  ${ENDPOINT}
  Project   ${PROJECT_ID}
  Database  ${DB_ID}
`);

  /* Database */
  step('Database');
  activeDbId = await ensureDatabase();

  /* Buckets */
  step('Storage');

  const bookBucketSize = await createBooksBucket();

  if (!COVERS_SEPARATE) {
    ok(`Covers share "${BOOKS_BUCKET}" — one bucket holds both`);
  } else {
    try {
      await storage.createBucket({
        bucketId: COVERS_BUCKET,
        name: 'Parva covers',
        permissions: [Permission.create(Role.label(ADMIN_LABEL))],
        fileSecurity: false,
        enabled: true,
        maximumFileSize: MAX_COVER_BYTES,
        allowedFileExtensions: IMAGE_EXTENSIONS,
        compression: Compression.None,
        encryption: false,
        antivirus: true,
        // Lets Appwrite resize and re-encode covers on request.
        transformations: true,
      });
      ok(`Bucket "${COVERS_BUCKET}" (private, covers)`);
    } catch (error) {
      if (isDuplicate(error)) {
        skip(`Bucket "${COVERS_BUCKET}" — already there`);
      } else if (isPlanLimit(error)) {
        // Out of buckets. The books bucket already accepts images, so this is
        // a note rather than a failure — but .env has to agree.
        warn('This plan allows no more buckets, so covers must share the books bucket.');
        warn(`Remove APPWRITE_COVERS_BUCKET_ID from .env (or set it to ${BOOKS_BUCKET}).`);
      } else {
        throw error;
      }
    }
  }
  /* Tables, columns, indexes */
  for (const table of TABLES) {
    step(`Table "${table.id}"`);

    await ensure(`Table ${table.id}`, () =>
      tablesDb.createTable({
        databaseId: activeDbId,
        tableId: table.id,
        name: table.name,
        permissions: table.permissions,
        rowSecurity: table.rowSecurity,
        enabled: true,
      }),
    );

    for (const column of table.columns) {
      await ensure(`${table.id}.${column.key} (${column.type})`, () =>
        createColumn(table.id, column),
      );
    }

    if (table.indexes?.length) {
      const needed = [...new Set(table.indexes.flatMap((index) => index.columns))];
      const ready = await waitForColumns(table.id, needed);

      if (!ready) {
        warn(
          `Columns on ${table.id} were still building, so its indexes were skipped. Re-run this script in a minute.`,
        );
        continue;
      }

      for (const index of table.indexes) {
        await ensure(`index ${table.id}.${index.key}`, () =>
          tablesDb.createIndex({
            databaseId: activeDbId,
            tableId: table.id,
            key: index.key,
            type: index.type,
            columns: index.columns,
          }),
        );
      }
    }
  }


  const sizeNote = bookBucketSize
    ? `${Math.round(bookBucketSize / (1024 * 1024))} MB per book`
    : 'the existing bucket setting';

  console.log(`
  Done. Books can be up to ${sizeNote}.

  If that is smaller than you want, the ceiling is your Appwrite instance, not
  this app. Upgrade the plan, or raise _APP_STORAGE_LIMIT if self-hosted, then
  delete the bucket and re-run this script — an existing bucket keeps whatever
  size it was created with.

  Next:
    1. Console → Auth → Settings → enable Google, and paste in your
       Google OAuth client ID and secret.
    2. Console → Auth → Settings → Platforms → add a Web platform for
       your domain (and localhost for development).
    3. Sign in once, then Console -> Auth -> Users -> your user ->
       Labels -> add "admin".
    4. npm run dev

  Full walkthrough in SETUP.md.
`);
}

main().catch((error) => {
  console.error('\n  Setup failed.\n');
  if (isMissing(error)) {
    console.error('  Appwrite returned 404 — check that the project ID and endpoint are right.');
  } else if (error?.code === 401) {
    console.error('  Appwrite rejected the API key. Check APPWRITE_API_KEY and its scopes.');
    console.error('  Needed: databases.*, tables.*, columns.*, indexes.*, buckets.*, files.*, users.*');
  } else {
    console.error(`  ${error?.message ?? error}`);
  }
  console.error('');
  // Set the code rather than calling process.exit(): the SDK's HTTP agent still
  // has sockets open, and tearing the loop down under it makes libuv assert on
  // Windows, burying the error message we just printed.
  process.exitCode = 1;
});
