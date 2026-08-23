import { NextResponse } from 'next/server';

import { SITE_URL } from '@/lib/config';
import { createAdminClient } from '@/lib/appwrite/server';
import { fetchGoogleAvatarUrl } from '@/lib/auth/google-profile';
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

    const user = await users.get({ userId });
    const profile = toSessionUser(user);

    /*
     * Appwrite passes on the name and email but not the picture, so this is the
     * one place it can be had: the session carries Google's own access token,
     * good for a single userinfo call. Done here rather than on a page render —
     * an avatar is worth one request at sign-in, not one per view.
     *
     * Stored in the account's prefs so it survives as part of the account
     * rather than only in the mirror row, which is also where toSessionUser()
     * already looks for it. Existing prefs are spread back in: updatePrefs
     * replaces the whole object, so writing only avatarUrl would silently drop
     * any other preference the account holds.
     */
    const avatarUrl = await fetchGoogleAvatarUrl(session.providerAccessToken);

    if (avatarUrl && avatarUrl !== profile.avatarUrl) {
      try {
        await users.updatePrefs({ userId, prefs: { ...(user.prefs ?? {}), avatarUrl } });
        profile.avatarUrl = avatarUrl;
      } catch (error) {
        // A missing picture is cosmetic; it must not cost anyone their sign-in.
        console.error('[parva] could not store the Google avatar', error);
      }
    }

    // Mirror the profile so the admin can see who signed in and when.
    await upsertUserProfile(profile);

    return NextResponse.redirect(new URL(next, SITE_URL));
  } catch (error) {
    console.error('[parva] Google sign-in callback failed', error);
    const url = new URL('/sign-in', SITE_URL);
    url.searchParams.set('error', 'exchange');
    return NextResponse.redirect(url);
  }
}
