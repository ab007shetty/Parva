import 'server-only';

import { cookies } from 'next/headers';
import { Account, Client, Storage, TablesDB, Users } from 'node-appwrite';

import { SESSION_COOKIE } from '@/lib/config';

/**
 * Two server clients, and the difference matters:
 *
 *   createSessionClient() acts AS the signed-in reader. Row permissions apply,
 *   so a user can only ever touch their own bookmarks and progress. Use it for
 *   anything a reader does to their own data.
 *
 *   createAdminClient() uses the API key and bypasses row permissions. Use it
 *   only for reading the published catalogue (which has no per-user rows) and
 *   for admin writes, after checking the admin label yourself.
 *
 * Getting these backwards is the one mistake that turns a private bookmark
 * into a public one, so every call site names which it wants.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env — see SETUP.md.`);
  }
  return value;
}

function baseClient() {
  return new Client()
    .setEndpoint(requireEnv('NEXT_PUBLIC_APPWRITE_ENDPOINT'))
    .setProject(requireEnv('NEXT_PUBLIC_APPWRITE_PROJECT_ID'));
}

export type ServerServices = {
  client: Client;
  tables: TablesDB;
  storage: Storage;
  account: Account;
};

/** Elevated. Bypasses row permissions — never hand user input to it unchecked. */
export function createAdminClient(): ServerServices & { users: Users } {
  const client = baseClient().setKey(requireEnv('APPWRITE_API_KEY'));
  return {
    client,
    tables: new TablesDB(client),
    storage: new Storage(client),
    account: new Account(client),
    users: new Users(client),
  };
}

/**
 * Scoped to the current reader's session. Returns null when nobody is signed
 * in, which is the normal case here — reading never requires an account.
 */
export async function createSessionClient(): Promise<ServerServices | null> {
  const jar = await cookies();
  const secret = jar.get(SESSION_COOKIE)?.value;
  if (!secret) return null;

  const client = baseClient().setSession(secret);
  return {
    client,
    tables: new TablesDB(client),
    storage: new Storage(client),
    account: new Account(client),
  };
}

/**
 * Same as createSessionClient but throws instead of returning null. For route
 * handlers that have already established the caller must be signed in.
 */
export async function requireSessionClient(): Promise<ServerServices> {
  const services = await createSessionClient();
  if (!services) throw new UnauthorizedError();
  return services;
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = 'Sign in to do that.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = 'That action is restricted.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/** Appwrite errors carry a numeric `code`; narrow without leaking `any`. */
export function appwriteStatus(error: unknown): number | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'number') return code;
  }
  return null;
}

export function isNotFound(error: unknown): boolean {
  return appwriteStatus(error) === 404;
}

/** Appwrite raises 409 on a unique-index collision. */
export function isConflict(error: unknown): boolean {
  return appwriteStatus(error) === 409;
}

/**
 * True for a transient network failure — not an Appwrite error.
 *
 * Node's `fetch` throws a bare `TypeError: fetch failed` for a failure below
 * the HTTP layer, with the actual reason on `.cause`. On this project that
 * has been observed as `EAI_AGAIN` — the OS DNS lookup itself timing out,
 * reproduced directly against Appwrite's endpoint with Node's own `fetch`
 * while a `curl` run moments apart succeeded, and gone again on the very next
 * attempt. That is a cold-cache DNS hiccup upstream of this app, not a bug in
 * the query being made, and the correct response to it is a short retry — a
 * real Appwrite error (a bad query, an expired key, a 404) comes back as an
 * `AppwriteException` with a status code and must never be retried here.
 *
 * ENOTFOUND is on the list despite normally meaning "this host does not
 * exist", which would be pointless to retry. It earned its place: the same
 * flaky resolver has returned it for Appwrite's endpoint — a host that
 * plainly does exist — and then resolved that host correctly seconds later in
 * the same shell. A misconfigured endpoint is a permanent ENOTFOUND that
 * costs two extra attempts before surfacing, which is a far better trade than
 * a working endpoint failing a request outright.
 */
function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof TypeError) || error.message !== 'fetch failed') return false;
  const code = (error.cause as { code?: string } | undefined)?.code;
  return (
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED'
  );
}

/** Host of the Appwrite endpoint, for the DNS nudge below. */
const ENDPOINT_HOST = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ?? '').hostname || null;
  } catch {
    return null;
  }
})();

/**
 * Asks the OS resolver for the endpoint host, ignoring the answer.
 *
 * Measured on the machine this was written against: `dns.resolve4`, which
 * queries the configured nameserver directly, returns ECONNREFUSED, while
 * `dns.lookup`, which goes through the OS resolver and its cache, answers —
 * and a moment later the reverse can be true. The system resolver there is
 * `127.0.0.1`, a local DNS proxy, and it drops requests intermittently.
 *
 * Calling lookup() between attempts pokes the path that has a cache, so the
 * retry that follows has something to hit rather than repeating the same cold
 * miss. It made the difference between failing four times in a row and
 * succeeding when this was first measured against a real endpoint.
 *
 * Deliberately best-effort: errors are swallowed and the import is dynamic, so
 * this costs nothing on the normal path and cannot itself become the failure.
 */
async function nudgeDns(): Promise<void> {
  if (!ENDPOINT_HOST) return;
  try {
    const { lookup } = await import('node:dns');
    await new Promise<void>((done) => lookup(ENDPOINT_HOST, { all: true }, () => done()));
  } catch {
    // Nothing to do — this is a hint, not a step.
  }
}

/**
 * Retries a read, and only for the transient network failure above. Reserved
 * for reads — an Appwrite write is not always safe to repeat blind (an
 * increment, for instance, would double-count if the first attempt actually
 * reached the server and only its response was lost).
 *
 * Four attempts with a growing backoff and a DNS nudge between each, which is
 * more patience than a page render would normally deserve. It is here because
 * the alternative was measured: with a flaky local DNS proxy in front of the
 * machine, three quick attempts inside a second kept surfacing `fetch failed`
 * on the home page several times an hour. Roughly 1.8s of worst-case waiting
 * buys a page that renders instead of an error boundary that has to be
 * dismissed, and a request that is going to fail anyway loses nothing by
 * taking a little longer to say so.
 *
 * This is a mitigation, not a fix. The fix is a resolver that answers — see the
 * DNS note in SETUP.md's troubleshooting section.
 */
export async function withRetry<T>(read: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (!isTransientNetworkError(error) || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      await nudgeDns();
    }
  }
}

/**
 * Strips an Appwrite row down to a genuinely plain object.
 *
 * node-appwrite parses every response with `json-bigint`, whose parser builds
 * result objects via `Object.create(null)` rather than `{}` — a defence
 * against prototype pollution in the SDK. That makes every row it returns a
 * null-prototype object, and React 19's Server → Client boundary refuses to
 * serialise those: "Only plain objects... Classes or null prototypes are not
 * supported." Any server component that hands a row straight to a `'use
 * client'` component crashes at request time, not at build time, so it is
 * easy to ship.
 *
 * A JSON round-trip is the fix: `JSON.parse`/`stringify` always rebuild plain
 * `{}` objects and `[]` arrays regardless of the source's prototype. It is
 * lossless for these rows because every field in the schema is already a JSON
 * primitive or an array of them (see scripts/setup-appwrite.mjs) — there are
 * no Dates, Maps or BigInts to lose in the round trip.
 *
 * Call this on anything read from Appwrite before it can reach a Client
 * Component prop — a row, a row array, or an object built from one.
 */
export function toPlainObject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
