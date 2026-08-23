import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { APP_NAME } from '@/lib/config';
import { getSessionUser } from '@/lib/auth/session';
import { SignInForm } from '@/components/auth/sign-in-form';

export const metadata: Metadata = {
  title: 'Sign in',
  description: `Sign in to ${APP_NAME} to keep your place, your bookmarks and your favourites.`,
  robots: { index: false, follow: true },
};

const ERRORS: Record<string, string> = {
  google: 'Google sign-in was cancelled or refused. You can try again.',
  incomplete: 'Google did not send everything needed to finish signing in. Try once more.',
  exchange: 'That sign-in could not be completed. Try again in a moment.',
  config: 'Sign-in is not configured yet. An administrator needs to enable Google in Appwrite.',
  origin:
    'Appwrite refused the sign-in redirect for this domain. An administrator needs to add it ' +
    'under Overview → Platforms in the Appwrite console.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  // Already signed in — there is nothing to do on this page.
  const user = await getSessionUser();
  if (user) redirect(next && next.startsWith('/') ? next : '/');

  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  return (
    <div className="mx-auto grid min-h-[80dvh] w-full max-w-6xl items-center gap-16 px-[var(--page-gutter)] py-16 lg:grid-cols-2 lg:gap-24">
      <div>
        <h1 className="display text-[clamp(2.5rem,6.5vw,4.5rem)]">
          Sign in to keep your place.
        </h1>

        <p className="prose-read mt-6 max-w-md">
          You never needed an account to read here, and you still do not. Signing in
          only adds memory: the page you stopped on, the passages you marked, the
          books you meant to come back to.
        </p>

        <ul className="mt-10 space-y-3 border-t border-rule pt-8 text-[0.875rem] text-graphite">
          <li className="flex gap-3">
            <span className="text-ink" aria-hidden="true">
              —
            </span>
            Your place, kept across every device you read on
          </li>
          <li className="flex gap-3">
            <span className="text-ink" aria-hidden="true">
              —
            </span>
            Bookmarks and highlights that stay put
          </li>
          <li className="flex gap-3">
            <span className="text-ink" aria-hidden="true">
              —
            </span>
            A shelf of favourites, and what you have finished
          </li>
        </ul>
      </div>

      <div className="lg:justify-self-end lg:pl-8">
        <div className="w-full max-w-sm border border-ink p-8 sm:p-10">
          {error && ERRORS[error] && (
            <p
              role="alert"
              className="mb-7 border-l-2 border-ribbon pl-3 text-[0.8125rem] leading-relaxed text-ink-soft"
            >
              {ERRORS[error]}
            </p>
          )}

          <SignInForm next={safeNext} />
        </div>

        <p className="mt-6 max-w-sm text-[0.75rem] leading-relaxed text-mute">
          There is no sign-up form. Continuing with Google creates your shelf the
          first time, and signs you into it after that.
        </p>

        <Link href="/library" className="link-rule mt-6 inline-block text-[0.8125rem] text-graphite">
          Keep reading without an account
        </Link>
      </div>
    </div>
  );
}
