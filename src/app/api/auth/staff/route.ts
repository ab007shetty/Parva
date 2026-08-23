import { NextResponse } from 'next/server';

import { LIMITS as RATE, rateLimitGuard } from '@/lib/rate-limit';

import { createAdminClient } from '@/lib/appwrite/server';
import { setSessionCookie, toSessionUser, upsertUserProfile } from '@/lib/auth/session';

/**
 * Email + password sign-in, for administrators only.
 *
 * There is no sign-up route anywhere in this app: reader accounts are created
 * implicitly by Google, and admin rights come from an `admin` label set on the
 * Appwrite account in the console — server-side only, so nobody can grant it to
 * themselves. That is the whole account model.
 */
export async function POST(request: Request) {
  const limited = rateLimitGuard('staff-signin', request, RATE.staffSignIn);
  if (limited) return limited;

  let email: string;
  let password: string;

  try {
    const body = await request.json();
    email = String(body.email ?? '').trim();
    password = String(body.password ?? '');
  } catch {
    return NextResponse.json({ error: 'Send an email and password.' }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json({ error: 'Enter both an email and a password.' }, { status: 400 });
  }

  try {
    const { account, users } = createAdminClient();
    const session = await account.createEmailPasswordSession({ email, password });

    const user = await users.get({ userId: session.userId });
    const sessionUser = toSessionUser(user);

    await setSessionCookie(session.secret, session.expire);
    await upsertUserProfile(sessionUser);

    return NextResponse.json({
      ok: true,
      isAdmin: sessionUser.isAdmin,
      // Send admins to the desk they came for; anyone else to the shelf.
      next: sessionUser.isAdmin ? '/admin' : '/',
    });
  } catch (error) {
    const code = (error as { code?: number } | null)?.code;
    if (code === 401) {
      // Deliberately does not distinguish "no such account" from "wrong
      // password" — that difference is an account-enumeration oracle.
      return NextResponse.json({ error: 'That email and password do not match.' }, { status: 401 });
    }
    if (code === 429) {
      return NextResponse.json(
        { error: 'Too many attempts. Wait a minute and try again.' },
        { status: 429 },
      );
    }
    console.error('[parva] staff sign-in failed', error);
    return NextResponse.json({ error: 'Sign-in is unavailable right now.' }, { status: 500 });
  }
}
