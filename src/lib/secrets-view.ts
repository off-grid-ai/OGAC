import { toDisplayHost } from '@/lib/display-host';

// PURE OpenBao secrets STATUS display-model builder — ZERO I/O, fully unit-testable.
//
// The only import (below) is the pure, zero-IO mDNS display-host mapper, used by the thin reader
// so the OpenBao URL we render is never a raw loopback/LAN address. `buildSecretsView` itself takes
// whatever string it is handed and stays pure — the reader is responsible for display-mapping first.
//
// This surface is STATUS/METADATA ONLY. It renders whether the secrets store is reachable, whether
// it is sealed, its version, its mount paths (type + path), and which secrets adapter is active.
// It MUST NEVER fetch, hold, or render an actual secret value. The thin reader below only ever hits
// OpenBao's /v1/sys/* health/seal/mounts endpoints — never any KV data path.
//
// The reader (readSecretsView) does the network I/O and never throws → { data, error }. This file's
// buildSecretsView is a pure normalizer over the raw JSON those sys endpoints return: given whatever
// (possibly malformed / partial / null) health, seal-status, and mounts payloads came back, it
// produces a safe display model. It never throws.

// Raw shapes we defensively read from OpenBao's sys endpoints. All fields optional/unknown because
// the store may be down, sealed (limited response), or a different Vault-compatible version.

// GET /v1/sys/health — e.g. { initialized, sealed, standby, version, cluster_name }
export interface RawHealth {
  initialized?: unknown;
  sealed?: unknown;
  standby?: unknown;
  version?: unknown;
  cluster_name?: unknown;
}

// GET /v1/sys/seal-status — e.g. { sealed, t, n, progress, version }
export interface RawSealStatus {
  sealed?: unknown;
  t?: unknown; // unseal threshold (keys required)
  n?: unknown; // total unseal key shares
  progress?: unknown; // unseal keys provided so far
  version?: unknown;
}

// GET /v1/sys/mounts — a map of "<path>/" → { type, description, ... }. NO secret values, just the
// mount table (which backends are mounted where). Some deployments wrap it under `.data`.
export interface RawMountInfo {
  type?: unknown;
  description?: unknown;
  accessor?: unknown;
}
export type RawMounts = Record<string, RawMountInfo> | { data?: Record<string, RawMountInfo> };

export interface SecretsMountRow {
  path: string; // mount path, e.g. "secret/"
  type: string; // backend type, e.g. "kv", "cubbyhole", "system"
  description: string; // human description; "" when none
}

export interface SecretsViewInput {
  // Which secrets adapter is active in the console (from the adapter meta). Purely a label.
  activeAdapterId: string; // e.g. "openbao" | "env"
  activeAdapterVendor: string; // e.g. "OpenBao" | "Process env"
  configured: boolean; // an OpenBao URL is configured (openBaoConfigured())
  baoUrl: string | null; // the configured OpenBao base URL (never a secret), or null
  mount: string | null; // the configured KV mount name (e.g. "secret"), metadata only
  health: RawHealth | null; // raw /sys/health JSON, or null when unreachable/absent
  sealStatus: RawSealStatus | null; // raw /sys/seal-status JSON, or null
  mounts: RawMounts | null; // raw /sys/mounts JSON, or null
}

export interface SecretsView {
  activeAdapterId: string;
  activeAdapterVendor: string;
  configured: boolean; // OpenBao is configured for this deploy
  reachable: boolean; // the store answered a sys request
  initialized: boolean | null; // null = unknown
  sealed: boolean | null; // null = unknown; true = SEALED (red), false = unsealed (green)
  standby: boolean | null;
  version: string | null;
  clusterName: string | null;
  unsealThreshold: number | null; // `t`: keys needed to unseal
  unsealShares: number | null; // `n`: total key shares
  unsealProgress: number | null; // keys provided so far (when sealed)
  baoUrl: string | null;
  mount: string | null;
  mounts: SecretsMountRow[]; // mount table, path-sorted; empty when unknown
}

function asBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNonNegInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

// Unwrap /sys/mounts which is either the mount map directly or nested under `.data`.
function mountMap(mounts: RawMounts | null): Record<string, RawMountInfo> {
  if (!mounts || typeof mounts !== 'object') return {};
  const maybeData = (mounts as { data?: unknown }).data;
  if (maybeData && typeof maybeData === 'object') return maybeData as Record<string, RawMountInfo>;
  return mounts as Record<string, RawMountInfo>;
}

// Build the read-only secrets STATUS model. Never throws; missing/malformed inputs degrade to safe
// defaults (unknown → null / empty). Reads ONLY status & mount-table metadata, never secret values.
export function buildSecretsView(input: SecretsViewInput): SecretsView {
  const health = input?.health ?? null;
  const seal = input?.sealStatus ?? null;

  // reachable = we got any usable sys response back.
  const reachable = Boolean(health) || Boolean(seal) || Boolean(input?.mounts);

  // seal-status is authoritative for sealed; fall back to health.sealed.
  const sealed = asBool(seal?.sealed) ?? asBool(health?.sealed);

  const rows: SecretsMountRow[] = Object.entries(mountMap(input?.mounts))
    .filter(
      ([path, info]) =>
        typeof path === 'string' && path.length > 0 && info && typeof info === 'object',
    )
    .map(([path, info]) => ({
      path,
      type: asStr(info?.type) ?? 'unknown',
      description: asStr(info?.description) ?? '',
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    activeAdapterId: asStr(input?.activeAdapterId) ?? 'unknown',
    activeAdapterVendor: asStr(input?.activeAdapterVendor) ?? 'unknown',
    configured: input?.configured === true,
    reachable,
    initialized: asBool(health?.initialized),
    sealed,
    standby: asBool(health?.standby),
    version: asStr(health?.version) ?? asStr(seal?.version),
    clusterName: asStr(health?.cluster_name),
    unsealThreshold: asNonNegInt(seal?.t),
    unsealShares: asNonNegInt(seal?.n),
    unsealProgress: asNonNegInt(seal?.progress),
    baoUrl: asStr(input?.baoUrl),
    mount: asStr(input?.mount),
    mounts: rows,
  };
}

// ── Thin best-effort reader ─────────────────────────────────────────────────────────────────────
// Hits ONLY OpenBao's /v1/sys/{health,seal-status,mounts} endpoints. Never touches any KV data path,
// never reads or returns a secret value. Never throws → { data, error }.

const SYS_TIMEOUT_MS = 2500;

// Env is read here (not in the pure module). Support the canonical OFFGRID_OPENBAO_URL plus the
// OFFGRID_BAO_URL alias; token/mount mirror the adapter. The token authenticates the sys mounts read.
function baoEnv(): { url: string | null; token: string; mount: string } {
  const raw = process.env.OFFGRID_OPENBAO_URL ?? process.env.OFFGRID_BAO_URL ?? '';
  const token = process.env.OFFGRID_OPENBAO_TOKEN ?? 'offgrid-dev-token';
  const mount = process.env.OFFGRID_OPENBAO_MOUNT ?? 'secret';
  return { url: raw && raw.trim() ? raw.trim() : null, token, mount };
}

async function getJson(
  url: string,
  headers: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(SYS_TIMEOUT_MS) });
    // Even sealed/standby states (429/472/473/501/503) carry a JSON body describing state — parse it.
    const json = (await res.json()) as unknown;
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function readSecretsView(): Promise<{ data: SecretsView; error: string | null }> {
  const { url, token, mount } = baoEnv();
  const configured = Boolean(url);

  // Active adapter label: OpenBao when a URL is configured, else the env adapter.
  const activeAdapterId = configured ? 'openbao' : 'env';
  const activeAdapterVendor = configured ? 'OpenBao' : 'Process env';

  if (!url) {
    return {
      data: buildSecretsView({
        activeAdapterId,
        activeAdapterVendor,
        configured: false,
        baoUrl: null,
        mount,
        health: null,
        sealStatus: null,
        mounts: null,
      }),
      error: null,
    };
  }

  const authHeaders = { 'X-Vault-Token': token };
  const [health, sealStatus, mounts] = await Promise.all([
    getJson(`${url}/v1/sys/health`, {}),
    getJson(`${url}/v1/sys/seal-status`, {}),
    getJson(`${url}/v1/sys/mounts`, authHeaders),
  ]);

  // Display-map the configured URL so no raw loopback/LAN address ever surfaces in the tile or the
  // error banner. The server still connected to the real `url` above — this is display-only.
  const displayUrl = toDisplayHost(url);

  const data = buildSecretsView({
    activeAdapterId,
    activeAdapterVendor,
    configured: true,
    baoUrl: displayUrl,
    mount,
    health: health as RawHealth | null,
    sealStatus: sealStatus as RawSealStatus | null,
    mounts: mounts as RawMounts | null,
  });

  const error = data.reachable ? null : `OpenBao unreachable at ${displayUrl}`;
  return { data, error };
}
