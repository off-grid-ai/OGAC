import { NextResponse } from 'next/server';
import { auth } from '@/auth';

// Shared authorization gates for API route handlers. Middleware already blocks unauthenticated
// requests to the console/admin surface, but these helpers add explicit, defense-in-depth checks at
// the top of each handler so a middleware misconfiguration can't silently expose an admin route.
//
// Usage:
//   const gate = await requireAdmin();
//   if (gate instanceof Response) return gate;
//   // gate is the authorized session from here on

export interface AuthzSession {
  user: { email?: string | null; name?: string | null; role?: string };
}

// Service-account bearer: automation/CI authenticates with `Authorization: Bearer $OFFGRID_ADMIN_TOKEN`
// instead of an SSO session (mirrors the middleware check). Off by default (env unset). When it
// matches we synthesize a synthetic admin session so handler code downstream is uniform.
function serviceAdmin(req?: Request): AuthzSession | null {
  const token = process.env.OFFGRID_ADMIN_TOKEN;
  if (!token || !req) return null;
  if (req.headers.get('authorization') !== `Bearer ${token}`) return null;
  return { user: { email: 'service@offgrid.local', name: 'Service Account', role: 'admin' } };
}

// Any authenticated console user. Returns the session or a 401 Response.
export async function requireUser(req?: Request): Promise<AuthzSession | NextResponse> {
  const svc = serviceAdmin(req);
  if (svc) return svc;
  const session = (await auth()) as AuthzSession | null;
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return session;
}

// Admin-only surface. Returns the session or a 403 Response for non-admins (401 when unauthenticated).
export async function requireAdmin(req?: Request): Promise<AuthzSession | NextResponse> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  if (gate.user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return gate;
}
