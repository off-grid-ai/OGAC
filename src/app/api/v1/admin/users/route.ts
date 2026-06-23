import { NextResponse } from 'next/server';
import { listUsers } from '@/lib/store';

// Console users and their RBAC roles (populated by SSO sign-ins).
export async function GET() {
  return NextResponse.json({ object: 'list', data: await listUsers() });
}
