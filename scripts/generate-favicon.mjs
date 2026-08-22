// One-off generator, not part of the app runtime.
//
// app/icon.tsx already draws the tab icon at request time from BrandMark, and
// that is the right way to keep every icon in sync. But some crawlers, share
// scrapers and older browsers request /favicon.ico directly rather than
// reading the <link rel="icon"> tag Next emits for a code-generated icon —
// Google's own favicon guidance names /favicon.ico as one of exactly two ways
// it discovers a site's icon. So this renders the identical mark to a real
// multi-resolution .ico as a static fallback, rather than leaving that path
// to 404.
//
// The markup below is `BrandMark` (src/lib/brand-mark.tsx) transcribed to SVG
// — same "P" on the same solid square, same Liberation Sans Bold (see
// src/lib/brand-font.ts for why that specific file), embedded as a data URI
// so this doesn't depend on whatever font a bare `font-family: sans-serif`
// happens to resolve to on the machine running the script. Run with:
//   node scripts/generate-favicon.mjs

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const fontPath = path.join(root, 'public/pdfjs/standard_fonts/LiberationSans-Bold.ttf');
const fontBase64 = (await readFile(fontPath)).toString('base64');

function brandMarkSvg(size, padded) {
  // Same proportions as BrandMark: a small safe margin on the favicon itself,
  // a generous one wherever a platform crops or rounds the icon.
  const inset = padded ? size * 0.22 : size * 0.08;
  const fontSize = (size - inset * 2) * 0.92;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <style>
        @font-face {
          font-family: 'Parva Brand Bold';
          src: url(data:font/ttf;base64,${fontBase64}) format('truetype');
          font-weight: 700;
        }
      </style>
    </defs>
    <rect width="${size}" height="${size}" fill="#0a0a0a" />
    <text
      x="50%" y="50%"
      font-family="Parva Brand Bold" font-weight="700" font-size="${fontSize}"
      fill="#ffffff" text-anchor="middle" dominant-baseline="central"
    >P</text>
  </svg>`;
}

/** Packs PNG buffers into a valid multi-image ICO (the "PNG-in-ICO" format
 *  every browser and OS has supported since Vista — no bitmap re-encoding
 *  needed). */
function packIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  let offset = 6 + count * 16;
  const entries = [];
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }

  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const SIZES = [16, 32, 48];
const MASTER = 512; // rasterised once, then downsampled — sharper than
// rendering each tiny size from its own rounded pixel measurements.

const pngs = await Promise.all(
  SIZES.map(async (size) => {
    const master = await sharp(Buffer.from(brandMarkSvg(MASTER, false))).png().toBuffer();
    const data = await sharp(master).resize(size, size).png().toBuffer();
    return { size, data };
  }),
);

const ico = packIco(pngs);

await writeFile(path.join(root, 'src/app/favicon.ico'), ico);

console.log('Wrote src/app/favicon.ico');
