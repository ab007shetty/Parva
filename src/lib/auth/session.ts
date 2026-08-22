import 'server-only';

import { cookies } from 'next/headers';
import { cache } from 'react';


import { ADMIN_LABEL, DB_ID, SESSION_COOKIE, TABLES } from '@/lib/config';
import { createAdminClient, createSessionClient, isConflict } from '@/lib/appwrite/server';
import type { SessionUser } from '@/types';

/**
 * Reading the current user hits Appwrite, and a single render can ask several
 * times (layout, header, page, a server action). React's `cache` dedupes it to
 * one call per request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const services = await createSessionClient();
  if (!services) return null;

  try {
    const user = await services.account.get();
    return toSessionUser(user);
  } catch {
    // A 401 here means the cookie outlived its session. Treat it as signed out;
    // the cookie is cleared on the next sign-in or sign-out.
    return null;
  }
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    const { UnauthorizedError } = await import('@/lib/appwrite/server');
    throw new UnauthorizedError();
  }
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) {
    const { ForbiddenError } = await import('@/lib/appwrite/server');
    throw new ForbiddenError('That area is for administrators.');
  }
  return user;
}

/**
 * Only the fields we actually read. Appwrite brands its default preferences
 * type, so naming a concrete `Models.User<T>` here would force every caller to
 * cast; a structural type accepts both the account and users-service shapes.
 */
type AppwriteAccountLike = {
  $id: string;
  $createdAt: string;
  name: string;
  email: string;
  labels?: string[];
  prefs?: Record<string, unknown>;
};

export function toSessionUser(user: AppwriteAccountLike): SessionUser {
  const prefs = user.prefs;
  return {
    id: user.$id,
    name: user.name || user.email?.split('@')[0] || 'Reader',
    email: user.email,
    // Optional. The UI renders initials when this is absent, which is the
    // normal case — we do not fetch Google's picture on every page.
    avatarUrl: typeof prefs?.avatarUrl === 'string' ? prefs.avatarUrl : null,
    isAdmin: Array.isArray(user.labels) && user.labels.includes(ADMIN_LABEL),
    createdAt: user.$createdAt,
  };
}

/* ── Cookie handling ────────────────────────────────────────────────── */

export async function setSessionCookie(secret: string, expiresAt?: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // Appwrite returns an ISO expiry; fall back to a year so the cookie does
    // not outlive the session it points at by much either way.
    expires: expiresAt ? new Date(expiresAt) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/* ── Profile mirror ─────────────────────────────────────────────────── */

/**
 * Appwrite already stores the account. We keep a `users` row alongside it so
 * the admin can see who has signed in and when, without needing the Users API
 * scope on every page — and so the rest of the app can join on a normal table.
 *
 * Called once per sign-in. Never fails the sign-in: a missing mirror row is a
 * reporting gap, not a reason to block someone from reading.
 */
export async function upsertUserProfile(user: SessionUser): Promise<void> {
  try {
    const { tables } = createAdminClient();
    await tables.upsertRow({
      databaseId: DB_ID,
      tableId: TABLES.users,
      // Keyed by the Appwrite user id, so one row per account by construction.
      rowId: user.id,
      data: {
        userId: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        lastSeenAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (isConflict(error)) return;
    console.error('[parva] could not mirror user profile', error);
  }
}
