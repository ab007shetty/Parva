import 'server-only';

import { NextResponse } from 'next/server';

/**
 * A small fixed-window rate limiter, held in memory.
 *
 * Be clear about what this is and is not. It is per-instance: each serverless
 * instance keeps its own counters, so a client spread across several instances
 * gets a proportionally higher effective limit, and a cold start forgets
 * everything. It is not a defence against a distributed flood — that needs
 * shared state (Redis/Upstash) or the platform's own edge protection, which is
 * a service dependency this project does not otherwise have.
 *
 * What it does buy, and the reason it is worth having anyway: it stops *one*
 * client hammering a route. That covers the cases that actually hurt here — a
 * password-guessing loop against the admin sign-in, and a script pulling book
 * files in a tight loop until the month's Appwrite bandwidth is gone. Both are
 * single-origin by nature, and both are cheap to stop at the door.
 */

type Window = { count: number; resetAt: number };

/** One map per limiter, so a bucket's key space cannot collide with another's. */
const buckets = new Map<string, Map<string, Window>>();

/**
 * Sweeps expired entries.
 *
 * Without this the map grows once per unique IP for the life of the instance,
 * which is a slow memory leak on a public route. Cleaning on write — bounded to
 * the bucket being touched — keeps it O(1) amortised with no timer to leak.
 */
function sweep(windows: Map<string, Window>, now: number) {
  if (windows.size < 512) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export type RateLimit = {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

/**
 * The caller's best-guess identity.
 *
 * `x-forwarded-for` is set by the proxy in front of the app and is the only
 * thing available in a serverless handler. It can be spoofed when the app is
 * reachable directly, which is a reason not to treat this as authentication —
 * but behind Vercel the left-most entry is the real client, and that is what
 * this is keyed on.
 */
function callerKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Counts a hit and reports whether it is over the limit.
 *
 * Returns the headers to attach either way: a client that can see how much
 * budget is left can back off on its own, which is the difference between a
 * well-behaved script and one that keeps knocking.
 */
export function checkRateLimit(
  bucket: string,
  request: Request,
  { limit, windowSeconds }: RateLimit,
): { ok: boolean; headers: Record<string, string> } {
  const now = Date.now();
  const windows = buckets.get(bucket) ?? new Map<string, Window>();
  if (!buckets.has(bucket)) buckets.set(bucket, windows);

  sweep(windows, now);

  const key = callerKey(request);
  const existing = windows.get(key);
  const window =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + windowSeconds * 1000 };

  window.count += 1;
  windows.set(key, window);

  const remaining = Math.max(0, limit - window.count);
  const resetSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));

  return {
    ok: window.count <= limit,
    headers: {
      'RateLimit-Limit': String(limit),
      'RateLimit-Remaining': String(remaining),
      'RateLimit-Reset': String(resetSeconds),
      ...(window.count > limit ? { 'Retry-After': String(resetSeconds) } : {}),
    },
  };
}

/**
 * Guards a route. Returns a 429 to return early, or null to carry on.
 *
 * Written as a guard rather than a wrapper so a handler keeps its own shape and
 * the limit is visible on the first line of the function that has it.
 */
export function rateLimitGuard(
  bucket: string,
  request: Request,
  options: RateLimit,
): NextResponse | null {
  const { ok, headers } = checkRateLimit(bucket, request, options);
  if (ok) return null;

  return NextResponse.json(
    { error: 'Too many requests. Wait a moment and try again.' },
    { status: 429, headers },
  );
}

/**
 * The limits themselves, in one place so they can be read against each other
 * rather than hunted for across twenty route files.
 */
export const LIMITS = {
  /** Password guessing. Deliberately the tightest thing here. */
  staffSignIn: { limit: 8, windowSeconds: 300 },
  /** Starting an OAuth round trip. Generous — a person may retry legitimately. */
  oauthStart: { limit: 20, windowSeconds: 300 },
  /** Whole book files. The Appwrite free plan allows 5 GB of egress a month,
   *  which a loop over a 30 MB scan exhausts in about 170 requests. */
  bookFile: { limit: 40, windowSeconds: 600 },
  /** Cover images: many per page view on the shelf, so this has to be roomy. */
  cover: { limit: 300, windowSeconds: 60 },
  /** Reader writes — progress, bookmarks, highlights, favourites. Progress
   *  saves at most every 2.5s while reading, so this is well clear of normal
   *  use while still bounding a runaway client. */
  readerWrite: { limit: 120, windowSeconds: 60 },
  /** The whole search index in one response. */
  searchIndex: { limit: 30, windowSeconds: 60 },
} as const;
