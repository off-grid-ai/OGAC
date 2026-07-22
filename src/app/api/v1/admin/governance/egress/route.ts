import { NextResponse } from 'next/server';
import { actorFrom } from '@/lib/audit-event';
import { requireAdmin } from '@/lib/authz';
import { normalizeEgressPolicy } from '@/lib/egress-dlp';
import { egressDlpPolicyAuditEvent } from '@/lib/egress-dlp-audit';
import { getEgressPolicy, listEgressDecisions, setEgressPolicy } from '@/lib/egress-policy-store';
import { readGuardrailsView } from '@/lib/guardrails-view';
import { recordAudit } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// GET — the org's cloud egress-DLP policy + the (deploy-owned) guardrail-engine reachability + the
// most recent egress decisions (masked / blocked / unprotected), for the governance surface.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const [policy, view, decisions] = await Promise.all([
    getEgressPolicy(orgId),
    readGuardrailsView().catch(() => null),
    listEgressDecisions(orgId, 25),
  ]);
  return NextResponse.json({
    policy: { enabled: policy.enabled, strictness: policy.strictness },
    updatedAt: policy.updatedAt,
    updatedBy: policy.updatedBy,
    // The guardrail engine is deploy-owned (a fleet CONFIG concern). Surface its state HONESTLY — a
    // cloud route fails closed when it is unreachable, so the operator must see whether it's up.
    engine: view
      ? { name: view.engine, configured: view.configured, reachable: view.reachable }
      : { name: 'unknown', configured: false, reachable: false },
    decisions,
  });
}

// PATCH — set the org's egress-DLP policy (enabled + strictness). Admin-only; audited (before→after).
export async function PATCH(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'a JSON body is required' }, { status: 400 });
  }
  if (body.strictness !== undefined && body.strictness !== 'mask' && body.strictness !== 'block') {
    return NextResponse.json({ error: "strictness must be 'mask' or 'block'" }, { status: 400 });
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
  }

  const before = await getEgressPolicy(orgId);
  // Merge the patch onto the current policy, then normalize (default-secure) via the pure rule.
  const merged = normalizeEgressPolicy({
    enabled: body.enabled ?? before.enabled,
    strictness: body.strictness ?? before.strictness,
  });
  const after = await setEgressPolicy(merged, gate.user?.email ?? 'admin', orgId);

  recordAudit(
    egressDlpPolicyAuditEvent(
      { actor: actorFrom({ email: gate.user?.email ?? 'admin' }), org: orgId },
      { enabled: before.enabled, strictness: before.strictness },
      { enabled: after.enabled, strictness: after.strictness },
    ),
  );
  return NextResponse.json({
    policy: { enabled: after.enabled, strictness: after.strictness },
    updatedAt: after.updatedAt,
    updatedBy: after.updatedBy,
  });
}
