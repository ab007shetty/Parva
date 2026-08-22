import { NextResponse } from 'next/server';

import { SITE_URL } from '@/lib/config';
import { createAdminClient } from '@/lib/appwrite/server';
import { setSessionCookie, toSessionUser, upsertUserProfile } from '@/lib/auth/session';

/**
 * Step 2 of Google sign-in.
 *
 * Appwrite redirects here with `userId` and `secret`. We trade them for a real
 * session and store its secret in an httpOnly cookie. From this point every
 * server request can act as this reader, and the browser never sees the secret.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const userId = params.get('userId');
  const secret = params.get('secret');
  const requested = params.get('next');
  const next = requested && requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  if (!userId || !secret) {
    const url = new URL('/sign-in', SITE_URL);
    url.searchParams.set('error', 'incomplete');
    return NextResponse.redirect(url);
  }

  try {
    const { account, users } = createAdminClient();
    const session = await account.createSession({ userId, secret });

    await setSessionCookie(session.secret, session.expire);

    // Mirror the profile so the admin can see who signed in and when. Avatars
    // are rendered as initials in the UI rather than fetched from Google, which
    // keeps sign-in to a single round-trip and avoids a third-party image
    // request on every page.
    const user = await users.get({ userId });
    await upsertUserProfile(toSessionUser(user));

    return NextResponse.redirect(new URL(next, SITE_URL));
  } catch (error) {
    console.error('[parva] Google sign-in callback failed', error);
    const url = new URL('/sign-in', SITE_URL);
    url.searchParams.set('error', 'exchange');
    return NextResponse.redirect(url);
  }
}
