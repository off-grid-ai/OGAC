import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { consumeRecords, getRedpandaOverview, produceRecord } from '@/lib/adapters/redpanda';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await getRedpandaOverview());
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (body.action === 'validate') return NextResponse.json(await getRedpandaOverview());
    if (body.action === 'produce') return NextResponse.json(await produceRecord(body));
    if (body.action === 'consume') return NextResponse.json(await consumeRecords(body));
    return NextResponse.json(
      { error: 'action must be validate, produce, or consume' },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Redpanda request failed' },
      { status: 400 },
    );
  }
}
