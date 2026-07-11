// ─── Webhook triggers — registry + vaulted secret + replay-nonce store (I/O half) ────────────────
//
// The PURE auth decision (HMAC verify, window, target-kind) lives in webhook-trigger-policy.ts. This
// module owns the I/O: the `webhook_triggers` table (per-tenant token → target app/agent), the
// per-trigger signing secret in OpenBao (only a secret_ref is stored in the row — never plaintext,
// mirroring connector-secrets.ts), and a short-TTL `webhook_nonces` table that makes a captured
// request single-use within the signature window. Secret generation uses crypto random here (I/O-ish),
// so it's out of the pure module. Admin reads/writes are org-scoped; the public route looks a trigger
// up by its opaque token (the token is the lookup key, the HMAC is the actual auth).

import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';
import { isWebhookTargetKind, type WebhookTargetKind } from '@/lib/webhook-trigger-policy';

export interface WebhookTrigger {
  id: string;
  token: string;
  orgId: string;
  targetKind: WebhookTargetKind;
  targetId: string;
  label: string;
  enabled: boolean;
  createdAt: string;
  lastFiredAt: string | null;
}

interface Row {
  id: string;
  token: string;
  org_id: string;
  target_kind: string;
  target_id: string;
  label: string;
  enabled: boolean;
  created_at: string | Date;
  last_fired_at: string | Date | null;
}

function rowToTrigger(r: Row): WebhookTrigger {
  return {
    id: r.id,
    token: r.token,
    orgId: r.org_id,
    targetKind: (isWebhookTargetKind(r.target_kind) ? r.target_kind : 'app'),
    targetId: r.target_id,
    label: r.label,
    enabled: r.enabled,
    createdAt: new Date(r.created_at).toISOString(),
    lastFiredAt: r.last_fired_at ? new Date(r.last_fired_at).toISOString() : null,
  };
}

let ensurePromise: Promise<void> | null = null;
export function ensureWebhookTriggerSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS webhook_triggers (
        id text PRIMARY KEY,
        token text NOT NULL UNIQUE,
        org_id text NOT NULL DEFAULT 'default',
        target_kind text NOT NULL,
        target_id text NOT NULL,
        label text NOT NULL DEFAULT '',
        secret_ref text,
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_fired_at timestamptz);
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS webhook_triggers_org_idx ON webhook_triggers (org_id);`);
    // Replay defence: each accepted signature is claimed once; a duplicate within the window is a replay.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS webhook_nonces (
        nonce text PRIMARY KEY,
        seen_at timestamptz NOT NULL DEFAULT now());
    `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

// ─── secret in the vault (only a ref in the row) ──────────────────────────────
function webhookSecretKey(id: string): string {
  return `webhook/${id}`;
}

async function persistSecret(id: string, secret: string): Promise<string> {
  const key = webhookSecretKey(id);
  const { openBaoSecrets } = await import('@/lib/adapters/secrets');
  if (!openBaoSecrets.set) throw new Error('secrets backend is not writable');
  await openBaoSecrets.set(key, secret);
  return key;
}

/** Resolve a trigger's signing secret from the vault by token. Null if unknown/disabled/unreachable. */
export async function resolveWebhookSecret(token: string): Promise<string | null> {
  await ensureWebhookTriggerSchema();
  const res = await db.execute(
    sql`SELECT secret_ref FROM webhook_triggers WHERE token = ${token} AND enabled = true LIMIT 1`,
  );
  const ref = (res.rows as unknown as { secret_ref: string | null }[])[0]?.secret_ref;
  if (!ref) return null;
  try {
    const { openBaoSecrets } = await import('@/lib/adapters/secrets');
    return (await openBaoSecrets.get(ref)) ?? null;
  } catch {
    return null;
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────
export interface CreateWebhookTriggerInput {
  orgId: string;
  targetKind: WebhookTargetKind;
  targetId: string;
  label?: string;
}

/** Create a trigger + mint its secret (returned ONCE — never persisted in plaintext). */
export async function createWebhookTrigger(
  input: CreateWebhookTriggerInput,
): Promise<{ trigger: WebhookTrigger; secret: string }> {
  await ensureWebhookTriggerSchema();
  const id = `whk_${randomUUID().slice(0, 8)}`;
  const token = `wht_${randomBytes(18).toString('base64url')}`;
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  const orgId = input.orgId || DEFAULT_ORG;
  const secretRef = await persistSecret(id, secret);
  await db.execute(sql`
    INSERT INTO webhook_triggers (id, token, org_id, target_kind, target_id, label, secret_ref, enabled)
    VALUES (${id}, ${token}, ${orgId}, ${input.targetKind}, ${input.targetId}, ${input.label ?? ''}, ${secretRef}, true)
  `);
  const [row] = (await db.execute(
    sql`SELECT id, token, org_id, target_kind, target_id, label, enabled, created_at, last_fired_at FROM webhook_triggers WHERE id = ${id}`,
  )).rows as unknown as Row[];
  return { trigger: rowToTrigger(row), secret };
}

export async function listWebhookTriggers(orgId: string): Promise<WebhookTrigger[]> {
  await ensureWebhookTriggerSchema();
  const res = await db.execute(sql`
    SELECT id, token, org_id, target_kind, target_id, label, enabled, created_at, last_fired_at
    FROM webhook_triggers WHERE org_id = ${orgId || DEFAULT_ORG} ORDER BY created_at DESC
  `);
  return (res.rows as unknown as Row[]).map(rowToTrigger);
}

/** Public-path lookup by token — returns the row (carrying its org) or null. NOT org-scoped by caller. */
export async function getWebhookTriggerByToken(token: string): Promise<WebhookTrigger | null> {
  await ensureWebhookTriggerSchema();
  const res = await db.execute(sql`
    SELECT id, token, org_id, target_kind, target_id, label, enabled, created_at, last_fired_at
    FROM webhook_triggers WHERE token = ${token} LIMIT 1
  `);
  const row = (res.rows as unknown as Row[])[0];
  return row ? rowToTrigger(row) : null;
}

export async function setWebhookTriggerEnabled(
  id: string,
  orgId: string,
  enabled: boolean,
): Promise<boolean> {
  await ensureWebhookTriggerSchema();
  const res = await db.execute(sql`
    UPDATE webhook_triggers SET enabled = ${enabled}
    WHERE id = ${id} AND org_id = ${orgId || DEFAULT_ORG}
  `);
  return (res.rowCount ?? 0) > 0;
}

/** Rotate the signing secret (org-scoped). Returns the new secret ONCE, or null if not found. */
export async function rotateWebhookSecret(id: string, orgId: string): Promise<string | null> {
  await ensureWebhookTriggerSchema();
  const owned = await db.execute(sql`
    SELECT id FROM webhook_triggers WHERE id = ${id} AND org_id = ${orgId || DEFAULT_ORG} LIMIT 1
  `);
  if ((owned.rows as unknown[]).length === 0) return null;
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  const ref = await persistSecret(id, secret);
  await db.execute(sql`UPDATE webhook_triggers SET secret_ref = ${ref} WHERE id = ${id}`);
  return secret;
}

export async function deleteWebhookTrigger(id: string, orgId: string): Promise<boolean> {
  await ensureWebhookTriggerSchema();
  const res = await db.execute(sql`
    DELETE FROM webhook_triggers WHERE id = ${id} AND org_id = ${orgId || DEFAULT_ORG}
  `);
  if ((res.rowCount ?? 0) > 0) {
    try {
      const { openBaoSecrets } = await import('@/lib/adapters/secrets');
      if (openBaoSecrets.remove) await openBaoSecrets.remove(webhookSecretKey(id));
    } catch {
      /* best-effort vault cleanup */
    }
    return true;
  }
  return false;
}

export async function markWebhookFired(token: string): Promise<void> {
  await ensureWebhookTriggerSchema();
  await db
    .execute(sql`UPDATE webhook_triggers SET last_fired_at = now() WHERE token = ${token}`)
    .catch(() => {});
}

/**
 * Claim a nonce (the accepted signature) exactly once. Returns true if fresh (first time seen), false
 * if it's a replay. Opportunistically prunes entries older than the window so the table stays small.
 */
export async function claimWebhookNonce(nonce: string, windowSec = 300): Promise<boolean> {
  await ensureWebhookTriggerSchema();
  await db
    .execute(sql`DELETE FROM webhook_nonces WHERE seen_at < now() - (${windowSec} * interval '1 second')`)
    .catch(() => {});
  const res = await db.execute(
    sql`INSERT INTO webhook_nonces (nonce) VALUES (${nonce}) ON CONFLICT (nonce) DO NOTHING`,
  );
  return (res.rowCount ?? 0) > 0;
}
