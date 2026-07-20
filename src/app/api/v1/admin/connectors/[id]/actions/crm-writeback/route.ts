import { NextResponse } from 'next/server';
import { writeCrmOpportunityFollowUp } from '@/lib/adapters/crm-writeback';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { listConnectors } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

const STATUS_BY_CODE = {
  'invalid-command': 400,
  'unsupported-connector': 422,
  'record-not-found': 404,
  'idempotency-conflict': 409,
  'upstream-error': 502,
} as const;

// Tenant-scoped CRM action endpoint. The caller chooses only the owned connector id and a typed
// follow-up command; the adapter owns the fixed opportunities path and allowlisted patch.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const [{ id }, orgId, body] = await Promise.all([
    params,
    currentOrgId(),
    req.json().catch(() => null),
  ]);
  const connector = (await listConnectors(orgId)).find((candidate) => candidate.id === id);
  if (!connector) return NextResponse.json({ error: 'unknown connector' }, { status: 404 });

  const result = await writeCrmOpportunityFollowUp(connector, body, orgId);
  if (!result.ok) {
    auditFromSession(gate, orgId, {
      action: 'connector.crm.writeback',
      resource: `connector:${id}`,
      outcome: result.code === 'invalid-command' ? 'blocked' : 'error',
    });
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: STATUS_BY_CODE[result.code] },
    );
  }

  auditFromSession(gate, orgId, {
    action: 'connector.crm.writeback',
    resource: `connector:${id}/opportunity:${result.receipt.opportunityId}`,
    outcome: 'ok',
  });
  return NextResponse.json(result, { status: result.receipt.replayed ? 200 : 201 });
}
