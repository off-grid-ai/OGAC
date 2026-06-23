import { NextResponse } from 'next/server';
import { addGoldenCase, listGoldenCases } from '@/lib/evals';

export async function GET() {
  return NextResponse.json({ object: 'list', data: await listGoldenCases() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const query = body?.query as string | undefined;
  const expected = body?.expected as string | undefined;
  if (!query || !expected) {
    return NextResponse.json({ error: 'query and expected are required' }, { status: 400 });
  }
  return NextResponse.json(await addGoldenCase(query, expected), { status: 201 });
}
