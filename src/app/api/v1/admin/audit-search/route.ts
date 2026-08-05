import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { searchAudit } from '@/lib/siem';
import { currentOrgId } from '@/lib/tenancy';

// SIEM read-back: full-text + filtered search over the shipped audit index in OpenSearch. Goes
// well beyond the 25-row Postgres slice on the Control page.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const g = (k: string) => url.searchParams.get(k) ?? undefined;
  // The org comes from the request's own tenant binding, never from a query parameter — otherwise
  // this endpoint would let a caller ask for another tenant's audit trail by name.
  const result = await searchAudit({
    org: await currentOrgId(),
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
