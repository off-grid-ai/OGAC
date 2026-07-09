import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { getApp } from '@/lib/apps-store';
import { validateRoiSettingsInput } from '@/lib/roi';
import { computeAppRoiRow } from '@/lib/roi-reader';
import { getAppRoiOverride, setAppRoiOverride } from '@/lib/roi-settings-store';

export const dynamic = 'force-dynamic';

// ─── Per-app ROI settings + computed row ──────────────────────────────────────────────────────────
// GET  → the app's computed ROI row (real runs + cost + resolved estimates) plus its raw override.
// PUT  → set/clear the app's minutes-saved / loaded-cost-per-hour ESTIMATE override (validated).
// Admin-gated, org-scoped, thin — the calc lives in roi.ts, persistence in roi-settings-store.ts.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const [roi, override] = await Promise.all([
    computeAppRoiRow(id, orgId),
    getAppRoiOverride(id, orgId),
  ]);
  return NextResponse.json({ roi, override });
}

export async function PUT(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const result = validateRoiSettingsInput(body);
  if (!result.ok || !result.value) {
    return NextResponse.json(
      { error: result.errors.join('; '), errors: result.errors },
      { status: 400 },
    );
  }
  await setAppRoiOverride(id, result.value, orgId);
  auditFromSession(gate, orgId, {
    action: 'policy.change',
    resource: `roi-settings:${id}`,
    outcome: 'ok',
  });
  const roi = await computeAppRoiRow(id, orgId);
  return NextResponse.json({ roi, override: result.value });
}
