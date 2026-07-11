import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { pipelineTag } from '@/lib/pipeline-api-key-format';
import { revokeKey } from '@/lib/pipeline-api-keys';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Revoke a pipeline's provisioned API key (soft delete — the row survives for the audit trail; the
// key fails verification immediately). Admin-gated, org-scoped, audited. The route params carry the
// pipeline id for the URL shape; revoke is keyed by keyId + org (a key can't be revoked cross-org).

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; keyId: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id, keyId } = await params;
  const orgId = await currentOrgId();

  const revoked = await revokeKey(keyId, orgId);
  if (!revoked) return NextResponse.json({ error: 'unknown or already-revoked key' }, { status: 404 });

  auditFromSession(gate, orgId, {
    action: 'pipeline.key.revoke',
    resource: pipelineTag(id),
    outcome: 'ok',
  });

  return NextResponse.json({ revoked: true });
}
