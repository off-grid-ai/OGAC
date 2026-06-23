import { NextResponse } from 'next/server';
import { createConnector, listConnectors } from '@/lib/store';

export async function GET() {
  return NextResponse.json({ object: 'list', data: await listConnectors() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = body?.name as string | undefined;
  const type = body?.type as string | undefined;
  if (!name || !type) {
    return NextResponse.json({ error: 'name and type are required' }, { status: 400 });
  }
  return NextResponse.json(await createConnector(name, type), { status: 201 });
}
