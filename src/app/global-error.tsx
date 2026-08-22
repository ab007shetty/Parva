'use client';

import { useEffect } from 'react';

import { APP_NAME } from '@/lib/config';

/**
 * The boundary for a failure in the root layout itself.
 *
 * This replaces the whole document rather than filling a slot inside it, so
 * nothing the app normally supplies is available: no next/font variables, no
 * Tailwind utilities, no token layer. Every value below is therefore written
 * out by hand from the same palette as globals.css — perfect white, near-black
 * ink, one hairline grey — and the heading falls back to the serif stack that
 * stands behind Fraunces. It has to look like Parva without Parva's stylesheet.
 */

const INK = '#0a0a0a';
const INK_SOFT = '#2e2e2e';
const GRAPHITE = '#767676';
const MUTE = '#a3a3a3';
const RULE = '#e9e9e9';

const SERIF = "'Iowan Old Style', Georgia, 'Times New Roman', serif";
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

const ACTION: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '3rem',
  padding: '0 1.5rem',
  fontFamily: SANS,
  fontSize: '0.875rem',
  fontWeight: 500,
  letterSpacing: '0.01em',
  textDecoration: 'none',
  borderStyle: 'solid',
  borderWidth: '1px',
  cursor: 'pointer',
};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[parva] root layout error', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#ffffff',
          color: INK,
          fontFamily: SANS,
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        <style>{`
          .pv-act { transition: background-color 200ms, border-color 200ms, color 200ms; }
          .pv-ink:hover { background: ${INK_SOFT}; border-color: ${INK_SOFT}; }
          .pv-line:hover { background: ${INK}; border-color: ${INK}; color: #ffffff; }
          .pv-act:focus-visible { outline: 2px solid ${INK}; outline-offset: 2px; }
          @media (prefers-reduced-motion: reduce) {
            .pv-act { transition-duration: 0.01ms; }
          }
        `}</style>

        <main
          style={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '5rem 1.5rem',
            textAlign: 'center',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '0.6875rem',
              fontWeight: 500,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: GRAPHITE,
            }}
          >
            {APP_NAME}
          </p>

          <h1
            style={{
              margin: '1.5rem 0 0',
              maxWidth: '34rem',
              fontFamily: SERIF,
              fontSize: 'clamp(2rem, 5.5vw, 3.5rem)',
              fontWeight: 400,
              letterSpacing: '-0.028em',
              lineHeight: 0.95,
            }}
          >
            The app did not load.
          </h1>

          <p
            style={{
              margin: '1.25rem 0 0',
              maxWidth: '26rem',
              fontFamily: SERIF,
              fontSize: '1.0625rem',
              lineHeight: 1.7,
              color: INK_SOFT,
            }}
          >
            This failed before the page could be built. Trying again usually works. If it does
            not, the shelf is still there.
          </p>

          <div
            style={{
              marginTop: '2.25rem',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.75rem',
            }}
          >
            <button
              type="button"
              onClick={reset}
              className="pv-act pv-ink"
              style={{ ...ACTION, background: INK, color: '#ffffff', borderColor: INK }}
            >
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a client-side
                transition would keep the React tree that just failed; only a fresh document
                load actually gets the reader out of here. */}
            <a
              href="/"
              className="pv-act pv-line"
              style={{ ...ACTION, background: '#ffffff', color: INK, borderColor: RULE }}
            >
              Back to the shelf
            </a>
          </div>

          <div style={{ marginTop: '3.5rem', width: '100%', maxWidth: '26rem', height: '1px', background: RULE }} />

          {error.digest ? (
            <p
              style={{
                margin: '1.25rem 0 0',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.6875rem',
                color: MUTE,
              }}
            >
              Reference {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
