import { NextResponse } from 'next/server';

import { LIMITS as RATE, rateLimitGuard } from '@/lib/rate-limit';

import { getSessionUser } from '@/lib/auth/session';
import { recordReadingDay, saveProgress } from '@/lib/appwrite/reader-data';
import { clamp } from '@/lib/utils';

/**
 * Saves where a reader is in a book, plus the seconds they just read.
 *
 * Called on a debounce while reading and again with `keepalive` as the tab
 * closes, so it has to be cheap and idempotent. Writes go through the session
 * client, so Appwrite's row permissions guarantee a reader can only ever write
 * their own progress — this route does not have to be trusted for that.
 */
export async function POST(request: Request) {
  const limited = rateLimitGuard('progress', request, RATE.readerWrite);
  if (limited) return limited;

  const user = await getSessionUser();
  // Signed-out readers keep their place in localStorage. Not an error.
  if (!user) return NextResponse.json({ ok: false, stored: 'local' }, { status: 200 });

  let body: {
    bookId?: string;
    format?: string;
    locator?: string;
    page?: number;
    totalPages?: number;
    percent?: number;
    secondsDelta?: number;
    day?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const bookId = typeof body.bookId === 'string' ? body.bookId : null;
  const format = body.format === 'epub' ? 'epub' : 'pdf';
  const locator = typeof body.locator === 'string' ? body.locator : null;

  if (!bookId || !locator) {
    return NextResponse.json({ error: 'A bookId and a position are required.' }, { status: 400 });
  }

  const page = Number.isFinite(body.page) ? Math.max(1, Math.round(body.page as number)) : 1;
  const totalPages = Number.isFinite(body.totalPages)
    ? Math.max(1, Math.round(body.totalPages as number))
    : 1;
  const percent = clamp(Number(body.percent) || 0, 0, 100);
  // A single save should never claim more than a long sitting — a clock that
  // ran while the laptop slept would otherwise poison the stats.
  const secondsDelta = clamp(Number(body.secondsDelta) || 0, 0, 3600);

  try {
    const progress = await saveProgress({
      userId: user.id,
      bookId,
      format,
      position: { page, totalPages, percent, locator },
      secondsDelta,
    });

    // Reading days drive streaks. The client sends its own local date so a
    // late-night session counts as the day it felt like, not UTC's opinion.
    if (secondsDelta > 0 && typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day)) {
      await recordReadingDay({
        userId: user.id,
        day: body.day,
        seconds: secondsDelta,
        pages: 1,
      }).catch(() => {
        // Stats are not worth failing a position save over.
      });
    }

    return NextResponse.json({ ok: true, percent: progress.percent, finished: progress.finished });
  } catch (error) {
    console.error('[parva] progress save failed', error);
    return NextResponse.json({ error: 'Could not save your place.' }, { status: 500 });
  }
}
