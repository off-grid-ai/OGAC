import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { listAppRunsView } from '@/lib/app-runs-view-reader';

export const dynamic = 'force-dynamic';

// ─── App-runs LIST route (Builder Epic Phase 4A) ──────────────────────────────────────────────────
// GET /api/v1/admin/app-runs?appId=<id>&limit=<n> → recent app-runs in the caller's org, newest
// first, optionally filtered to one app. This is the operator's entry to the RUNNING (screen 3) +
// REVIEW (screen 4) surfaces: pick a run to watch or a paused run to decide on. Deliberately a NEW
// route (not /apps/[id]/runs) so it never collides with the Phase 3A apps/[id] routes.
//
// SOLID: thin handler — auth, org, delegate to the pure-shaped read helper in app-runs-view.ts.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const orgId = await currentOrgId();
  const url = new URL(req.url);
  const appId = url.searchParams.get('appId') ?? undefined;
  const limitRaw = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;

  const data = await listAppRunsView(appId, orgId, limit);
  return NextResponse.json({ object: 'list', data });
}
