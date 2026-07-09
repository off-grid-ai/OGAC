import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { createEnrollmentToken } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Admin issues an enrollment token for a role; a node uses it once to enroll. The token is stamped
// with the issuing admin's org (SECURITY WAVE 1) so the device enrolled with it lands in that tenant.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const role = typeof body?.role === 'string' ? body.role : 'Field Advisor';
  return NextResponse.json(await createEnrollmentToken(role, await currentOrgId()), { status: 201 });
}
