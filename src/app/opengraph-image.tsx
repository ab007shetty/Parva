import { ImageResponse } from 'next/og';

import { BrandMark } from '@/lib/brand-mark';
import { brandFonts } from '@/lib/brand-font';
import { APP_NAME, APP_TAGLINE } from '@/lib/config';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The card a shared link shows — Slack, WhatsApp, iMessage, and the preview
 * some search results grow. Without one, social platforms render a blank grey
 * rectangle; the same drawn mark that is the favicon carries it instead, so a
 * shared link looks like it belongs to the app rather than to nothing.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 40,
          background: '#ffffff',
        }}
      >
        <BrandMark size={168} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              fontSize: 88,
              fontFamily: 'serif',
              letterSpacing: '-0.03em',
              color: '#0a0a0a',
            }}
          >
            {APP_NAME}
          </div>
          <div style={{ fontSize: 30, color: '#767676', letterSpacing: '0.01em' }}>
            {APP_TAGLINE}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: brandFonts() },
  );
}
