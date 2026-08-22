import { NextResponse } from 'next/server';

import { SITE_URL } from '@/lib/config';
import { createSessionClient } from '@/lib/appwrite/server';
import { clearSessionCookie } from '@/lib/auth/session';

/**
 * Sign out. POST only — a GET here would let any page log a reader out with an
 * <img> tag.
 */
export async function POST(request: Request) {
  try {
    const services = await createSessionClient();
    // Delete the session at Appwrite too, so the secret is dead even if the
    // cookie survives somewhere.
    await services?.account.deleteSession({ sessionId: 'current' });
  } catch {
    // Already gone. Clearing the cookie below is still the right outcome.
  }

  await clearSessionCookie();

  const requested = new URL(request.url).searchParams.get('next');
  const next = requested && requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  return NextResponse.redirect(new URL(next, SITE_URL), { status: 303 });
}
