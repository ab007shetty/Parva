import type { Metadata } from 'next';
import Link from 'next/link';

import { APP_NAME, SESSION_COOKIE } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Privacy',
  description: `Everything ${APP_NAME} stores, everything it does not, and how to remove it.`,
};

/**
 * Written as an explanation rather than a policy. Every claim below maps to
 * something in the codebase — the one cookie in lib/auth/session.ts, the local
 * keys in lib/reader/store.ts, the deliberately thin admin readers table — so
 * it can be checked rather than trusted.
 */
export default function PrivacyPage() {
  return (
    <div className="px-[var(--page-gutter)] pt-12 pb-24 sm:pt-16">
      <div className="max-w-3xl">
        <h1 className="display text-[clamp(2.25rem,6vw,4rem)]">Privacy</h1>

        <p className="prose-read mt-6 max-w-xl">
          Reading here needs no account and the catalogue works without one. This page
          lists what {APP_NAME} keeps, where it keeps it, and how to get rid of it.
        </p>
      </div>

      <div className="mt-14 max-w-5xl border-b border-rule">
        <Section title="What is stored">
          <p>
            One cookie, named{' '}
            <code className="font-mono text-[0.9375rem] text-ink">{SESSION_COOKIE}</code>. It is
            set when you sign in and cleared when you sign out, and it holds nothing but
            the secret that identifies your session. It is first-party,{' '}
            <code className="font-mono text-[0.9375rem] text-ink">httpOnly</code> — so no
            script on the page can read it — and{' '}
            <code className="font-mono text-[0.9375rem] text-ink">sameSite=lax</code>, so it
            is not sent along with requests coming from other sites. That is the only cookie
            {' '}{APP_NAME} sets. Opening a book sets none at all.
          </p>
          <p>
            Your browser also keeps some things on the device itself: how you like a page to
            look — face, size, spacing, margin, tone — the place you stopped in each book, a
            cached index for EPUBs so they reopen instantly, and, only if you ask for it, a
            whole book saved for offline reading. Those sit in this site&rsquo;s local
            storage and in IndexedDB, under keys beginning{' '}
            <code className="font-mono text-[0.9375rem] text-ink">parva.</code>, and are
            never sent anywhere.
          </p>
          <p>
            When you are signed in, the things you asked to be remembered are stored against
            your account instead: your place in each book, your bookmarks, your highlights,
            your favourites, and which days you read. That is what signing in is for. Those
            rows are written so that only your own session can read them.
          </p>
        </Section>

        <Section title="What is not collected">
          <p>
            No analytics. No tracking pixels, no fingerprinting, no advertising, no
            third-party cookies, and nothing sold or shared with anyone. Nothing is fetched
            from another company&rsquo;s servers while you read — the typefaces and icons
            ship with the app.
          </p>
          <p>
            Each book carries a running total of how many times it has been opened, which is
            what the &ldquo;Most read&rdquo; sort uses. That number lives on the book and is
            not connected to any reader.
          </p>
        </Section>

        <Section title="What an administrator can see">
          <p>
            One list, of four columns: your name, your email address, when you were last
            seen, and when you first signed in. That is the whole of it. Reading is open to
            everyone, so most visitors never appear on that list at all.
          </p>
          <p>
            It shows nothing about what you read. Positions, bookmarks and highlights are
            written for your session only, and the readers screen deliberately asks for none
            of them — putting reading history on an administrator&rsquo;s desk would make
            this a surveillance tool instead of a catalogue. The rest of the admin area
            handles books, covers and read counts.
          </p>
        </Section>

        <Section title="Google sign-in">
          <p>
            It happens only if you choose it. Selecting &ldquo;Continue with Google&rdquo;
            hands you to Google, which asks whether you want to sign in to this app.{' '}
            {APP_NAME} never sees your Google password, and if you close that page or refuse,
            nothing is created and nothing is stored.
          </p>
          <p>
            If you agree, Google passes your name and email address to Appwrite, which is
            where accounts for this app live. {APP_NAME} copies those two fields into its own
            record so an administrator can see who has signed in. Your profile picture is not
            fetched — the initials you see in the header are drawn from your name.
          </p>
        </Section>

        <Section title="Removing your data">
          <p>
            Signing out clears the cookie. Clearing this site&rsquo;s data in your browser
            removes everything held on the device: reading settings, saved positions, cached
            EPUB indexes and any offline books. Offline copies can also be removed one at a
            time, from a book&rsquo;s page or from{' '}
            <Link href="/me/settings" className="link-rule text-ink">
              reading settings
            </Link>
            .
          </p>
          <p>
            There is no button in the app that deletes an account. Removing one, and the rows
            attached to it, is an administrator&rsquo;s job in Appwrite.
          </p>
        </Section>
      </div>

      <p className="mt-12 max-w-xl text-[0.8125rem] leading-relaxed text-mute">
        If something here does not match what the app actually does, the app is wrong and
        should be fixed — not this page.
      </p>
    </div>
  );
}

/**
 * Heading in the margin, prose in the column — so the page can be scanned by
 * heading without the headings competing with the reading measure.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-5 border-t border-rule py-10 lg:grid-cols-[12rem_1fr] lg:gap-12 lg:py-12">
      <h2 className="label-ink lg:sticky lg:top-28 lg:self-start lg:pt-1.5">{title}</h2>
      <div className="prose-read max-w-xl space-y-5">{children}</div>
    </section>
  );
}
