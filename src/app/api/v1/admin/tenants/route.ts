import { NextResponse } from 'next/server';
import { createTenant, listTenants } from '@/lib/store';

export async function GET() {
  return NextResponse.json({ object: 'list', data: await listTenants() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = body?.name as string | undefined;
  const plan = (body?.plan as string | undefined) ?? 'standard';
  const enabledModules = Array.isArray(body?.enabledModules) ? body.enabledModules : [];
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  return NextResponse.json(await createTenant(name, plan, enabledModules), { status: 201 });
}
