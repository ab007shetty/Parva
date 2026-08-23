import 'server-only';

/**
 * The one thing Google knows about a reader that Appwrite does not pass on.
 *
 * Appwrite's OAuth flow gives us the account's name and email, but not the
 * profile picture — so `prefs.avatarUrl` stayed empty and the `users` mirror
 * wrote null into its `avatarUrl` column on every sign-in. The picture is in
 * Google's own userinfo response, reachable with the provider access token
 * Appwrite hands back on the session.
 *
 * Called once per sign-in and never on a page render: an avatar is worth one
 * request at the door, not one per view.
 */

/** Google's OpenID userinfo endpoint. `picture` comes with the `profile` scope,
 *  which Appwrite's Google provider requests by default. */
const USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';

/**
 * Fetches the avatar URL for a provider access token, or null.
 *
 * Never throws. Sign-in must not fail because Google was slow or the token did
 * not carry the `profile` scope — a reader with no picture is a cosmetic
 * shortfall, and blocking their sign-in over it would be absurd. The timeout is
 * the point of that promise: without one, a hanging Google request would hold
 * the callback open and the reader would sit on a blank redirect.
 */
export async function fetchGoogleAvatarUrl(providerAccessToken: string | undefined | null) {
  if (!providerAccessToken) return null;

  try {
    const response = await fetch(USERINFO, {
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      // Do not let a Google hiccup become a slow sign-in.
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });

    if (!response.ok) return null;

    const profile: unknown = await response.json();
    const picture =
      profile && typeof profile === 'object' && 'picture' in profile
        ? (profile as { picture?: unknown }).picture
        : null;

    if (typeof picture !== 'string' || !picture) return null;

    // Only ever store an https URL from Google's own image host. This value
    // ends up in a database column and, if the UI renders it, an <img src>, so
    // it is worth refusing anything that is not what it claims to be.
    const url = new URL(picture);
    if (url.protocol !== 'https:') return null;
    if (!/(^|\.)googleusercontent\.com$/.test(url.hostname)) return null;

    // Column is 1024; Google's URLs are far shorter, but a truncated URL would
    // be worse than none at all.
    return url.toString().length <= 1024 ? url.toString() : null;
  } catch {
    // Timed out, offline, malformed URL, or no `profile` scope. All the same
    // answer: no picture.
    return null;
  }
}
