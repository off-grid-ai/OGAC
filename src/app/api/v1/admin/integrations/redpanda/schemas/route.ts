import { NextResponse } from 'next/server';
import { createSchemaVersion } from '@/lib/adapters/redpanda';
import { requireAdmin } from '@/lib/authz';

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    return NextResponse.json(await createSchemaVersion(body.subject, body), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Schema create failed' },
      { status: 400 },
    );
  }
}
