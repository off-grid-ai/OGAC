import { NextResponse } from 'next/server';
import { createConnector, listConnectors } from '@/lib/store';

const AUTHS = ['none', 'api-key', 'oauth'];

export async function GET() {
  return NextResponse.json({ object: 'list', data: await listConnectors() });
}

// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = body?.name as string | undefined;
  const type = body?.type as string | undefined;
  if (!name || !type) {
    return NextResponse.json({ error: 'name and type are required' }, { status: 400 });
  }
  const auth = (body?.auth as string | undefined) ?? 'none';
  if (!AUTHS.includes(auth)) {
    return NextResponse.json({ error: 'auth must be none | api-key | oauth' }, { status: 400 });
  }
  return NextResponse.json(
    await createConnector({
      name,
      type,
      endpoint: (body?.endpoint as string | undefined) ?? '',
      auth,
      description: (body?.description as string | undefined) ?? '',
      custom: true,
    }),
    { status: 201 },
  );
}
