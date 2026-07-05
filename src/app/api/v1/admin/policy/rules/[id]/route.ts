import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { validatePolicyRulePatch } from '@/lib/policy-rules-policy';
import { deletePolicyRule, updatePolicyRule } from '@/lib/policy-rules';
import { currentOrgId } from '@/lib/tenancy';

// Console-owned policy-rule item: update (PATCH) + delete. Org-scoped so a rule can only be touched
// within the caller's tenant.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = validatePolicyRulePatch(body);
  if (!result.ok || !result.value) {
    return NextResponse.json({ error: result.errors.join('; ') }, { status: 400 });
  }
  const orgId = await currentOrgId();
  const updated = await updatePolicyRule(id, result.value, orgId);
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'policy.change',
    resource: `policy-rule:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const ok = await deletePolicyRule(id, orgId);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'policy.change',
    resource: `policy-rule:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true });
}
