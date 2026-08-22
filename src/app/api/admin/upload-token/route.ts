import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/session';
import { createUploadJwt } from '@/lib/appwrite/files';
import { BUCKETS } from '@/lib/config';

/**
 * Credentials for a direct browser-to-Appwrite upload.
 *
 * A 200 MB book cannot be POSTed through a route handler — serverless request
 * bodies are capped far below that, and buffering one would blow the function's
 * memory anyway. So the browser uploads straight to Appwrite using a
 * short-lived JWT that acts as this administrator, and Appwrite's own 5 MB
 * chunking handles the size and reports progress.
 *
 * The JWT is only ever issued to a caller who already holds the admin label,
 * and it expires in fifteen minutes.
 */
export async function POST() {
  try {
    const admin = await requireAdmin();
    const { jwt, expiresInSeconds } = await createUploadJwt(admin.id);

    return NextResponse.json(
      {
        jwt,
        expiresInSeconds,
        endpoint: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT,
        projectId: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID,
        buckets: { books: BUCKETS.books, covers: BUCKETS.covers },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 401) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
    if (status === 403) {
      return NextResponse.json({ error: 'Only administrators can upload books.' }, { status: 403 });
    }
    console.error('[parva] could not issue an upload token', error);
    return NextResponse.json({ error: 'Upload is unavailable right now.' }, { status: 500 });
  }
}
