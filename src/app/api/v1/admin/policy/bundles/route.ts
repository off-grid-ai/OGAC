import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { readBundleView } from '@/lib/adapters/opa-audit';

export const dynamic = 'force-dynamic';

// Policy BUNDLES + activation status, read straight from the deployed OPA:
//   - configured remote bundles + whether decision-logs ship anywhere (GET /v1/config)
//   - per-bundle activation revision (GET /v1/status — only when the status plugin is enabled)
//   - the Rego modules actually loaded (GET /v1/policies) — the honest "active policy set" on a
//     deployment that loads policy via the policy API rather than a signed remote bundle.
//
// Read-only by design: bundle activation is deploy-owned on this OPA (no remote bundle configured,
// status plugin off), so the surface reports the truth rather than faking a reload button. Pushing
// compiled rules to OPA remains the existing /api/v1/admin/policy/push action.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const view = await readBundleView();
  return NextResponse.json(view);
}
