import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { machineConsoleRole } from '@/lib/auth/machine-roles';
import { canWrite, isMutatingMethod, isViewer, VIEWER_FORBIDDEN_BODY } from '@/lib/viewer-policy';

// Shared authorization gates for API route handlers. There is ONE key flow: a machine
// presents a Keycloak service-account JWT as `Authorization: Bearer <jwt>` and it is
// validated through the IdentityVerifier seam — the same abstraction the gateway uses.
// Humans authenticate with a console session (cookie). A static break-glass token
// (OFFGRID_ADMIN_TOKEN) is honored ONLY if explicitly set, for bootstrap/CI.
//
// Usage:
//   const gate = await requireUser(req);
//   if (gate instanceof Response) return gate;   // gate is the authorized session

export interface AuthzSession {
  user: { email?: string | null; name?: string | null; role?: string };
}

function bearer(req?: Request): string {
  const h = req?.headers.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

// Break-glass: a static token, only when OFFGRID_ADMIN_TOKEN is set. Synthesizes an
// admin session so downstream handler code stays uniform. Prefer the key flow below.
function breakGlass(token: string): AuthzSession | null {
  const t = process.env.OFFGRID_ADMIN_TOKEN;
  if (!t || token !== t) return null;
  return { user: { email: 'service@offgrid.local', name: 'Service Account', role: 'admin' } };
}

// The canonical key flow: verify a Keycloak service-account (or user) JWT via the seam.
async function fromToken(token: string): Promise<AuthzSession | null> {
  if (!token) return null;
  // Lazy — the JWKS verifier is only needed on the bearer path, so we don't drag its module into
  // every authz call (and the session/read path stays independent of it).
  const { getTokenVerifier } = await import('@/lib/auth/token-verifier');
  const verifier = getTokenVerifier();
  if (!verifier) return null;
  const p = await verifier.verify(token);
  if (!p) return null;
  // A MACHINE principal (client_credentials — no user email, identified by clientId/azp) is authorized
  // by its Keycloak realm roles: an explicit console-capability grant (e.g. console-admin) elevates it,
  // a bare svc-<service> scope role does NOT (least-privilege — see lib/auth/machine-roles). User tokens
  // keep the role resolved from their session claims untouched.
  const role = p.kind === 'service' ? machineConsoleRole(p.realmRoles, p.role) : p.role;
  return { user: { email: p.email ?? p.clientId ?? p.subject, name: p.clientId ?? p.email ?? 'Service', role } };
}

// Any authenticated principal (session, service-account JWT, or break-glass token).
export async function requireUser(req?: Request): Promise<AuthzSession | NextResponse> {
  const token = bearer(req);
  const viaToken = (await fromToken(token)) ?? breakGlass(token);
  if (viaToken) return viaToken;
  const session = (await auth()) as AuthzSession | null;
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return session;
}

// Admin-only surface. 403 for non-admins, 401 when unauthenticated.
//
// The read-only VIEWER is the one exception: it may READ every admin surface (the public live demo
// shows the full admin plane) but never MUTATE. So a viewer passes this gate on a SAFE method
// (GET/HEAD) and is rejected 403 on any mutating method — the same read-everything / write-nothing
// rule the edge middleware enforces, applied here so a viewer's admin GETs (e.g. config reveal,
// which the middleware lets through as a read) actually reach the handler. Every OTHER non-admin
// role stays fully blocked from the admin plane, unchanged.
export async function requireAdmin(req?: Request): Promise<AuthzSession | NextResponse> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  if (gate.user.role === 'admin') return gate;
  if (isViewer(gate.user.role) && !isMutatingMethod(req?.method)) return gate;
  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}

// Any authenticated principal who is allowed to WRITE — i.e. not the read-only viewer role. This is
// the per-handler defense-in-depth for mutating handlers that only need `requireUser` (not full
// admin): a viewer is rejected 403 BEFORE any effect, alongside the edge middleware's catch-all
// method block. The write DECISION is the pure `canWrite` predicate (single source of truth); this
// gate is only the request adapter around it.
export async function requireWriter(req?: Request): Promise<AuthzSession | NextResponse> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  if (!canWrite(gate.user.role)) {
    return NextResponse.json(VIEWER_FORBIDDEN_BODY, { status: 403 });
  }
  return gate;
}
