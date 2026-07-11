// PURE secret-namespace TENANCY logic — ZERO imports, ZERO I/O, fully unit-testable.
//
// Secrets live in one OpenBao KV mount, namespaced per tenant under an `<org>/` folder (the demo
// seed writes `secret/org_bharat/...`, `secret/org_suraksha/...`). Listing the mount ROOT returns
// every tenant's `<org>/` folder side by side — the SURFACE-2 leak, where the insurer saw the bank's
// `org_bharat/` folder. This module owns the two pure decisions that scope secrets to one tenant:
//
//   1. orgSecretPrefix(orgId)  — the key prefix a tenant's secrets live under (`<org>/`), or '' for
//      the default/single-tenant org (no namespacing → unchanged behaviour).
//   2. scopeSecretKey / unscopeSecretKey — map a tenant-relative key the UI shows (`connectors/x`)
//      to/from the absolute stored key (`org_bharat/connectors/x`), so a tenant can only ever read,
//      write, or delete WITHIN its own namespace.
//
// The adapter LISTs under the prefix (so OpenBao only returns that tenant's keys) and the route maps
// keys through here; the pure rule is the single source of truth for what "belongs to this tenant".

// The default org is not namespaced (single-tenant deploys pin one org and write bare keys). Keep it
// aligned with tenancy-policy's DEFAULT_ORG without importing it (this module stays zero-import).
const DEFAULT_ORG = 'default';

/**
 * The stored-key prefix for a tenant's secrets: `<org>/`. The default/empty org is NOT namespaced
 * (returns '') so single-tenant deploys keep writing/reading bare keys exactly as before.
 */
export function orgSecretPrefix(orgId: string | null | undefined): string {
  const org = (orgId ?? '').trim();
  if (!org || org === DEFAULT_ORG) return '';
  return `${org}/`;
}

/**
 * Map a tenant-relative key (what the UI shows / the admin types) to the absolute stored key by
 * prepending the org namespace. Idempotent: a key already carrying the prefix is returned unchanged,
 * so a caller that passes an absolute key can't double-namespace it.
 */
export function scopeSecretKey(orgId: string | null | undefined, key: string): string {
  const prefix = orgSecretPrefix(orgId);
  if (!prefix) return key;
  return key.startsWith(prefix) ? key : `${prefix}${key}`;
}

/**
 * Strip the org namespace from a stored key for display. A key OUTSIDE the tenant's namespace
 * (another tenant's, or an unexpected root key) returns null — the caller drops it, so a sibling
 * sibling org folder can never render on this tenant. The default org (no prefix) passes keys through.
 */
export function unscopeSecretKey(orgId: string | null | undefined, key: string): string | null {
  const prefix = orgSecretPrefix(orgId);
  if (!prefix) return key;
  if (!key.startsWith(prefix)) return null;
  const rel = key.slice(prefix.length);
  return rel === '' ? null : rel; // the bare `<org>/` folder marker itself is not a leaf to show
}

/**
 * Scope a raw key listing (the stored keys OpenBao returned under the tenant's prefix, or the whole
 * mount as a defensive fallback) to the tenant: keep only keys within its namespace, stripped to
 * tenant-relative form, de-duplicated. This is the terminal transform behind what the Secrets UI
 * renders — after it, a list for org A contains ONLY org A's keys, never a sibling org folder.
 */
export function scopeSecretKeyList(orgId: string | null | undefined, rawKeys: unknown): string[] {
  const arr = Array.isArray(rawKeys) ? rawKeys : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const rel = unscopeSecretKey(orgId, item);
    if (rel === null || seen.has(rel)) continue;
    seen.add(rel);
    out.push(rel);
  }
  return out;
}
