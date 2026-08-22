import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // No `images` block on purpose: nothing uses next/image. Every image in the
  // app is either already sized and encoded by /api/cover, a rasterised pdf.js
  // thumbnail, or a local blob preview — so the optimiser has nothing to add,
  // and an allow-list naming the Appwrite host would wrongly imply covers are
  // fetched from it directly rather than proxied.

  turbopack: {
    // Pin the workspace root. Without this, Turbopack walks up looking for a
    // lockfile and can land on one outside the project, which changes what it
    // considers part of the build.
    root: path.resolve(__dirname),
  },

  async headers() {
    return [
      {
        // pdf.js loads its worker + wasm decoders from here. Long-cache them:
        // the filenames are version-pinned by the postinstall copy.
        source: '/pdfjs/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
