import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { addGoldenCase, listGoldenCases } from '@/lib/evals';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listGoldenCases() });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const query = body?.query as string | undefined;
  const expected = body?.expected as string | undefined;
  if (!query || !expected) {
    return NextResponse.json({ error: 'query and expected are required' }, { status: 400 });
  }
  return NextResponse.json(await addGoldenCase(query, expected), { status: 201 });
}
