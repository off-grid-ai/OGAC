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
  spliceCredential,
  parseObjectStoreCredential,
  serializeObjectStoreCredential,
  validateObjectStoreCredentialPatch,
  type ConnectorFamily,
  type ConnectorTypeDef,
  type ConnectorCreateInput,
  type NormalizedConnectorCreate,
  type CreateValidation,
  type ObjectStoreCredential,
  type S3ConnectorInput,
} from './connector-policy';

export { connectorSecretKey } from './connector-secret-policy';

// Re-export the inverse (URL → {sanitized endpoint, secret}) pure helper so the update route has ONE
// import site for the connector-credential seam (mirrors the connector-policy re-export above).
export { splitEndpointSecret, endpointHasEmbeddedSecret, type SplitEndpoint } from './connector-endpoint';

import { connectorSecretKey } from './connector-secret-policy';

export const LEGACY_CONNECTOR_SECRET_REMEDIATION =
  'This source uses a legacy unscoped credential. An operator must migrate it into the tenant vault namespace before the source can be used.';

export class ConnectorSecretScopeError extends Error {
  constructor() {
    super(LEGACY_CONNECTOR_SECRET_REMEDIATION);
    this.name = 'ConnectorSecretScopeError';
  }
}

// ─── Write / read / remove the connector's secret via OpenBao ──────────────────
// Write the secret value to the vault under the connector's key and stamp `secret_ref` on the row.
// Returns the secretRef stored. No-op (returns null) when there's no secret to store.
export async function persistConnectorSecret(
  id: string,
  orgId: string,
  secret: string | null,
): Promise<string | null> {
  await ensureConnectorSecretRefColumn();
  if (!secret) return null;
  const key = connectorSecretKey(id, orgId);
  const { openBaoSecrets } = await import('@/lib/adapters/secrets');
  if (!openBaoSecrets.set) throw new Error('secrets backend is not writable');
  await openBaoSecrets.set(key, secret);
  if (!(await setConnectorSecretRef(id, orgId, key))) {
    if (openBaoSecrets.remove) await openBaoSecrets.remove(key).catch(() => undefined);
    throw new Error('connector was not found in this tenant');
  }
  return key;
}

// Resolve a connector's stored secret from the vault by its secret_ref. Returns null when the
// connector has no secretRef or the vault is unreachable (caller falls back to inline creds).
export async function resolveConnectorSecret(id: string, orgId: string): Promise<string | null> {
  const ref = await getConnectorSecretRef(id, orgId);
  if (!ref) return null;
  if (ref !== connectorSecretKey(id, orgId)) throw new ConnectorSecretScopeError();
  try {
    const { openBaoSecrets } = await import('@/lib/adapters/secrets');
    return (await openBaoSecrets.get(ref)) ?? null;
  } catch {
    return null;
  }
}

// Best-effort delete of a connector's vault secret (called on connector delete). Never throws.
export async function removeConnectorSecret(id: string, orgId: string): Promise<void> {
  const ref = await getConnectorSecretRef(id, orgId).catch(() => null);
  if (!ref) return;
  if (ref !== connectorSecretKey(id, orgId)) throw new ConnectorSecretScopeError();
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

async function setConnectorSecretRef(id: string, orgId: string, ref: string): Promise<boolean> {
  await ensureConnectorSecretRefColumn();
  const { db } = await import('@/db');
  const { connectors } = await import('@/db/schema');
  const { and, eq } = await import('drizzle-orm');
  const rows = await db
    .update(connectors)
    .set({ secretRef: ref })
    .where(and(eq(connectors.id, id), eq(connectors.orgId, orgId)))
    .returning({ id: connectors.id });
  return rows.length === 1;
}

export async function getConnectorSecretRef(id: string, orgId: string): Promise<string | null> {
  await ensureConnectorSecretRefColumn();
  const { db } = await import('@/db');
  const { connectors } = await import('@/db/schema');
  const { and, eq } = await import('drizzle-orm');
  const rows = await db
    .select({ secretRef: connectors.secretRef })
    .from(connectors)
    .where(and(eq(connectors.id, id), eq(connectors.orgId, orgId)))
    .limit(1);
  return rows[0]?.secretRef ?? null;
}
