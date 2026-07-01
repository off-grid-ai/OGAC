import { NextResponse } from 'next/server';
import { createCustomRole, listCustomRoles } from '@/lib/store';

const BASE_ROLES = ['viewer', 'operator', 'admin'];

export async function GET() {
  return NextResponse.json({ object: 'list', data: await listCustomRoles() });
}

// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = b?.name as string | undefined;
  if (!name || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const basedOn = (b?.basedOn as string | undefined) ?? 'viewer';
  if (!BASE_ROLES.includes(basedOn)) {
    return NextResponse.json({ error: 'basedOn must be viewer | operator | admin' }, { status: 400 });
  }
  const caps = Array.isArray(b?.capabilities) ? (b!.capabilities as string[]) : [];
  return NextResponse.json(
    await createCustomRole({
      name,
      description: (b?.description as string | undefined) ?? '',
      basedOn,
      capabilities: caps,
    }),
    { status: 201 },
  );
}
