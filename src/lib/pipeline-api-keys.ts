// ─── Per-pipeline provisioned API keys — I/O adapter over `pipeline_api_keys` ─────────────────────
//
// A pipeline is the governed contract; this makes it CALLABLE as its own provisioned API. An admin
// mints a key on a pipeline and hands it to an app, an agent, or an external third-party; every call
// carrying it is verified back to that pipeline and then runs THROUGH the pipeline's governance
// (policy + guardrails + routing) — the key never bypasses the chokepoint.
//
// DRY with the existing local-token discipline (see provit-token.ts): only the SHA-256 HASH of the
// plaintext is stored; the plaintext (`og_pl_…`) is returned ONCE at mint time and never persisted.
// Verify hashes the presented key and looks it up — shape alone never authenticates. Revoke is a soft
// delete (revokedAt) so the audit trail survives; a revoked key fails verification immediately.
//
// The PURE format/parse/validate + telemetry shaping live in pipeline-api-key-format.ts; this file is
// the impure seam (crypto + DB). `ensurePipelineApiKeysSchema()` self-migrates (CREATE TABLE IF NOT
// EXISTS mirroring schema.ts) so it deploys over SSH before the SQL migration lands, exactly like
// ensurePipelinesSchema. Column names MUST match schema.ts (pipeline_api_keys) exactly.
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { pipelineApiKeys } from '@/db/schema';
import type { PipelineApiKey } from '@/db/schema';
import {
  type NameCheck,
  type PipelineKeyView,
  formatPipelineKey,
  looksLikePipelineKey,
  prefixOf,
  validateKeyName,
} from '@/lib/pipeline-api-key-format';

const DEFAULT_ORG = 'default';

// SHA-256, hex — the exact scheme provit-token.ts uses (DRY). The hash covers the WHOLE plaintext.
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

// ─── self-migrate safety net (memoized; mirrors ensurePipelinesSchema) ────────────────────────────
let ensurePromise: Promise<void> | null = null;
export async function ensurePipelineApiKeysSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pipeline_api_keys (
        id text PRIMARY KEY,
        pipeline_id text NOT NULL,
        org_id text NOT NULL DEFAULT 'default',
        name text NOT NULL DEFAULT '',
        hashed_key text NOT NULL,
        prefix text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by text NOT NULL DEFAULT '',
        revoked_at timestamptz);
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS pipeline_api_keys_pipeline_idx ON pipeline_api_keys (pipeline_id);`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS pipeline_api_keys_org_idx ON pipeline_api_keys (org_id);`,
    );
    // A hashed_key must be unique so verify is an exact single-row lookup + no accidental dup mints.
    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS pipeline_api_keys_hash_idx ON pipeline_api_keys (hashed_key);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

// ─── row → view (never leaks the hash) ─────────────────────────────────────────────────────────────
function iso(v: Date | string | null | undefined): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

function toView(r: PipelineApiKey): PipelineKeyView {
  return {
    id: r.id,
    pipelineId: r.pipelineId,
    name: r.name,
    prefix: r.prefix,
    active: r.revokedAt == null,
    createdAt: iso(r.createdAt),
    createdBy: r.createdBy,
    revokedAt: iso(r.revokedAt),
  };
}

// ─── mint ───────────────────────────────────────────────────────────────────────────────────────
export interface MintedKey {
  view: PipelineKeyView;
  // The `og_pl_…` plaintext — returned ONCE, never stored (only its SHA-256 hash + prefix are).
  apiKey: string;
}

// Mint a provisioned key for a pipeline. Validates the name (pure), generates a high-entropy secret,
// composes the `og_pl_<hint>_<secret>` plaintext, stores ONLY its hash + display prefix, returns the
// plaintext once. Throws on an invalid name so the route can 400.
export async function mintKey(
  pipelineId: string,
  name: string,
  orgId: string = DEFAULT_ORG,
  by: string = '',
): Promise<MintedKey> {
  const check: NameCheck = validateKeyName(name);
  if (!check.ok) throw new Error(check.error ?? 'invalid name');
  await ensurePipelineApiKeysSchema();

  const id = `plk_${randomBytes(6).toString('hex')}`;
  const secret = randomBytes(24).toString('base64url');
  const apiKey = formatPipelineKey(pipelineId, secret);

  const [row] = await db
    .insert(pipelineApiKeys)
    .values({
      id,
      pipelineId,
      orgId,
      name: check.name as string,
      hashedKey: sha256(apiKey),
      prefix: prefixOf(apiKey),
      createdBy: by,
    })
    .returning();

  return { view: toView(row), apiKey };
}

// ─── list (never returns the hash) ─────────────────────────────────────────────────────────────────
// A pipeline's keys, newest first, org-scoped. Graceful when the table is absent on a given DB.
export async function listKeys(
  pipelineId: string,
  orgId: string = DEFAULT_ORG,
): Promise<PipelineKeyView[]> {
  await ensurePipelineApiKeysSchema();
  const rows = await db
    .select()
    .from(pipelineApiKeys)
    .where(and(eq(pipelineApiKeys.pipelineId, pipelineId), eq(pipelineApiKeys.orgId, orgId)))
    .orderBy(desc(pipelineApiKeys.createdAt));
  return rows.map(toView);
}

// ─── revoke (soft delete; org-scoped) ───────────────────────────────────────────────────────────
// Sets revoked_at so the key fails verification immediately while the row stays for the audit trail.
// Returns the pipeline id the key belonged to (so the route can audit against it) or null if absent /
// wrong org / already revoked.
export async function revokeKey(
  keyId: string,
  orgId: string = DEFAULT_ORG,
): Promise<{ pipelineId: string } | null> {
  await ensurePipelineApiKeysSchema();
  const [row] = await db
    .update(pipelineApiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(pipelineApiKeys.id, keyId),
        eq(pipelineApiKeys.orgId, orgId),
        isNull(pipelineApiKeys.revokedAt),
      ),
    )
    .returning({ pipelineId: pipelineApiKeys.pipelineId });
  return row ? { pipelineId: row.pipelineId } : null;
}

// ─── verify ─────────────────────────────────────────────────────────────────────────────────────
export interface PipelineKeyBinding {
  keyId: string;
  pipelineId: string;
  orgId: string;
}

// Verify a presented plaintext key. Returns the pipeline/org binding it authenticates, or null.
// Rules: must be shaped like a pipeline key (cheap pre-check), then its SHA-256 must match a
// NON-revoked stored row. Shape alone never authenticates — the hash lookup is the real gate.
// Best-effort last-used stamping is fire-and-forget and never blocks the answer.
export async function verifyPipelineKey(plaintext: string): Promise<PipelineKeyBinding | null> {
  if (!looksLikePipelineKey(plaintext)) return null;
  await ensurePipelineApiKeysSchema();
  const rows = await db
    .select({
      id: pipelineApiKeys.id,
      pipelineId: pipelineApiKeys.pipelineId,
      orgId: pipelineApiKeys.orgId,
    })
    .from(pipelineApiKeys)
    .where(and(eq(pipelineApiKeys.hashedKey, sha256(plaintext)), isNull(pipelineApiKeys.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { keyId: row.id, pipelineId: row.pipelineId, orgId: row.orgId };
}
