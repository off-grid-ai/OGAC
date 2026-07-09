import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { listAudit } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Aggregated audit for the caller's TENANT (the DPO evidence stream). Optional ?deviceId & ?limit.
// GATED + TENANT-SCOPED (SECURITY WAVE 1): was ungated (any logged-in user) AND returned EVERY
// tenant's audit trail (P0, compliance-fatal). Now requires an authenticated principal and scopes
// the read to currentOrgId().
export async function GET(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const deviceId = url.searchParams.get('deviceId') ?? undefined;
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const orgId = await currentOrgId();
  return NextResponse.json({ object: 'list', data: await listAudit({ deviceId, limit, orgId }) });
}
