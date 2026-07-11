// PURE, zero-IO rules for the demo INFRA seed (WAVE 2, agent E) — the two seed steps agent C
// FLAGGED for the operator: (1) the Storage file BYTES into the object store (SeaweedFS/S3), and
// (2) the secret VALUES into the vault (OpenBao). Both must land UNDER the owning tenant's scope
// (`orgs/<orgId>/…` object keys · `secret/<orgId>/…` vault paths) and be IDEMPOTENT (a re-run
// overwrites the SAME target, never duplicates). The decisions live here (unit-tested); the actual
// S3 put / vault write is thin I/O in the scripts.
//
// Idempotency is the reason we DON'T reuse files.saveFile for the seed: saveFile mints a random
// `<uuid>-<name>` key, so a second run would create a SECOND object for the same demo file. We use a
// DETERMINISTIC key (`orgs/<orgId>/demo/<slug>`) instead — same content, same key, so putObject
// overwrites in place. The key still sits under the org prefix, so listFiles(orgId) / isKeyInOrg
// surface it exactly as a real tenant upload.
import type { DemoSecretSeed } from '@/lib/demo/secrets';
import { orgFilePrefix } from '@/lib/files-tenancy';

// Only these two demo tenants may ever be targeted — a hard allowlist so a mistyped org can't write
// somewhere it shouldn't (mirrors seed-guard.assertAllowed for the DB seed).
export const DEMO_ORG_IDS = ['org_bharat', 'org_suraksha'] as const;
export type DemoOrgId = (typeof DEMO_ORG_IDS)[number];

export function isDemoOrg(orgId: string): orgId is DemoOrgId {
  return (DEMO_ORG_IDS as readonly string[]).includes(orgId);
}

/** Throw unless `orgId` is one of the two demo tenants — the SAFETY guard for both infra scripts. */
export function assertDemoOrg(orgId: string): asserts orgId is DemoOrgId {
  if (!isDemoOrg(orgId)) {
    throw new Error(`refusing to seed infra for non-demo org "${orgId}" (allowed: ${DEMO_ORG_IDS.join(', ')})`);
  }
}

// Slugify a file name into a stable, path-safe segment: lowercase, non-alphanumerics → '-',
// collapse repeats, trim edges. Deterministic (same name → same slug) so the key is idempotent.
export function fileSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The DETERMINISTIC object key a demo file lands at, under the owning org's prefix. Always
 * `orgs/<orgId>/demo/<slug>` for a demo org — under the org prefix (so tenant isolation surfaces it)
 * and stable across runs (so a re-run overwrites, never duplicates). Throws for a non-demo org.
 */
export function demoFileKey(orgId: string, name: string): string {
  assertDemoOrg(orgId);
  return `${orgFilePrefix(orgId)}demo/${fileSlug(name)}`;
}

// ── Secret VALUES ──────────────────────────────────────────────────────────────────────────────
// Real secrets never live in git. The script GENERATES a realistic-but-fake value per secret at run
// time (a fake API key / DB password) and prints the `bao kv put` command that writes it. The value
// generator is injected (a `() => string`) so the pure command-builder stays deterministic + testable.

/** A fake but realistic secret value shaped by the secret's KIND, inferred from its name/path. */
export function fakeSecretValue(spec: DemoSecretSeed, rand: () => string): string {
  const token = rand();
  const looksLikeKey = /key|token|api/i.test(`${spec.name} ${spec.path}`);
  // API keys read like `sk_demo_<hex>`; passwords like `Demo!<hex>` — clearly non-real, never a real credential.
  return looksLikeKey ? `sk_demo_${token}` : `Demo!${token}`;
}

/**
 * The `bao kv put` command for one secret at its tenant-scoped path. The field key is `value` (matches
 * agent C's flag copy and the vault adapter's convention). Pure — the value is passed in, never read
 * from anywhere, so nothing real is embedded. Idempotent: `bao kv put` overwrites the path in place.
 */
export function baoPutCommand(spec: DemoSecretSeed, value: string): string {
  return `bao kv put ${spec.path} value=${value}`;
}
