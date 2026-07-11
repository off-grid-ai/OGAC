import {
  buildDynamicDbCreds,
  buildLeaseDetail,
  buildLeaseRows,
  buildSealActionView,
  buildSecretVersionsView,
  dbCredsPath,
  dbRolesPath,
  kvDeleteVersionsPath,
  kvDestroyPath,
  kvMetadataPath,
  kvUndeletePath,
  leaseLookupPath,
  type DynamicDbCreds,
  type LeaseDetail,
  type LeaseRow,
  type SealActionView,
  type SecretVersionsView,
} from '../secrets-ops';
import type { SecretsPort } from './types';

// Secrets adapters. The default reads process.env (12-factor); for production a real KMS like
// OpenBao binds here without callers changing. OpenBao's admin UI is rich, so it renders as an
// SSO'd embed rather than something we rebuild.
export const envSecrets: SecretsPort = {
  meta: {
    id: 'env',
    capability: 'secrets',
    vendor: 'Process env',
    license: 'first-party',
    render: 'headless',
    description: 'Reads secrets from the environment (12-factor). Default for dev/on-prem.',
  },
  get: (key) => Promise.resolve(process.env[key]),
  has: (key) => Promise.resolve(process.env[key] !== undefined),
};

const BAO_URL = process.env.OFFGRID_OPENBAO_URL;
const BAO_TOKEN = process.env.OFFGRID_OPENBAO_TOKEN ?? 'offgrid-dev-token';
const BAO_MOUNT = process.env.OFFGRID_OPENBAO_MOUNT ?? 'secret';

// Read a KV v2 secret: GET <url>/v1/<mount>/data/<key> → data.data.value. Falls back to env
// when OpenBao isn't reachable so the console still runs without the secrets profile up.
async function baoGet(key: string): Promise<string | undefined> {
  if (!BAO_URL) return process.env[key];
  try {
    const res = await fetch(`${BAO_URL}/v1/${BAO_MOUNT}/data/${encodeURIComponent(key)}`, {
      headers: { 'X-Vault-Token': BAO_TOKEN },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return process.env[key];
    const json = await res.json();
    const value = json?.data?.data?.value;
    return typeof value === 'string' ? value : process.env[key];
  } catch {
    return process.env[key];
  }
}

function baoHeaders(): Record<string, string> {
  return { 'X-Vault-Token': BAO_TOKEN, 'content-type': 'application/json' };
}

// Write a KV v2 secret: POST <url>/v1/<mount>/data/<key> with { data: { value } }.
async function baoSet(key: string, value: string): Promise<void> {
  if (!BAO_URL) throw new Error('OpenBao not configured (OFFGRID_OPENBAO_URL unset)');
  const res = await fetch(`${BAO_URL}/v1/${BAO_MOUNT}/data/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: baoHeaders(),
    body: JSON.stringify({ data: { value } }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`OpenBao write ${res.status}`);
}

// Soft-delete latest version: DELETE <url>/v1/<mount>/data/<key>.
async function baoRemove(key: string): Promise<void> {
  if (!BAO_URL) throw new Error('OpenBao not configured');
  const res = await fetch(`${BAO_URL}/v1/${BAO_MOUNT}/data/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: baoHeaders(),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok && res.status !== 404) throw new Error(`OpenBao delete ${res.status}`);
}

// Enumerate keys: LIST <url>/v1/<mount>/metadata (KV v2 metadata path).
async function baoList(): Promise<string[]> {
  if (!BAO_URL) return [];
  try {
    const res = await fetch(`${BAO_URL}/v1/${BAO_MOUNT}/metadata?list=true`, {
      headers: baoHeaders(),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const keys = json?.data?.keys;
    return Array.isArray(keys) ? (keys as string[]) : [];
  } catch {
    return [];
  }
}

async function baoHealth(): Promise<boolean> {
  if (!BAO_URL) return false;
  try {
    const res = await fetch(`${BAO_URL}/v1/sys/health`, { signal: AbortSignal.timeout(2500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

export const openBaoSecrets: SecretsPort & { health(): Promise<boolean> } = {
  meta: {
    id: 'openbao',
    capability: 'secrets',
    vendor: 'OpenBao',
    license: 'MPL-2.0',
    render: 'embed',
    embedUrl: BAO_URL,
    description: 'KMS-backed secrets (KV v2). Read/write via API; admin surfaced as an SSO embed.',
  },
  writable: true,
  get: baoGet,
  async has(key) {
    return (await baoGet(key)) !== undefined;
  },
  set: baoSet,
  remove: baoRemove,
  list: baoList,
  health: baoHealth,
};

export function openBaoConfigured(): boolean {
  return Boolean(BAO_URL);
}

// ── Deep operations (versioning / rotation / seal / leases / dynamic DB) ─────────────────────────
// These sit alongside the flat SecretsPort CRUD. They deliberately NEVER read or return a stored KV
// secret VALUE — only version metadata, seal state, lease handles+TTLs, and (for dynamic secrets)
// freshly-minted ephemeral creds. The dynamic-DB mount is a separate mount, configured independently.

const BAO_DB_MOUNT = process.env.OFFGRID_OPENBAO_DB_MOUNT ?? 'database';

function baseUrl(): string {
  if (!BAO_URL) throw new Error('OpenBao not configured (OFFGRID_OPENBAO_URL unset)');
  return BAO_URL;
}

async function baoJson(
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { ...baoHeaders(), ...init?.headers },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok && res.status !== 404) throw new Error(`OpenBao ${res.status}`);
  // 204 (seal) carries no body; some errors do. Parse defensively.
  const text = await res.text();
  if (!text) return null;
  try {
    const json = JSON.parse(text) as unknown;
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function unwrapData(json: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!json) return null;
  const d = json.data;
  return d && typeof d === 'object' ? (d as Record<string, unknown>) : null;
}

// KV v2 version history for a key: GET <mount>/metadata/<key>.
export async function baoVersions(key: string): Promise<SecretVersionsView> {
  const json = await baoJson(kvMetadataPath(BAO_MOUNT, key), { method: 'GET' });
  return buildSecretVersionsView(unwrapData(json));
}

// Rotate a secret = write a NEW version (KV v2 versions automatically). Optionally hard-destroy the
// prior versions in the same action so old material can't be recovered.
export async function baoRotate(
  key: string,
  value: string,
  destroyPrior: number[] = [],
): Promise<{ version: number | null }> {
  await baoSet(key, value);
  const after = await baoVersions(key);
  const current = after.currentVersion;
  const toDestroy = destroyPrior.filter((v) => v > 0 && v !== current);
  if (toDestroy.length > 0) {
    await baoDestroyVersions(key, toDestroy);
  }
  return { version: current };
}

// Soft-delete specific versions (recoverable): POST <mount>/delete/<key> { versions }.
export async function baoDeleteVersions(key: string, versions: number[]): Promise<void> {
  if (versions.length === 0) return;
  await baoJson(kvDeleteVersionsPath(BAO_MOUNT, key), {
    method: 'POST',
    body: JSON.stringify({ versions }),
  });
}

// Undelete (recover) specific versions: POST <mount>/undelete/<key> { versions }.
export async function baoUndeleteVersions(key: string, versions: number[]): Promise<void> {
  if (versions.length === 0) return;
  await baoJson(kvUndeletePath(BAO_MOUNT, key), {
    method: 'POST',
    body: JSON.stringify({ versions }),
  });
}

// Hard-destroy specific versions (irreversible): POST <mount>/destroy/<key> { versions }.
export async function baoDestroyVersions(key: string, versions: number[]): Promise<void> {
  if (versions.length === 0) return;
  await baoJson(kvDestroyPath(BAO_MOUNT, key), {
    method: 'POST',
    body: JSON.stringify({ versions }),
  });
}

// Seal the vault (destructive): PUT /v1/sys/seal (204). Returns fresh seal-status.
export async function baoSeal(): Promise<SealActionView> {
  await baoJson('/v1/sys/seal', { method: 'PUT' });
  const status = await baoJson('/v1/sys/seal-status', { method: 'GET' });
  return buildSealActionView(status);
}

// Submit ONE unseal key share: PUT /v1/sys/unseal { key }. Progressive — returns updated status.
// `reset: true` abandons the current attempt.
export async function baoUnseal(key: string, reset = false): Promise<SealActionView> {
  const body = reset ? { reset: true } : { key };
  const status = await baoJson('/v1/sys/unseal', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return buildSealActionView(status);
}

// List lease ids under a prefix: LIST /v1/sys/leases/lookup/<prefix>.
export async function baoLeaseList(prefix: string): Promise<LeaseRow[]> {
  const json = await baoJson(leaseLookupPath(prefix), { method: 'GET' });
  return buildLeaseRows(prefix, unwrapData(json)?.keys);
}

// Look up a specific lease (TTL, renewable, expiry): PUT /v1/sys/leases/lookup { lease_id }.
export async function baoLeaseDetail(leaseId: string): Promise<LeaseDetail> {
  const json = await baoJson('/v1/sys/leases/lookup', {
    method: 'PUT',
    body: JSON.stringify({ lease_id: leaseId }),
  });
  return buildLeaseDetail(json);
}

// Revoke a lease (destructive): PUT /v1/sys/leases/revoke { lease_id }.
export async function baoLeaseRevoke(leaseId: string): Promise<void> {
  await baoJson('/v1/sys/leases/revoke', {
    method: 'PUT',
    body: JSON.stringify({ lease_id: leaseId }),
  });
}

// List configured dynamic-DB roles: LIST /v1/<dbMount>/roles. Returns [] when the engine is absent.
export async function baoDbRoles(): Promise<string[]> {
  try {
    const json = await baoJson(dbRolesPath(BAO_DB_MOUNT), { method: 'GET' });
    const keys = unwrapData(json)?.keys;
    return Array.isArray(keys) ? (keys as string[]).filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

// Generate on-demand dynamic DB creds for a role: GET /v1/<dbMount>/creds/<role>. The ONLY place a
// value (a freshly-minted, lease-bound username/password) is returned — that is the point of a
// dynamic secret.
export async function baoDbCreds(role: string): Promise<DynamicDbCreds> {
  const json = await baoJson(dbCredsPath(BAO_DB_MOUNT, role), { method: 'GET' });
  return buildDynamicDbCreds(json);
}

export function openBaoDbMount(): string {
  return BAO_DB_MOUNT;
}
