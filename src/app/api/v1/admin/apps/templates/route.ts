import { NextResponse } from 'next/server';
import { listTemplates } from '@/lib/apps-store';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── GET /api/v1/admin/apps/templates — the org SOP / workflow-template library ────────────────────
// Lists every template visible to the caller's org: their org's org-visible templates + all public
// templates from any org (cross-team adoption). Thin — the visibility rule lives in listTemplates.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  return NextResponse.json({ object: 'list', data: await listTemplates(orgId) });
}
