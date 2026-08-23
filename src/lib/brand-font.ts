import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The one bold weight BrandMark's "P" needs, for every ImageResponse route
 * that draws it.
 *
 * next/og ships exactly one built-in font — Geist Regular — and no bold weight
 * at all. Setting `fontWeight` on the glyph without a real font behind it does
 * not error; it silently renders in that same regular weight regardless of what
 * was asked for, which is how a mark meant to be heavy ends up a hairline "P" —
 * the very "turns to mud at 16px" problem an icon exists to avoid.
 *
 * Rather than add a font file to the repo, this reads Liberation Sans Bold from
 * public/pdfjs/standard_fonts/ — a file the app already ships as pdf.js's own
 * font fallback (see scripts/copy-pdf-assets.mjs) — so the mark costs nothing
 * extra. It is guaranteed to exist by the time any of these routes run, in dev
 * and on Vercel alike, because npm's postinstall hook writes it before
 * `next dev` or `next build` ever starts.
 *
 * The path is assembled at runtime, which looks like the shape of reference
 * Next's serverless bundler cannot follow — but it does follow this one, and
 * that was verified rather than assumed: a build with and without an explicit
 * `outputFileTracingIncludes` entry for this file produced byte-identical route
 * traces, both containing the font. `path.join(process.cwd(), <literal>)` keeps
 * the filename statically analysable, which is all the tracer needs. Keep the
 * literal literal — interpolating any part of it is what would break the trace
 * and ship these routes without their font.
 */

export const BRAND_FONT_FAMILY = 'Parva Brand Bold';
const BRAND_FONT_WEIGHT = 700 as const;

let cached: ArrayBuffer | undefined;

export function brandFonts(): {
  name: string;
  data: ArrayBuffer;
  weight: typeof BRAND_FONT_WEIGHT;
  style: 'normal';
}[] {
  if (!cached) {
    const buffer = readFileSync(
      path.join(process.cwd(), 'public/pdfjs/standard_fonts/LiberationSans-Bold.ttf'),
    );
    // .buffer alone can be a larger pooled allocation than this one read —
    // slicing to the exact byte range is what makes this a real, standalone
    // ArrayBuffer rather than a view into memory that isn't all this font.
    cached = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  return [{ name: BRAND_FONT_FAMILY, data: cached, weight: BRAND_FONT_WEIGHT, style: 'normal' }];
}
