import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { listUsers } from '@/lib/store';

// Console users and their RBAC roles (populated by SSO sign-ins).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listUsers() });
}
