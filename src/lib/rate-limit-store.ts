// ─── Rate-limit STORAGE adapter (Node-only) ──────────────────────────────────────────────────────
// The DB-backed half of the rate-limit lib. Kept out of the pure `rate-limit.ts` so the Edge
// middleware bundle never pulls Postgres. Provides:
//   - a self-migrating `rate_limit` + `token_hash` column on the existing `api_keys` table
//     (rsync deploy has no migration step → ALTER TABLE … ADD COLUMN IF NOT EXISTS, mirrors
//     ensureAppsSchema / ensureOrgSchema),
//   - set/clear a key's per-minute limit,
//   - resolve a presented Bearer/x-api-key secret → its key row + configured limit (the cleartext
//     secret is never stored; only its sha-256 fingerprint).

import { sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '@/db';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

let rlEnsure: Promise<void> | null = null;
export async function ensureRateLimitSchema(): Promise<void> {
  if (rlEnsure) return rlEnsure;
  rlEnsure = (async (): Promise<void> => {
    await db.execute(sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rate_limit integer;`);
    await db.execute(sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS token_hash text;`);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS api_keys_token_hash_idx ON api_keys (token_hash);`,
    );
    // Org/workspace default limit (fallback below a per-key limit, above the global floor). The
    // org_settings table is provisioned by store.ensureOrgSchema(); we only add our column, guarded
    // so this is a no-op if the table isn't there yet (it always is on a live deploy).
    await db
      .execute(sql`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS default_rate_limit integer;`)
      .catch(() => {});
  })().catch((e) => {
    rlEnsure = null;
    throw e;
  });
  return rlEnsure;
}

/** The org/workspace default per-minute limit, or null when unset (→ fall through to the floor). */
export async function getOrgDefaultRateLimit(): Promise<number | null> {
  await ensureRateLimitSchema();
  const res = await db.execute(
    sql`SELECT default_rate_limit FROM org_settings WHERE id = 'org' LIMIT 1;`,
  );
  return toLimit(firstRow(res)?.default_rate_limit);
}

/** Stable, non-reversible fingerprint of a secret token. Used as the stored `token_hash`. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeLimit(rateLimit: number | null | undefined): number | null {
  return typeof rateLimit === 'number' && Number.isFinite(rateLimit)
    ? Math.max(0, Math.floor(rateLimit))
    : null;
}

/**
 * Set (or clear, with null) a key's per-minute rate limit. Tenant-scoped: the UPDATE only lands when
 * the key belongs to `orgId`, so org A cannot throttle (DoS) org B's key via a guessed id — P1 IDOR.
 */
export async function setKeyRateLimit(
  id: string,
  rateLimit: number | null,
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  await ensureRateLimitSchema();
  await db.execute(
    sql`UPDATE api_keys SET rate_limit = ${normalizeLimit(
      rateLimit,
    )} WHERE id = ${id} AND org_id = ${orgId};`,
  );
}

/**
 * After store.createApiKey() has minted the row + one-time secret, persist the columns store.ts
 * doesn't know about: the secret's hash (so a presented Bearer resolves back to this key) and the
 * optional per-key rate limit. Kept here (not in store.ts) so schema.ts stays untouched.
 */
export async function finalizeKeyCreation(
  id: string,
  token: string,
  rateLimit: number | null,
): Promise<void> {
  await ensureRateLimitSchema();
  await db.execute(
    sql`UPDATE api_keys SET token_hash = ${hashToken(token)}, rate_limit = ${normalizeLimit(
      rateLimit,
    )} WHERE id = ${id};`,
  );
}

function firstRow(res: unknown): Record<string, unknown> | undefined {
  return (res as { rows?: Record<string, unknown>[] }).rows?.[0];
}

function toLimit(v: unknown): number | null {
  return typeof v === 'number' ? v : v == null ? null : Number(v);
}

/**
 * Read one key's configured per-minute rate limit (null = unset). For the admin UI. Tenant-scoped:
 * a cross-org id resolves to no row → null, so org A cannot read org B's configured limit — P1 IDOR.
 */
export async function getKeyRateLimit(id: string, orgId: string = DEFAULT_ORG): Promise<number | null> {
  await ensureRateLimitSchema();
  const res = await db.execute(
    sql`SELECT rate_limit FROM api_keys WHERE id = ${id} AND org_id = ${orgId} LIMIT 1;`,
  );
  return toLimit(firstRow(res)?.rate_limit);
}

export interface ResolvedKeyLimit {
  keyId: string;
  orgId: string;
  enabled: boolean;
  rateLimit: number | null;
}

/**
 * Resolve a presented Bearer/x-api-key secret to its key row + configured limit. Returns null when
 * the token matches no key (the caller then applies only the global floor). Node-only.
 */
export async function resolveKeyByToken(token: string): Promise<ResolvedKeyLimit | null> {
  if (!token) return null;
  await ensureRateLimitSchema();
  const hash = hashToken(token);
  return resolveKeyByHash(hash);
}

/** Resolve by a pre-computed token hash (the Edge middleware hashes the secret itself). */
export async function resolveKeyByHash(hash: string): Promise<ResolvedKeyLimit | null> {
  if (!hash) return null;
  await ensureRateLimitSchema();
  const res = await db.execute(
    sql`SELECT id, org_id, enabled, rate_limit FROM api_keys WHERE token_hash = ${hash} LIMIT 1;`,
  );
  const row = firstRow(res);
  if (!row) return null;
  return {
    keyId: String(row.id),
    orgId: String(row.org_id),
    enabled: row.enabled === true || row.enabled === 't',
    rateLimit: toLimit(row.rate_limit),
  };
}
