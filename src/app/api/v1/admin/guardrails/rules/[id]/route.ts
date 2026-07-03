import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import {
  deleteGuardrailRule,
  setGuardrailRuleEnabled,
  updateGuardrailRule,
  validateRule,
} from '@/lib/guardrails-rules';
import { currentOrgId } from '@/lib/tenancy';

// A single guardrails masking-rule. PATCH either flips the enabled toggle ({ enabled }) or edits
// the whole rule (a full draft, re-validated); DELETE removes it. Admin-gated, thin, org-scoped.

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  // Toggle-only PATCH: just an `enabled` boolean, no other rule fields.
  if (body && typeof body.enabled === 'boolean' && body.matcher === undefined) {
    const updated = await setGuardrailRuleEnabled(id, body.enabled, orgId);
    if (!updated) return NextResponse.json({ error: 'rule not found' }, { status: 404 });
    return NextResponse.json(updated);
  }

  // Full edit: re-validate the whole draft.
  const parsed = validateRule(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const updated = await updateGuardrailRule(id, parsed.value, orgId);
  if (!updated) return NextResponse.json({ error: 'rule not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const deleted = await deleteGuardrailRule(id, await currentOrgId());
  if (!deleted) return NextResponse.json({ error: 'rule not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
