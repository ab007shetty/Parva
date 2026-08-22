import { ImageResponse } from 'next/og';

import { BrandMark } from '@/lib/brand-mark';
import { brandFonts } from '@/lib/brand-font';

/**
 * The installable-app icons the manifest points at.
 *
 * Generated rather than committed as PNGs: the mark is code, so it can never
 * drift from the favicon, and there are no binaries in the repo to regenerate
 * by hand when the design changes.
 */
const ICONS: Record<string, { size: number; padded: boolean }> = {
  'icon-192.png': { size: 192, padded: false },
  'icon-512.png': { size: 512, padded: false },
  // Platforms crop maskable icons to a circle, so this one keeps a safe margin.
  'icon-maskable-512.png': { size: 512, padded: true },
};

export async function GET(_request: Request, { params }: { params: Promise<{ icon: string }> }) {
  const { icon } = await params;
  const spec = ICONS[icon];

  if (!spec) return new Response('Not found', { status: 404 });

  return new ImageResponse(<BrandMark size={spec.size} padded={spec.padded} />, {
    width: spec.size,
    height: spec.size,
    fonts: brandFonts(),
    headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
