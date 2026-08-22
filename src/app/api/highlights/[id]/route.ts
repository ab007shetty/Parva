import { NextResponse } from 'next/server';

import { getSessionUser } from '@/lib/auth/session';
import { removeHighlight, updateHighlight } from '@/lib/appwrite/reader-data';
import type { HighlightColor } from '@/types';

const COLORS: HighlightColor[] = ['marker', 'ribbon', 'ink'];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { id } = await params;

  let body: { note?: string | null; color?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  try {
    const highlight = await updateHighlight(id, {
      ...(body.note !== undefined ? { note: body.note?.slice(0, 2000) ?? null } : {}),
      ...(body.color && COLORS.includes(body.color as HighlightColor)
        ? { color: body.color as HighlightColor }
        : {}),
    });
    return NextResponse.json({ highlight });
  } catch (error) {
    console.error('[parva] updating highlight failed', error);
    return NextResponse.json({ error: 'That change did not save.' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { id } = await params;

  try {
    await removeHighlight(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[parva] deleting highlight failed', error);
    return NextResponse.json({ error: 'That highlight could not be removed.' }, { status: 500 });
  }
}
