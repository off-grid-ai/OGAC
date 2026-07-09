import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { listUsers } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Console users and their RBAC roles (populated by SSO sign-ins). TENANT-SCOPED (SECURITY WAVE 1):
// returns only the caller's org — was the whole cross-tenant directory (P0).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listUsers(await currentOrgId()) });
}
