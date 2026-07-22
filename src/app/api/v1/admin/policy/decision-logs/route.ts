import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { validateDecisionQuery } from '@/lib/opa-audit';
import { aggregateForOrg, listDecisions } from '@/lib/opa-decision-log-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The durable OPA decision-log LEDGER — every persisted authz decision for this org, filtered by the
// validated query (decision=allow|deny|all, path substring, since, limit), plus the aggregate band.
// Read-only; shaping/filtering is the pure opa-audit layer.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const org = await currentOrgId();
  const url = new URL(req.url);
  const query = validateDecisionQuery({
    limit: url.searchParams.get('limit'),
    decision: url.searchParams.get('decision'),
    path: url.searchParams.get('path'),
    since: url.searchParams.get('since'),
  });
  const [data, aggregate] = await Promise.all([listDecisions(query, org), aggregateForOrg(org)]);
  return NextResponse.json({ object: 'list', query, aggregate, data });
}
