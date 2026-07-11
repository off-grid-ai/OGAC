import { NextResponse } from 'next/server';
import { normalizeControls, type BlastRadiusControls } from '@/lib/app-run-controls';
import {
  deleteControls,
  getControls,
  upsertControls,
  usageFor,
} from '@/lib/app-run-controls-store';
import { getApp } from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── App run-controls route — SHADOW MODE + BLAST-RADIUS dials (full CRUD) ─────────────────────────
// GET    → the app's controls (or DEFAULT_CONTROLS) + live usage (runs-today, spend-today).
// PATCH  → set/patch the dials (enabled/shadowDefault/maxRunsPerDay/spendCapUsd/spendCapScope).
// DELETE → clear the controls → the app reverts to DEFAULT_CONTROLS (enabled, live, no caps).
// SOLID: thin handler — auth, org, load the app (404), delegate to the pure normalizer + the store.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const [controls, usage] = await Promise.all([getControls(id, orgId), usageFor(id, orgId, 0)]);
  return NextResponse.json({ object: 'app_run_controls', appId: id, controls, usage });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Partial<BlastRadiusControls>;
  // The pure normalizer coerces the untrusted patch (negative caps → null, bad scope → 'day', etc.).
  const patch = normalizeControls(body);
  const controls = await upsertControls(id, orgId, patch);

  auditFromSession(gate, orgId, {
    action: 'app.controls.update',
    resource: `app:${id} enabled:${controls.enabled} shadow:${controls.shadowDefault} runs/day:${
      controls.maxRunsPerDay ?? '∞'
    } spend:${controls.spendCapUsd ?? '∞'}/${controls.spendCapScope}`,
    outcome: 'ok',
  });
  return NextResponse.json({ object: 'app_run_controls', appId: id, controls });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await deleteControls(id, orgId);
  auditFromSession(gate, orgId, {
    action: 'app.controls.delete',
    resource: `app:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ object: 'app_run_controls', appId: id, deleted: true });
}
