import { ImageResponse } from 'next/og';

import { BrandMark } from '@/lib/brand-mark';
import { brandFonts } from '@/lib/brand-font';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  // iOS rounds the corners itself and shows the icon large, so it gets padding.
  return new ImageResponse(<BrandMark size={180} />, { ...size, fonts: brandFonts() });
}
