import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createCollection, listCollections } from '@/lib/org-knowledge';

export const dynamic = 'force-dynamic';

// Org knowledge collections. Listing is permission-aware (a user sees only collections their role
// may retrieve; admins see all). Creation is admin-only, mirroring the console's admin resources.
export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const role = session.user.role ?? 'viewer';
  return NextResponse.json({ collections: await listCollections(role) });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!String(body.name ?? '').trim())
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  const id = await createCollection(session.user.email, {
    name: body.name,
    description: body.description,
    allowedRoles: Array.isArray(body.allowedRoles) ? body.allowedRoles : [],
  });
  return NextResponse.json({ id });
}
