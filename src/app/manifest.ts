import type { MetadataRoute } from 'next';

import { APP_DESCRIPTION, APP_NAME } from '@/lib/config';

/**
 * Installable, so the reader can live on a home screen with no browser chrome
 * around it — which is the right frame for a full-screen book.
 *
 * `display: standalone` rather than fullscreen: fullscreen hides the status bar
 * too, and losing the clock and battery while reading for an hour is worse than
 * the few pixels it saves.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    categories: ['books', 'education', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Library', short_name: 'Library', url: '/library' },
      { name: 'Your shelf', short_name: 'Shelf', url: '/me' },
    ],
  };
}
