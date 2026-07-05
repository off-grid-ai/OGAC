import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteIsmPolicy, getIsmPolicy, setIsmPolicy } from '@/lib/opensearch-alerting';
import { normalizeIsmPolicy } from '@/lib/opensearch-alerting-shape';

export const dynamic = 'force-dynamic';

// SIEM index-lifecycle (ISM) retention policy — read/set/delete over `_plugins/_ism/policies/<id>`.
// The policy id is a query/body param (default the audit index's retention policy). Thin: auth,
// parse, call the lib. Degrades gracefully (supported:false) when ISM isn't installed.

const DEFAULT_POLICY_ID = 'offgrid-audit-retention';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const policyId = url.searchParams.get('policyId')?.trim() || DEFAULT_POLICY_ID;
  return NextResponse.json(await getIsmPolicy(policyId));
}

export async function PUT(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const spec = normalizeIsmPolicy(body ?? {});
  if (!spec) return NextResponse.json({ error: 'policyId is required' }, { status: 400 });
  const result = await setIsmPolicy(spec);
  if (result.error) return NextResponse.json(result, { status: 502 });
  return NextResponse.json(result);
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const policyId = url.searchParams.get('policyId')?.trim() || DEFAULT_POLICY_ID;
  const result = await deleteIsmPolicy(policyId);
  if (result.error) return NextResponse.json(result, { status: 502 });
  if (!result.deleted && result.supported) return NextResponse.json(result, { status: 404 });
  return NextResponse.json(result);
}
