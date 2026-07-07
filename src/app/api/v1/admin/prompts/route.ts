import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { createPrompt, listPrompts } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listPrompts(await currentOrgId()) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.name !== 'string' || !b.name.trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  return NextResponse.json(
    await createPrompt(b.name, (b.description as string | undefined) ?? '', await currentOrgId()),
    { status: 201 },
  );
}
