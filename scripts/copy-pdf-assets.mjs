/**
 * pdf.js ships its worker, cmaps, standard fonts, ICC profiles and wasm decoders
 * as separate files. Serving them from /public keeps the reader working offline
 * and avoids a CDN dependency. Runs on postinstall.
 */
import { cp, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'pdfjs-dist');
const to = join(root, 'public', 'pdfjs');

const exists = async (p) => access(p).then(() => true, () => false);

if (!(await exists(from))) {
  console.log('[parva] pdfjs-dist not installed yet — skipping asset copy.');
  process.exit(0);
}

await mkdir(to, { recursive: true });

const jobs = [
  ['build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['cmaps', 'cmaps'],
  ['standard_fonts', 'standard_fonts'],
  ['wasm', 'wasm'],
  ['iccs', 'iccs'],
];

for (const [src, dest] of jobs) {
  const s = join(from, src);
  if (!(await exists(s))) {
    console.warn(`[parva] pdfjs asset missing, skipped: ${src}`);
    continue;
  }
  await cp(s, join(to, dest), { recursive: true });
}

console.log('[parva] pdf.js assets copied to public/pdfjs');
