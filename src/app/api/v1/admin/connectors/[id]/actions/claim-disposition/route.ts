import { NextResponse } from 'next/server';
import { writeClaimDisposition } from '@/lib/adapters/claim-disposition-writeback';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { listConnectors } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

const STATUS_BY_CODE = {
  'invalid-command': 400,
  'unsupported-connector': 422,
  'idempotency-conflict': 409,
  'in-progress': 409,
  'claim-not-found': 404,
  'terminal-claim': 409,
  'source-error': 502,
} as const;

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

  const actorId = gate.user.email ?? gate.user.name ?? 'unknown';
  const result = await writeClaimDisposition(connector, body, orgId, actorId);
  if (!result.ok) {
    auditFromSession(gate, orgId, {
      action: 'claim.disposition.write',
      resource: `connector:${id}`,
      outcome: ['invalid-command', 'idempotency-conflict', 'terminal-claim'].includes(result.code)
        ? 'blocked'
        : 'error',
    });
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: STATUS_BY_CODE[result.code] },
    );
  }

  auditFromSession(gate, orgId, {
    action: 'claim.disposition.write',
    resource: `connector:${id}/claim:${result.receipt.claimId}`,
    outcome: 'ok',
  });
  return NextResponse.json(result, { status: result.receipt.replayed ? 200 : 201 });
}
