import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
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
  const updated = await updatePolicyRule(id, result.value, await currentOrgId());
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const ok = await deletePolicyRule(id, await currentOrgId());
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
