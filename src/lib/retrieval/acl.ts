// PURE permissions-aware-retrieval policy — ZERO imports, ZERO I/O, unit-testable in isolation
// (mirrors tenancy-policy.ts and retrieval/query.ts). This is the single source of truth for
// "may this asker SEE this document?". The retrieval adapters (brain.ts / qdrant.ts) call these
// and never re-implement the rule.
//
// The vision promise this closes: "permissions-aware retrieval — answers only cite what the asker
// is allowed to see." Retrieval was PROJECT-scoped; this makes it DOCUMENT-scoped by binding a
// per-document ACL into the metadata filter (and a post-filter fallback for backends that can't
// filter server-side).
//
// Design invariants:
//  - BACKWARD COMPATIBLE: a document with NO ACL metadata stays visible exactly as today, so
//    existing corpora don't vanish. Enforcement engages only when ACL fields are present.
//  - DEFAULT-SAFE where an ACL IS present: the asker must satisfy at least one grant
//    (owner / allowed_subject / allowed_role), otherwise the document is hidden.

// ── The asker identity ───────────────────────────────────────────────────────
// Sourced from the existing tenancy/authz context (email from the session/JWT, roles from the
// resolved role + Keycloak realm roles). Kept as a plain data bag so the rule stays pure.
export interface Asker {
  /** The asker's identity (email or subject id). Empty/undefined for anonymous. */
  subject?: string | null;
  /** The asker's roles (console role + any realm roles). Case-insensitive on compare. */
  roles?: readonly string[];
}

// ── The per-document ACL (a subset of the doc payload / metadata) ──────────────
// All fields OPTIONAL. A payload with none of them is "un-ACL'd" → visible to everyone (today's
// behaviour). Presence of ANY field turns on enforcement for that document.
export interface DocAcl {
  /** The document owner's identity (email/subject). Always sees their own doc. */
  owner?: string | null;
  /** Roles allowed to see the doc (e.g. ['claims', 'admin']). */
  allowed_roles?: readonly string[] | null;
  /** Explicit subjects (emails/ids) allowed to see the doc, beyond the owner. */
  allowed_subjects?: readonly string[] | null;
  /** Data classification. Informational for filtering/audit; does not by itself grant/deny. */
  data_class?: string | null;
}

/** The payload keys the ACL occupies — exported so the filter-builder and ingest agree on names. */
export const ACL_FIELDS = {
  owner: 'owner',
  allowedRoles: 'allowed_roles',
  allowedSubjects: 'allowed_subjects',
  dataClass: 'data_class',
} as const;

// A role that always sees everything — the operator/admin break-glass. Kept small and explicit.
const SUPERUSER_ROLES = new Set(['admin']);

function norm(s: unknown): string {
  return typeof s === 'string' ? s.trim().toLowerCase() : '';
}

function normSet(xs: unknown): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(xs)) for (const x of xs) { const n = norm(x); if (n) out.add(n); }
  return out;
}

/**
 * PURE: does this ACL carry ANY access-control signal? If not, the document is un-ACL'd and the
 * legacy "visible to everyone" behaviour applies. (data_class alone is NOT a grant/deny signal, so
 * it does not by itself flip enforcement on — only owner / allowed_roles / allowed_subjects do.)
 */
export function aclIsEnforced(acl: DocAcl | null | undefined): boolean {
  if (!acl) return false;
  if (norm(acl.owner)) return true;
  if (normSet(acl.allowed_roles).size > 0) return true;
  if (normSet(acl.allowed_subjects).size > 0) return true;
  return false;
}

/**
 * PURE, the core rule: may `asker` SEE the document described by `acl`?
 *
 *  - No enforced ACL            → true  (backward compatible; un-ACL'd docs stay visible)
 *  - asker has a superuser role → true  (admin break-glass)
 *  - asker is the owner         → true
 *  - asker's subject ∈ allowed_subjects → true
 *  - asker has a role ∈ allowed_roles   → true
 *  - otherwise                  → false (default-safe: an enforced ACL the asker doesn't satisfy
 *                                        hides the doc — even if it's in their project)
 *
 * Never throws; missing/blank fields degrade to "no grant from that field".
 */
export function docVisibleTo(asker: Asker | null | undefined, acl: DocAcl | null | undefined): boolean {
  if (!aclIsEnforced(acl)) return true;
  const roles = normSet(asker?.roles);
  for (const r of roles) if (SUPERUSER_ROLES.has(r)) return true;

  const subject = norm(asker?.subject);
  if (subject && subject === norm(acl!.owner)) return true;

  const allowedSubjects = normSet(acl!.allowed_subjects);
  if (subject && allowedSubjects.has(subject)) return true;

  const allowedRoles = normSet(acl!.allowed_roles);
  for (const r of roles) if (allowedRoles.has(r)) return true;

  return false;
}

/**
 * PURE adapter: build an Asker from the console's session/JWT shape (email + resolved role, plus any
 * extra realm roles). Zero-import so it stays testable; the route handlers feed the real session in.
 * A missing email → anonymous (subject undefined); enforced docs then only match by role.
 */
export function askerFrom(
  identity: { email?: string | null; role?: string | null; realmRoles?: readonly string[] | null } | null | undefined,
): Asker {
  const roles = new Set<string>();
  if (identity?.role) roles.add(identity.role);
  for (const r of identity?.realmRoles ?? []) if (typeof r === 'string' && r) roles.add(r);
  return { subject: identity?.email ?? undefined, roles: [...roles] };
}

/**
 * PURE: coerce arbitrary request-body input into a DocAcl, or null when it carries no ACL signal.
 * Never throws. Unknown keys are ignored; blank owner/data_class and empty arrays are dropped so a
 * "{}" or all-empty ACL round-trips to null (→ un-ACL'd, backward compatible). Mirrors
 * normalizeFilter's degrade-gracefully contract.
 */
export function normalizeAcl(input: unknown): DocAcl | null {
  if (typeof input !== 'object' || input === null) return null;
  const r = input as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const arr = (v: unknown): string[] | null => {
    if (!Array.isArray(v)) return null;
    const out = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
    return out.length > 0 ? out : null;
  };
  const acl: DocAcl = {
    owner: str(r[ACL_FIELDS.owner]),
    allowed_roles: arr(r[ACL_FIELDS.allowedRoles]),
    allowed_subjects: arr(r[ACL_FIELDS.allowedSubjects]),
    data_class: str(r[ACL_FIELDS.dataClass]),
  };
  // Return null unless SOMETHING is set (so an empty object doesn't fabricate an enforced-but-empty
  // ACL). data_class alone is allowed to ride along (metadata), but doesn't by itself enforce.
  if (!acl.owner && !acl.allowed_roles && !acl.allowed_subjects && !acl.data_class) return null;
  return acl;
}

/** PURE: extract a DocAcl from an arbitrary document payload (Qdrant payload / LanceDB row). */
export function aclFromPayload(payload: Record<string, unknown> | null | undefined): DocAcl {
  const p = payload ?? {};
  const asStrArr = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  return {
    owner: typeof p[ACL_FIELDS.owner] === 'string' ? (p[ACL_FIELDS.owner] as string) : null,
    allowed_roles: asStrArr(p[ACL_FIELDS.allowedRoles]),
    allowed_subjects: asStrArr(p[ACL_FIELDS.allowedSubjects]),
    data_class: typeof p[ACL_FIELDS.dataClass] === 'string' ? (p[ACL_FIELDS.dataClass] as string) : null,
  };
}

/**
 * PURE: post-filter a list of hits by ACL. The universal fallback used by backends that cannot
 * express the ACL predicate server-side (and as a defence-in-depth pass on those that can). Each
 * hit must expose its own ACL via `getAcl`. Order and shape of surviving hits are preserved.
 */
export function filterHitsByAcl<H>(
  asker: Asker | null | undefined,
  hits: readonly H[],
  getAcl: (hit: H) => DocAcl | null | undefined,
): H[] {
  return hits.filter((h) => docVisibleTo(asker, getAcl(h)));
}
