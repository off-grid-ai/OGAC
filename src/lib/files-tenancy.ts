// Pure, zero-IO rules for TENANT-SCOPING the shared file bucket (SeaweedFS). Storage is one flat S3
// bucket shared by every surface; before scoping the Storage screen listed the WHOLE bucket, so a
// tenant saw global desktop-app junk (qwythos9b frames, todo-demo) and, worse, other tenants' files.
// We isolate a tenant's console uploads under a per-org key PREFIX (`orgs/<orgId>/…`) so the read
// can filter cheaply by S3 prefix — no per-object HEAD. Untagged legacy/global keys (no prefix) fall
// outside every org's prefix and so never surface in a tenant's list. Rules live here (unit-tested);
// the S3 I/O in files.ts applies them. See test/files-tenancy.test.ts.

const ORG_ROOT = 'orgs/';

/**
 * The key prefix a tenant's console uploads live under, or '' for the default / single-tenant org
 * (whose files stay at the bucket root, unchanged — backwards-compatible). A blank/whitespace org is
 * treated as default. The prefix always ends in '/' so `prefix + key` is a clean path and a
 * `startsWith(prefix)` test can't match a sibling org whose id is a prefix of another's.
 */
export function orgFilePrefix(orgId: string | null | undefined): string {
  const o = typeof orgId === 'string' ? orgId.trim() : '';
  return o && o !== 'default' ? `${ORG_ROOT}${o}/` : '';
}

/**
 * Does object `key` belong to org `orgId`? For a real tenant: the key must sit under that org's
 * prefix. For the default / single-tenant org (empty prefix): every key belongs (the whole bucket) —
 * this preserves the pre-tenant single-namespace behavior for non-multi-tenant deploys.
 */
export function isKeyInOrg(key: string, orgId: string | null | undefined): boolean {
  const prefix = orgFilePrefix(orgId);
  if (!prefix) return true;
  return key.startsWith(prefix);
}
