import { NextResponse } from 'next/server';

import { LIMITS as RATE, rateLimitGuard } from '@/lib/rate-limit';
import { OAuthProvider } from 'node-appwrite';

import { SITE_URL } from '@/lib/config';
import { createAdminClient } from '@/lib/appwrite/server';

/**
 * Step 1 of Google sign-in.
 *
 * We use createOAuth2Token rather than createOAuth2Session because this app
 * keeps its session in an httpOnly cookie. The token flow returns `userId` and
 * `secret` to our callback, which the server exchanges for a session it can
 * store server-side — the session secret never touches client JavaScript.
 */
export async function GET(request: Request) {
  const limited = rateLimitGuard('oauth-start', request, RATE.oauthStart);
  if (limited) return limited;

  const requested = new URL(request.url).searchParams.get('next');

  // Only ever redirect back inside this app. An absolute URL here would be an
  // open redirect wearing a "next" parameter.
  const next = requested && requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  try {
    const { account } = createAdminClient();

    const success = new URL('/api/auth/callback', SITE_URL);
    success.searchParams.set('next', next);

    const failure = new URL('/sign-in', SITE_URL);
    failure.searchParams.set('error', 'google');

    const redirectUrl = await account.createOAuth2Token({
      provider: OAuthProvider.Google,
      success: success.toString(),
      failure: failure.toString(),
    });

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    /*
     * Two very different failures used to land here as one "config" code, and
     * the message it showed — "enable Google in Appwrite" — sent people to a
     * screen that was already correct.
     *
     * Appwrite answers 400 "Invalid redirect" when the success/failure URLs are
     * not on a hostname registered under Overview -> Platforms. That is a
     * platform registration problem, and it is the one that happens on every
     * first deploy to a new domain, because the URLs suddenly change from
     * localhost to something Appwrite has never been told about. Anything else
     * really is the provider being off or missing its credentials.
     */
    const message = String((error as { message?: string } | null)?.message ?? '');
    const code = /invalid redirect/i.test(message) ? 'origin' : 'config';

    console.error(
      `[parva] could not start Google sign-in (${code}) — success URL was ${SITE_URL}`,
      error,
    );

    const url = new URL('/sign-in', SITE_URL);
    url.searchParams.set('error', code);
    return NextResponse.redirect(url);
  }
}
