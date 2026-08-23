import { NextResponse } from 'next/server';

import { LIMITS as RATE, rateLimitGuard } from '@/lib/rate-limit';

import { coverOriginalRequest, coverPreviewRequest } from '@/lib/appwrite/files';
import { clamp } from '@/lib/utils';

/**
 * Covers are proxied rather than linked directly, so the bucket stays private
 * and the browser caches them on the same origin as the page.
 *
 * Appwrite can resize and re-encode on the fly, which would be ideal — but
 * image transformations are a paid feature, and a free-plan project answers
 * every preview request with 403 `storage_image_transformations_blocked`. So
 * the transform is attempted, and the original bytes are served when it is
 * refused. Covers are therefore sized at upload time instead (see
 * lib/admin/measure-cover.ts), which is the better place for it anyway: once
 * per book rather than once per request.
 */

/**
 * Whether this project may transform images.
 *
 * `null` until the first request finds out. Without this the plan's 403 would
 * be re-discovered on every single cover, doubling both the latency and the
 * bandwidth quota spent on a shelf full of books.
 */
let transformsAllowed: boolean | null = null;

/** Appwrite's own name for "your plan does not include this". */
const BLOCKED = 'storage_image_transformations_blocked';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ coverId: string }> },
) {
  const limited = rateLimitGuard('cover', request, RATE.cover);
  if (limited) return limited;

  const { coverId } = await params;

  // Appwrite ids are alphanumeric with _ and -; refuse anything else rather
  // than forwarding a crafted path.
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(coverId)) {
    return NextResponse.json({ error: 'Not a cover id.' }, { status: 400 });
  }

  const requested = Number(new URL(request.url).searchParams.get('w'));
  const width = Number.isFinite(requested) ? clamp(Math.round(requested), 48, 1600) : 400;

  try {
    let upstream: Response | null = null;

    if (transformsAllowed !== false) {
      const preview = coverPreviewRequest(coverId, { width, output: 'webp', quality: 82 });
      // Appwrite regenerates the same transform deterministically, so let its
      // cache and ours both hold onto it.
      const attempt = await fetch(preview.url, { cache: 'force-cache', headers: preview.headers });

      if (attempt.ok) {
        transformsAllowed = true;
        upstream = attempt;
      } else {
        // Read the body to tell a plan limit apart from a per-file refusal: a
        // blocked plan is permanent and worth remembering, whereas an SVG
        // Appwrite will not rasterise is specific to that one file.
        const reason = await attempt.text().catch(() => '');
        if (reason.includes(BLOCKED)) {
          transformsAllowed = false;
          console.info(
            '[parva] Appwrite image transformations are not available on this plan — serving covers at their stored size. They are sized at upload, so this is expected.',
          );
        }
      }
    }

    if (!upstream) {
      const original = coverOriginalRequest(coverId);
      upstream = await fetch(original.url, { cache: 'force-cache', headers: original.headers });
    }

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: 'Cover unavailable.' }, { status: upstream.status || 502 });
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        // Whatever Appwrite gave us — a transformed WebP, or the stored JPEG.
        'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
        // A cover is immutable for a given id: replacing one creates a new file
        // with a new id, so this can be cached hard.
        'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400, immutable',
      },
    });
  } catch (error) {
    console.error('[parva] cover proxy failed', error);
    return NextResponse.json({ error: 'Cover unavailable.' }, { status: 502 });
  }
}
