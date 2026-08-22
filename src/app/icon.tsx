import { ImageResponse } from 'next/og';

import { BrandMark } from '@/lib/brand-mark';
import { brandFonts } from '@/lib/brand-font';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  // Unpadded: a browser tab is already tiny, so the mark should fill it.
  return new ImageResponse(<BrandMark size={32} padded={false} />, { ...size, fonts: brandFonts() });
}
