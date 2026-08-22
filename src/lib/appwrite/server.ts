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
 */
function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof TypeError) || error.message !== 'fetch failed') return false;
  const code = (error.cause as { code?: string } | undefined)?.code;
  return code === 'EAI_AGAIN' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED';
}

/**
 * Retries a read after a short pause, and only for the transient network
 * failure above. Reserved for reads — an Appwrite write is not always safe to
 * repeat blind (an increment, for instance, would double-count if the first
 * attempt actually reached the server and only its response was lost).
 *
 * Three attempts, not two: a single retry recovers most of the time — the DNS
 * hiccup usually clears within milliseconds — but it is not the only shape
 * this takes in practice. The library page fires three of these calls at once
 * (browseBooks, getFacets, getContinueReading), and when the DNS cache is
 * genuinely cold all three can race the same flaky lookup together, so one
 * retry each does not always land in a clear window. The backoff grows
 * between attempts rather than staying flat, on the chance that whatever is
 * congested needs a moment rather than an instant to clear.
 */
export async function withRetry<T>(read: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (!isTransientNetworkError(error) || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
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
