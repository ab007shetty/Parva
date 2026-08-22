'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Download, Heart, Link2, WifiOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import {
  getOfflineBook,
  isOfflineSupported,
  removeOfflineBook,
  saveBookOffline,
} from '@/lib/reader/offline';
import { SITE_URL } from '@/lib/config';
import { formatBytes } from '@/lib/utils';
import type { BookFormat } from '@/types';

/**
 * The secondary actions on a book: favourite, copy a link, download, and save
 * for offline reading.
 *
 * Each one states its outcome rather than its mechanism — "Saved for offline"
 * not "Cached in IndexedDB" — and each keeps the same verb from button to
 * confirmation.
 */
export function BookActions({
  bookId,
  slug,
  title,
  isFavorite: initialFavorite,
  signedIn,
  allowDownload,
  format,
}: {
  bookId: string;
  slug: string;
  title: string;
  isFavorite: boolean;
  signedIn: boolean;
  allowDownload: boolean;
  format: BookFormat;
}) {
  const router = useRouter();
  const [favorite, setFavorite] = useState(initialFavorite);
  const [offlineBytes, setOfflineBytes] = useState<number | null>(null);
  const [saving, setSaving] = useState<number | null>(null);

  useEffect(() => {
    if (!isOfflineSupported()) return;
    void getOfflineBook(bookId).then((record) => setOfflineBytes(record?.bytes ?? null));
  }, [bookId]);

  async function toggleFavorite() {
    if (!signedIn) {
      toast.note('Sign in to keep favourites.', {
        label: 'Sign in',
        run: () => router.push(`/sign-in?next=/book/${slug}`),
      });
      return;
    }

    const next = !favorite;
    setFavorite(next);

    try {
      const response = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookId }),
      });
      if (!response.ok) throw new Error('failed');
      const data = await response.json();
      setFavorite(data.favorite);
      toast.done(data.favorite ? `Added ${title} to favourites.` : 'Removed from favourites.');
    } catch {
      setFavorite(!next);
      toast.warn('That did not save. Check your connection.');
    }
  }

  async function copyLink() {
    const url = `${SITE_URL}/book/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.done('Link copied.');
    } catch {
      // Clipboard access can be denied; show the URL so it can be copied by hand.
      toast.note(url);
    }
  }

  async function download() {
    try {
      const response = await fetch(`/api/book-file/${bookId}?download=1`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? 'failed');
      }
      const { url } = await response.json();
      // A real navigation, so the browser's own download UI takes over.
      window.location.href = url;
    } catch (error) {
      toast.warn(error instanceof Error ? error.message : 'That download could not start.');
    }
  }

  async function toggleOffline() {
    if (!isOfflineSupported()) {
      toast.warn('This browser cannot store books for offline reading.');
      return;
    }

    if (offlineBytes !== null) {
      await removeOfflineBook(bookId);
      setOfflineBytes(null);
      toast.done('Removed the offline copy.');
      return;
    }

    setSaving(0);
    try {
      const response = await fetch(`/api/book-file/${bookId}`);
      if (!response.ok) throw new Error('The file link could not be created.');
      const { url } = await response.json();

      const meta = await saveBookOffline(bookId, url, {
        onProgress: (received, total) => {
          if (total > 0) setSaving(Math.round((received / total) * 100));
        },
      });

      setOfflineBytes(meta.bytes);
      toast.done(`Saved for offline reading — ${formatBytes(meta.bytes)}.`);
    } catch (error) {
      toast.warn(error instanceof Error ? error.message : 'That did not save for offline.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="lg"
        onClick={() => void toggleFavorite()}
        aria-pressed={favorite}
        className={favorite ? 'border-ribbon text-ribbon hover:bg-ribbon hover:text-paper' : undefined}
      >
        <Heart className={favorite ? 'size-4 fill-current' : 'size-4'} strokeWidth={1.5} />
        {favorite ? 'Favourited' : 'Favourite'}
      </Button>

      <Button variant="outline" size="lg" onClick={() => void copyLink()}>
        <Link2 className="size-4" strokeWidth={1.5} />
        Copy link
      </Button>

      <Button
        variant="outline"
        size="lg"
        onClick={() => void toggleOffline()}
        disabled={saving !== null}
        aria-pressed={offlineBytes !== null}
      >
        {offlineBytes !== null ? (
          <>
            <Check className="size-4" strokeWidth={1.5} />
            Offline ready
          </>
        ) : saving !== null ? (
          <>
            <WifiOff className="size-4 animate-pulse" strokeWidth={1.5} />
            Saving {saving}%
          </>
        ) : (
          <>
            <WifiOff className="size-4" strokeWidth={1.5} />
            Save offline
          </>
        )}
      </Button>

      {allowDownload && (
        <Button variant="outline" size="lg" onClick={() => void download()}>
          <Download className="size-4" strokeWidth={1.5} />
          Download {format.toUpperCase()}
        </Button>
      )}
    </div>
  );
}
