// Pure READ-ONLY-VIEWER policy — ZERO imports, so it's unit-testable in isolation (no Next/auth
// chain). This is the single source of truth for the read-only "viewer" role that powers the public
// live demo: a visitor may VIEW every module and admin surface but may CREATE / UPDATE / DELETE /
// TRIGGER nothing, and never sees a secret VALUE.
//
// SOLID seam: the rule lives here (pure); the adapters consume it —
//   - the edge middleware blocks mutating HTTP methods for a viewer session (the load-bearing,
//     catch-all enforcement across every /api route);
//   - `requireWriter` in authz.ts is the per-handler defense-in-depth gate;
//   - the UI reads the role to disable/annotate write controls;
//   - the secrets readers pass values through `redactSecretForViewer`.
// Enforcement is SERVER-SIDE — hiding a button is never the control.

// The read-only demo role. A session whose role resolves to this may read everything, write nothing.
export const VIEWER_ROLE = 'viewer';

// HTTP methods that MUTATE state. GET/HEAD/OPTIONS are safe reads; everything else can have an
// effect (create/update/delete + the trigger verbs POST run/publish/rotate/sync/rerun/cancel).
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Is `role` the read-only viewer role? Case-insensitive; undefined/blank ⇒ not a viewer. */
export function isViewer(role: string | null | undefined): boolean {
  return typeof role === 'string' && role.trim().toLowerCase() === VIEWER_ROLE;
}

/** Does this HTTP method mutate state (so a viewer must be blocked)? Case-insensitive. */
export function isMutatingMethod(method: string | null | undefined): boolean {
  return typeof method === 'string' && MUTATING_METHODS.has(method.trim().toUpperCase());
}

/**
 * The write decision. A role may write UNLESS it is the viewer role. Every other role (admin,
 * operator, compliance, custom roles inheriting a writable base) keeps its historic write access —
 * this is purely additive: it only ever SUBTRACTS from the viewer.
 */
export function canWrite(role: string | null | undefined): boolean {
  return !isViewer(role);
}

/**
 * Should this specific request be blocked as a read-only viewer write attempt? True only when BOTH
 * the caller is a viewer AND the method mutates. A viewer GET is allowed (read everything).
 */
export function isViewerWriteAttempt(
  role: string | null | undefined,
  method: string | null | undefined,
): boolean {
  return isViewer(role) && isMutatingMethod(method);
}

// The placeholder a viewer sees instead of a real secret value. Kept as a constant so the redaction
// is uniform everywhere and asserted against one source of truth in tests.
export const SECRET_PLACEHOLDER = '••••••••';

/**
 * Redact a secret VALUE for a viewer. When the caller is a viewer, any non-empty secret becomes the
 * fixed placeholder and any empty/absent secret stays absent (so a viewer can still tell "configured"
 * from "not configured" without seeing the value). A non-viewer gets the value untouched.
 *
 * Pure — the CALLER decides `viewer` (from the resolved session role) and passes it in.
 */
export function redactSecretForViewer(
  value: string | null | undefined,
  viewer: boolean,
): string | null | undefined {
  if (!viewer) return value;
  if (value == null || value === '') return value;
  return SECRET_PLACEHOLDER;
}

// The 403 body returned when a viewer attempts a write. One shape, one source of truth.
export const VIEWER_FORBIDDEN_BODY = {
  error: 'forbidden',
  reason: 'read-only demo: this account can view everything but cannot make changes',
} as const;

// The three terminal decisions a gate can reach for an already-authenticated principal. The impure
// gates (authz.ts) translate these into an HTTP response; keeping the DECISION pure means the whole
// security rule is unit-testable without the auth/Next chain.
export type GateDecision = 'allow' | 'forbid-viewer-write' | 'forbid';

/**
 * The WRITER gate decision (requireWriter): any authenticated principal may proceed UNLESS it is a
 * viewer, who is forbidden. Pure — role in, decision out.
 */
export function decideWriterGate(role: string | null | undefined): GateDecision {
  return canWrite(role) ? 'allow' : 'forbid-viewer-write';
}

/**
 * The ADMIN gate decision (requireAdmin): an admin always proceeds; a viewer proceeds ONLY on a safe
 * (non-mutating) method so it can view the admin plane but never mutate it; every other role is
 * forbidden. Pure — role + method in, decision out.
 */
export function decideAdminGate(
  role: string | null | undefined,
  method: string | null | undefined,
): GateDecision {
  if (role === 'admin') return 'allow';
  if (isViewer(role)) return isMutatingMethod(method) ? 'forbid-viewer-write' : 'allow';
  return 'forbid';
}
