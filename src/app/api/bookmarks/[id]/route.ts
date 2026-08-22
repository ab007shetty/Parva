import { NextResponse } from 'next/server';

import { getSessionUser } from '@/lib/auth/session';
import { removeBookmark, updateBookmark } from '@/lib/appwrite/reader-data';

/**
 * Note that neither handler checks that the bookmark belongs to the caller.
 * It does not have to: both go through the session client, and the row was
 * created with owner-only permissions, so Appwrite refuses a stranger's row
 * with a 404 before our code sees it.
 */

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { id } = await params;

  let body: { label?: string | null; note?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  try {
    const bookmark = await updateBookmark(id, {
      ...(body.label !== undefined ? { label: body.label?.slice(0, 240) ?? null } : {}),
      ...(body.note !== undefined ? { note: body.note?.slice(0, 2000) ?? null } : {}),
    });
    return NextResponse.json({ bookmark });
  } catch (error) {
    console.error('[parva] updating bookmark failed', error);
    return NextResponse.json({ error: 'That change did not save.' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { id } = await params;

  try {
    await removeBookmark(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[parva] deleting bookmark failed', error);
    return NextResponse.json({ error: 'That bookmark could not be removed.' }, { status: 500 });
  }
}
