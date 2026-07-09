import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { validateRoiSettingsInput } from '@/lib/roi';
import { computeOrgRoiRollup } from '@/lib/roi-reader';
import { getOrgRoiDefault, setOrgRoiDefault } from '@/lib/roi-settings-store';

export const dynamic = 'force-dynamic';

// ─── Org-wide ROI rollup + default estimates ──────────────────────────────────────────────────────
// GET  → the org ROI rollup (per-department + top apps by value) plus the org-default estimates.
// PUT  → set the org-default minutes-saved / loaded-cost-per-hour ESTIMATES (validated).
// Admin-gated, org-scoped, thin.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const [rollup, orgDefault] = await Promise.all([
    computeOrgRoiRollup(orgId),
    getOrgRoiDefault(orgId),
  ]);
  return NextResponse.json({ rollup, orgDefault });
}

export async function PUT(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const body = await req.json().catch(() => null);
  const result = validateRoiSettingsInput(body);
  if (!result.ok || !result.value) {
    return NextResponse.json(
      { error: result.errors.join('; '), errors: result.errors },
      { status: 400 },
    );
  }
  await setOrgRoiDefault(result.value, orgId);
  auditFromSession(gate, orgId, {
    action: 'policy.change',
    resource: 'roi-settings:org-default',
    outcome: 'ok',
  });
  return NextResponse.json({ orgDefault: result.value });
}
