import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { searchAudit } from '@/lib/siem';

// SIEM read-back: full-text + filtered search over the shipped audit index in OpenSearch. Goes
// well beyond the 25-row Postgres slice on the Control page.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const result = await searchAudit({
    q: url.searchParams.get('q') ?? undefined,
    outcome: url.searchParams.get('outcome') ?? undefined,
    deviceId: url.searchParams.get('deviceId') ?? undefined,
    size: url.searchParams.get('size') ? Number(url.searchParams.get('size')) : undefined,
    from: url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined,
  });
  return NextResponse.json(result);
}
