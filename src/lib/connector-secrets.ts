// Connector credentials — I/O half: write/read/remove the secret in OpenBao and the additive
// secret_ref column. The PURE deciding half (catalog, validation, credential-free endpoint builder,
// secret splice) lives in connector-policy.ts (zero-import, client-safe). This module imports the
// server-only DB + secrets adapters, so it must NOT be pulled into a client bundle — the Add-connector
// form imports connector-policy.ts directly for that reason.
//
// THE PROBLEM THIS FIXES: the old create path could only get creds into a connector by pasting them
// into the endpoint URL (`mssql://sa:PASS@host`) — a plaintext password in the DB. Here the password/
// token goes to the vault under a per-connector key; the row stores only the secretRef. Mirrors the
// existing exporter secretRef pattern (openBaoSecrets.set/get/remove). Creds are re-injected at query
// time by connector-exec.ts.

// Re-export the pure API so existing importers (the POST route, tests) can keep importing from here.
export {
  CONNECTOR_TYPES,
  connectorTypeDef,
  isCreatableType,
  buildSqlEndpoint,
  validateConnectorCreate,
  connectorSecretKey,
  spliceCredential,
  type ConnectorFamily,
  type ConnectorTypeDef,
  type ConnectorCreateInput,
  type NormalizedConnectorCreate,
  type CreateValidation,
} from './connector-policy';

import { connectorSecretKey } from './connector-policy';

// ─── Write / read / remove the connector's secret via OpenBao ──────────────────
// Write the secret value to the vault under the connector's key and stamp `secret_ref` on the row.
// Returns the secretRef stored. No-op (returns null) when there's no secret to store.
export async function persistConnectorSecret(id: string, secret: string | null): Promise<string | null> {
  await ensureConnectorSecretRefColumn();
  if (!secret) return null;
  const key = connectorSecretKey(id);
  const { openBaoSecrets } = await import('@/lib/adapters/secrets');
  if (!openBaoSecrets.set) throw new Error('secrets backend is not writable');
  await openBaoSecrets.set(key, secret);
  await setConnectorSecretRef(id, key);
  return key;
}

// Resolve a connector's stored secret from the vault by its secret_ref. Returns null when the
// connector has no secretRef or the vault is unreachable (caller falls back to inline creds).
export async function resolveConnectorSecret(id: string): Promise<string | null> {
  const ref = await getConnectorSecretRef(id);
  if (!ref) return null;
  try {
    const { openBaoSecrets } = await import('@/lib/adapters/secrets');
    return (await openBaoSecrets.get(ref)) ?? null;
  } catch {
    return null;
  }
}

// Best-effort delete of a connector's vault secret (called on connector delete). Never throws.
export async function removeConnectorSecret(id: string): Promise<void> {
  const ref = await getConnectorSecretRef(id).catch(() => null);
  if (!ref) return;
  try {
    const { openBaoSecrets } = await import('@/lib/adapters/secrets');
    if (openBaoSecrets.remove) await openBaoSecrets.remove(ref);
  } catch {
    /* best-effort */
  }
}

// ─── The additive secret_ref column (self-migrating, memoized) ──────────────────
// store.ts owns `ensureOrgSchema`; this module owns the ADDITIVE secret_ref column so it can be
// added without editing store.ts. ALTER … ADD COLUMN IF NOT EXISTS is safe on the live server
// (no drizzle-kit push needed). Memoized like the other ensure* helpers.
let colEnsure: Promise<void> | null = null;
export async function ensureConnectorSecretRefColumn(): Promise<void> {
  if (colEnsure) return colEnsure;
  colEnsure = (async (): Promise<void> => {
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`ALTER TABLE connectors ADD COLUMN IF NOT EXISTS secret_ref text;`);
  })().catch((e) => {
    colEnsure = null;
    throw e;
  });
  return colEnsure;
}

async function setConnectorSecretRef(id: string, ref: string): Promise<void> {
  await ensureConnectorSecretRefColumn();
  const { db } = await import('@/db');
  const { connectors } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  await db.update(connectors).set({ secretRef: ref }).where(eq(connectors.id, id));
}

export async function getConnectorSecretRef(id: string): Promise<string | null> {
  await ensureConnectorSecretRefColumn();
  const { db } = await import('@/db');
  const { connectors } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  const rows = await db
    .select({ secretRef: connectors.secretRef })
    .from(connectors)
    .where(eq(connectors.id, id))
    .limit(1);
  return rows[0]?.secretRef ?? null;
}
