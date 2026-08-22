import type { Metadata, Viewport } from 'next';
import { Archivo, Fraunces } from 'next/font/google';

import './globals.css';

import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE, SITE_URL } from '@/lib/config';
import { getSessionUser } from '@/lib/auth/session';
import { SmoothScroll } from '@/components/motion/smooth-scroll';
import { SiteHeader } from '@/components/chrome/site-header';
import { SiteFooter } from '@/components/chrome/site-footer';
import { ToastHost } from '@/components/ui/toast';
import { CommandPalette } from '@/components/chrome/command-palette';
import { CookieNotice } from '@/components/chrome/cookie-notice';

/**
 * Two faces carry the whole app.
 *
 * Fraunces is the voice: a variable serif with SOFT and WONK axes, set sharp
 * (SOFT 0, WONK 1) so it reads as an editorial display face rather than a
 * friendly one. Archivo is the interface: a grotesque with tight caps that
 * holds up at 11px in labels and in dense admin tables.
 *
 * Reading faces are deliberately absent here — they load only on /read routes
 * so the catalogue is not paying for fonts it never paints.
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
  axes: ['SOFT', 'WONK', 'opsz'],
});

const archivo = Archivo({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-archivo',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${APP_NAME} — ${APP_TAGLINE}`,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website',
    siteName: APP_NAME,
    title: `${APP_NAME} — ${APP_TAGLINE}`,
    description: APP_DESCRIPTION,
    url: SITE_URL,
    // opengraph-image.tsx draws this at request time from the same BrandMark
    // as the favicon, so a link shared to Slack, WhatsApp or search itself
    // shows something rather than a blank card.
  },
  twitter: { card: 'summary_large_image', title: APP_NAME, description: APP_DESCRIPTION },
  // No `icons` block on purpose. `app/icon.tsx`, `app/apple-icon.tsx` and the
  // static `app/favicon.ico` generate the marks, and Next emits the correct
  // tags for them from the file convention — naming files here that do not
  // exist would only add 404s.
  alternates: { canonical: SITE_URL },
  robots: { index: true, follow: true },
};

/**
 * WebSite + SearchAction, read by Google as an invitation to offer a search
 * box directly under the homepage's own result ("sitelinks search box")
 * rather than just a link. `/library?q={term}` is a real, working search —
 * this is not asking for a UI Google cannot actually reach.
 */
const WEBSITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: APP_NAME,
  url: SITE_URL,
  potentialAction: {
    '@type': 'SearchAction',
    target: `${SITE_URL}/library?q={search_term_string}`,
    'query-input': 'required name=search_term_string',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The reader benefits from pinch-zoom on a scanned page; capping it at 5
  // keeps that useful without letting a stray gesture wreck the layout.
  maximumScale: 5,
  // Lets the page reach under a display cutout, which is what makes
  // env(safe-area-inset-*) report anything but zero. globals.css spends those
  // insets on the page gutter and the reader's fixed bars.
  viewportFit: 'cover',
  themeColor: '#ffffff',
  colorScheme: 'light',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${archivo.variable}`}
      /**
       * Browser extensions inject attributes onto <html> before React hydrates
       * — grammar checkers, password managers and theme switchers all do it —
       * and React reports every one as a hydration mismatch it cannot patch.
       *
       * This only covers this element's own attributes, not its descendants, so
       * a genuine mismatch anywhere inside the app is still reported.
       */
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-paper text-ink antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_JSON_LD) }}
        />

        {/* Keyboard users land here first. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-100 focus:ink-fill focus:px-4 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>

        <SmoothScroll>
          <SiteHeader user={user} />
          <main id="main" className="min-h-[70dvh]">
            {children}
          </main>
          <SiteFooter />
        </SmoothScroll>

        <CommandPalette />
        <CookieNotice />
        <ToastHost />
      </body>
    </html>
  );
}
