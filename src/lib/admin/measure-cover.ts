'use client';

import { dominantColorFromCanvas } from '@/lib/admin/upload';

/**
 * Prepares a hand-picked cover for the shelf: its aspect ratio, so a book can
 * reserve the exact box before the image loads, its dominant colour, which
 * becomes that book's `--bloom`, and — where it helps — a downscaled copy to
 * store in place of the original.
 *
 * The downscale matters because Appwrite's image transformations are a paid
 * feature: on a free plan every preview request is refused and covers are served
 * at whatever size they were uploaded. A phone photo or a scan can be several
 * thousand pixels wide, and serving that to every visitor of a page full of
 * books would spend the bandwidth quota on pixels nobody can see. Resizing once
 * here is both cheaper and simpler than resizing on every request.
 *
 * Split into its own module so the book form can import it lazily — it is only
 * needed when a librarian actually chooses a cover by hand.
 */

/** Twice the widest slot a cover is ever painted in, so retina screens are
 *  still served 1:1 and nothing larger is kept. */
const MAX_WIDTH = 1200;

export type PreparedCover = {
  ratio: number;
  color: string;
  /** The bytes to upload: a downscaled copy, or the original when it is already
   *  small enough to leave alone. */
  blob: Blob;
};

export async function measureCover(file: File): Promise<PreparedCover> {
  const url = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That image could not be read.'));
      img.src = url;
    });

    const ratio = image.naturalWidth / image.naturalHeight;

    // Sampling a small copy is enough for an average, and much faster than
    // reading a full-resolution cover pixel by pixel.
    const sample = document.createElement('canvas');
    sample.width = Math.min(image.naturalWidth, 400);
    sample.height = Math.max(1, Math.round((sample.width / image.naturalWidth) * image.naturalHeight));
    sample.getContext('2d')?.drawImage(image, 0, 0, sample.width, sample.height);
    const color = dominantColorFromCanvas(sample);

    // Already a sensible size: keep the original bytes rather than re-encoding
    // and losing a little quality for nothing.
    if (image.naturalWidth <= MAX_WIDTH) {
      return { ratio, color, blob: file };
    }

    const scaled = document.createElement('canvas');
    scaled.width = MAX_WIDTH;
    scaled.height = Math.max(1, Math.round(MAX_WIDTH / ratio));
    const context = scaled.getContext('2d');
    if (!context) return { ratio, color, blob: file };

    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, scaled.width, scaled.height);

    const resized = await new Promise<Blob | null>((resolve) =>
      // WebP where the browser can encode it; toBlob falls back on its own
      // where it cannot, and either way the result is smaller than the source.
      scaled.toBlob(resolve, 'image/webp', 0.85),
    );

    // Only take the resized copy if it actually saved something.
    if (resized && resized.size > 0 && resized.size < file.size) {
      return { ratio, color, blob: resized };
    }
    return { ratio, color, blob: file };
  } catch {
    // A ratio close to a trade paperback, and a neutral bloom.
    return { ratio: 0.66, color: '#e9e9e9', blob: file };
  } finally {
    URL.revokeObjectURL(url);
  }
}
