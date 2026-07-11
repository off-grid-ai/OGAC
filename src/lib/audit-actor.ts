// Thin I/O adapter that recovers the acting principal from a request/session and hands it to the
// PURE actorFrom() mapping (audit-event.ts). This is the impure seam — it reads the NextAuth session
// and the Authorization bearer via the existing authz gate — kept deliberately tiny so the mapping
// stays unit-testable without an auth chain.
import { type Actor, type AuditEventInput, actorFrom } from '@/lib/audit-event';
import { type AuthzSession, requireUser } from '@/lib/authz';
import { recordAudit } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export interface ResolvedActor {
  actor: Actor;
  org: string;
  ip?: string;
}

// Best-effort client IP from the standard proxy headers (Cloudflare / x-forwarded-for). Never throws.
export function ipFromRequest(req?: Request): string | undefined {
  const h = req?.headers;
  if (!h) return undefined;
  const cf = h.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || undefined;
  const real = h.get('x-real-ip');
  return real ? real.trim() : undefined;
}

// Derive the canonical Actor from an already-gated AuthzSession (the shape requireUser/requireAdmin
// return on success). Exposed so route handlers that already hold `gate` don't re-read the session.
export function actorFromSession(s: AuthzSession): Actor {
  return actorFrom(principalFromSession(s));
}

// Fire-and-forget audit for an admin/governance ROUTE that already holds its `gate` (AuthzSession)
// and knows the org. Fills actor + org from the session, merges the producer's action/resource/etc,
// and records via the store (Postgres + OpenSearch). Never throws — audit must not fail the write.
export function auditFromSession(
  gate: AuthzSession,
  org: string,
  rest: Omit<AuditEventInput, 'actor' | 'org'>,
): void {
  recordAudit({ actor: actorFromSession(gate), org, ...rest });
}

// Map an authz session (which folds both cookie sessions and verified service-account JWTs into one
// { user: {email,name,role} } shape — a service account's `email`/`name` is its clientId) onto a
// principal for actorFrom. A service account carries role but its email==clientId; we treat any
// principal whose email looks like a service-account id (no '@') as a machine by passing clientId.
function principalFromSession(s: AuthzSession): Parameters<typeof actorFrom>[0] {
  const email = s.user.email ?? undefined;
  const looksMachine = !!email && !email.includes('@');
  return {
    email: looksMachine ? null : email,
    name: s.user.name ?? undefined,
    clientId: looksMachine ? email : undefined,
    role: s.user.role,
  };
}

// Resolve the actor + org (+ ip) for the current request. Returns null when unauthenticated (the
// caller has already gated the request, so this only runs on authorized paths; a null just means
// "don't attribute"). Best-effort — never throws; swallows to an unknown actor rather than failing
// the action being audited.
export async function resolveActor(req?: Request): Promise<ResolvedActor | null> {
  try {
    const gate = await requireUser(req);
    // requireUser returns a NextResponse on failure — detect via the absence of a user field.
    if (!('user' in gate)) return null;
    const session = gate as AuthzSession;
    const [org] = await Promise.all([currentOrgId()]);
    return {
      actor: actorFrom(principalFromSession(session)),
      org,
      ip: ipFromRequest(req),
    };
  } catch {
    return null;
  }
}
