import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { searchAudit } from '@/lib/siem';

// SIEM read-back: full-text + filtered search over the shipped audit index in OpenSearch. Goes
// well beyond the 25-row Postgres slice on the Control page.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const g = (k: string) => url.searchParams.get(k) ?? undefined;
  const result = await searchAudit({
    q: g('q'),
    outcome: g('outcome'),
    actor: g('actor'),
    action: g('action'),
    project: g('project'),
    deviceId: g('deviceId'),
    from: g('from'), // ISO time-window lower bound
    to: g('to'), // ISO time-window upper bound
    size: g('size') ? Number(g('size')) : undefined,
    offset: g('offset') ? Number(g('offset')) : undefined,
  });
  return NextResponse.json(result);
}
