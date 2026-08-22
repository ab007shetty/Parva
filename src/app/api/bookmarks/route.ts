import { NextResponse } from 'next/server';

import { getSessionUser } from '@/lib/auth/session';
import { addBookmark, listBookmarks } from '@/lib/appwrite/reader-data';
import { clamp } from '@/lib/utils';

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ bookmarks: [] });

  const bookId = new URL(request.url).searchParams.get('bookId') ?? undefined;

  try {
    const bookmarks = await listBookmarks(user.id, bookId);
    return NextResponse.json({ bookmarks });
  } catch (error) {
    console.error('[parva] listing bookmarks failed', error);
    return NextResponse.json({ error: 'Could not load your bookmarks.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Sign in to keep bookmarks.' }, { status: 401 });

  let body: {
    bookId?: string;
    position?: string;
    page?: number | null;
    percent?: number;
    label?: string | null;
    note?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  if (typeof body.bookId !== 'string' || typeof body.position !== 'string') {
    return NextResponse.json({ error: 'A bookId and a position are required.' }, { status: 400 });
  }

  try {
    const bookmark = await addBookmark({
      userId: user.id,
      bookId: body.bookId,
      position: body.position,
      page: Number.isFinite(body.page) ? Math.max(1, Math.round(body.page as number)) : null,
      percent: clamp(Number(body.percent) || 0, 0, 100),
      // Trimmed to the column size; the label is a convenience, not a document.
      label: typeof body.label === 'string' ? body.label.slice(0, 240) : null,
      note: typeof body.note === 'string' ? body.note.slice(0, 2000) : null,
    });

    return NextResponse.json({ bookmark }, { status: 201 });
  } catch (error) {
    console.error('[parva] creating bookmark failed', error);
    return NextResponse.json({ error: 'That bookmark did not save.' }, { status: 500 });
  }
}
