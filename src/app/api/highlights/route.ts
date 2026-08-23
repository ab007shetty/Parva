import { NextResponse } from 'next/server';

import { LIMITS as RATE, rateLimitGuard } from '@/lib/rate-limit';

import { getSessionUser } from '@/lib/auth/session';
import { addHighlight, listHighlights } from '@/lib/appwrite/reader-data';
import { clamp } from '@/lib/utils';
import type { HighlightColor } from '@/types';

const COLORS: HighlightColor[] = ['marker', 'ribbon', 'ink'];

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ highlights: [] });

  const bookId = new URL(request.url).searchParams.get('bookId') ?? undefined;

  try {
    const highlights = await listHighlights(user.id, bookId);
    return NextResponse.json({ highlights });
  } catch (error) {
    console.error('[parva] listing highlights failed', error);
    return NextResponse.json({ error: 'Could not load your highlights.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const limited = rateLimitGuard('highlights', request, RATE.readerWrite);
  if (limited) return limited;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Sign in to keep highlights.' }, { status: 401 });

  let body: {
    bookId?: string;
    position?: string;
    page?: number | null;
    percent?: number;
    text?: string;
    note?: string | null;
    color?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  if (typeof body.bookId !== 'string' || typeof body.position !== 'string' || !body.text?.trim()) {
    return NextResponse.json(
      { error: 'A bookId, a position and the highlighted text are required.' },
      { status: 400 },
    );
  }

  try {
    const highlight = await addHighlight({
      userId: user.id,
      bookId: body.bookId,
      position: body.position,
      page: Number.isFinite(body.page) ? Math.max(1, Math.round(body.page as number)) : null,
      percent: clamp(Number(body.percent) || 0, 0, 100),
      text: body.text.trim(),
      note: typeof body.note === 'string' ? body.note.slice(0, 2000) : null,
      color: COLORS.includes(body.color as HighlightColor) ? (body.color as HighlightColor) : 'marker',
    });

    return NextResponse.json({ highlight }, { status: 201 });
  } catch (error) {
    console.error('[parva] creating highlight failed', error);
    return NextResponse.json({ error: 'That highlight did not save.' }, { status: 500 });
  }
}
