import { NextResponse } from 'next/server';

import { getSessionUser } from '@/lib/auth/session';
import { listFavorites, toggleFavorite } from '@/lib/appwrite/reader-data';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ favorites: [] });

  try {
    const favorites = await listFavorites(user.id);
    return NextResponse.json({ favorites });
  } catch (error) {
    console.error('[parva] listing favourites failed', error);
    return NextResponse.json({ error: 'Could not load your favourites.' }, { status: 500 });
  }
}

/** Toggles, and returns the resulting state so the caller can render it. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Sign in to keep favourites.' }, { status: 401 });

  let bookId: string;
  try {
    const body = await request.json();
    bookId = String(body.bookId ?? '');
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  if (!bookId) return NextResponse.json({ error: 'A bookId is required.' }, { status: 400 });

  try {
    const favorite = await toggleFavorite(user.id, bookId);
    return NextResponse.json({ favorite });
  } catch (error) {
    console.error('[parva] toggling favourite failed', error);
    return NextResponse.json({ error: 'That did not save.' }, { status: 500 });
  }
}
