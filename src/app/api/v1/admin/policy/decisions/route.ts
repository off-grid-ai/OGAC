import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { readDecisions, readPolicyStatus } from '@/lib/policy-view';

// Policy decisions read-back: the active policy set + OPA reachability, plus normalized recent
// decision-log records. Read-only; the shaping is the pure normalizer in lib/policy-view.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const [status, decisions] = await Promise.all([readPolicyStatus(), readDecisions()]);
  return NextResponse.json({ object: 'list', status, data: decisions });
}
