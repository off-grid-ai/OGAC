// Thin I/O adapter for the per-org Presidio anonymizer OPERATOR policy.
//
// SOLID seam: all the decision logic (validation, normalization, request/response shaping) is the
// PURE sibling presidio-anonymizers.ts — unit-tested with zero mocks. This file is ONLY the DB
// read/write: one row per org holding the policy JSON, self-creating its table via CREATE TABLE IF
// NOT EXISTS (mirrors presidio-recognizers.ts so it deploys over SSH with no migration step).
// Exercised by the *.integration.test.ts suite against a real Postgres; skips green with no DB.
import {
  type AnonymizerPolicy,
  DEFAULT_ANONYMIZER_POLICY,
  normalizeAnonymizerPolicy,
  stripInlineEncryptKeys,
} from '@/lib/presidio-anonymizers';

let ensurePromise: Promise<void> | null = null;
export async function ensureAnonymizerPolicySchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS presidio_anonymizer_policy (
        org_id text PRIMARY KEY,
        policy jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

interface PolicyRow {
  policy: unknown;
}

function parse(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Read the org's stored operator policy, normalized (never throws). When the org has no stored
// policy yet, return the ready-to-use BFSI default so masking works out of the box.
export async function getAnonymizerPolicy(orgId = 'default'): Promise<AnonymizerPolicy> {
  await ensureAnonymizerPolicySchema();
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(sql`
    SELECT policy FROM presidio_anonymizer_policy WHERE org_id = ${orgId};
  `);
  const rows = res.rows as unknown as PolicyRow[];
  if (!rows.length) return DEFAULT_ANONYMIZER_POLICY;
  return normalizeAnonymizerPolicy(parse(rows[0].policy));
}

// Upsert the org's operator policy. `value` is an ALREADY-VALIDATED policy (the route validates via
// validateAnonymizerPolicy before calling this). Returns the normalized, persisted policy.
export async function setAnonymizerPolicy(
  value: AnonymizerPolicy,
  orgId = 'default',
): Promise<AnonymizerPolicy> {
  await ensureAnonymizerPolicySchema();
  // NEVER persist AES key material: strip inline keys, keeping the encrypt INTENT (a keyless encrypt
  // spec resolves the org's vaulted key at call time via bindEncryptKey).
  const normalized = stripInlineEncryptKeys(normalizeAnonymizerPolicy(value));
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    INSERT INTO presidio_anonymizer_policy (org_id, policy, updated_at)
    VALUES (${orgId}, ${JSON.stringify(normalized)}::jsonb, now())
    ON CONFLICT (org_id) DO UPDATE
      SET policy = ${JSON.stringify(normalized)}::jsonb, updated_at = now();
  `);
  return normalized;
}
