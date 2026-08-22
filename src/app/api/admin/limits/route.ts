import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/appwrite/server';
import { BUCKETS, LIMITS, SHARED_BUCKET } from '@/lib/config';

/**
 * The real upload ceilings, read from the buckets themselves.
 *
 * The app cannot know these up front — Appwrite Cloud's free plan caps a file at
 * 50 MB, Pro at 5 GB, and a self-hosted instance at whatever
 * `_APP_STORAGE_LIMIT` says. Hardcoding a number would either reject files the
 * instance would have accepted, or let an upload get most of the way through
 * before Appwrite refuses it.
 *
 * So the upload form asks, and reports the true limit to whoever is standing at
 * it.
 */
export async function GET() {
  try {
    await requireAdmin();

    const { storage } = createAdminClient();

    const books = await storage.getBucket({ bucketId: BUCKETS.books });
    const covers = SHARED_BUCKET
      ? books
      : await storage.getBucket({ bucketId: BUCKETS.covers });

    return NextResponse.json(
      {
        maxBookBytes: books.maximumFileSize,
        // When one bucket holds both, its limit is sized for books — which
        // would let someone upload a 30 MB cover. Keep the app's own, saner
        // ceiling for images.
        maxCoverBytes: SHARED_BUCKET
          ? Math.min(covers.maximumFileSize, LIMITS.coverFileBytes)
          : covers.maximumFileSize,
        bookExtensions: books.allowedFileExtensions ?? [],
      },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    );
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 401) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
    if (status === 403) {
      return NextResponse.json({ error: 'That area is for administrators.' }, { status: 403 });
    }

    // A missing bucket means setup has not run. Fall back to the app's own
    // ceiling so the form still works rather than blocking every upload.
    console.error('[parva] could not read bucket limits', error);
    return NextResponse.json({
      maxBookBytes: LIMITS.bookFileBytes,
      maxCoverBytes: LIMITS.coverFileBytes,
      bookExtensions: [],
      unverified: true,
    });
  }
}
