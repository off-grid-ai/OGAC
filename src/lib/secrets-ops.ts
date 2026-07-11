// PURE OpenBao operational logic — ZERO imports, ZERO I/O, fully unit-testable.
//
// This module deepens the secrets integration beyond flat KV CRUD. It provides:
//   • KV v2 request-path builders (data / metadata / delete / destroy) so callers never hand-assemble
//     Vault paths (which is where traversal / mount-confusion bugs creep in).
//   • Response shapers that normalize the (possibly malformed / partial) JSON OpenBao returns for
//     version metadata, seal status, lease listings, and dynamic DB creds into safe display models.
//
// SAFETY INVARIANT: nothing here accepts, holds, or emits a stored KV secret VALUE. Version metadata,
// lease ids, and TTLs are operational metadata, not secret material. Dynamic DB creds (username /
// password) ARE returned once by generateDbCreds' shaper because that is the ONLY way to hand a
// freshly-minted, short-lived credential to the operator — that is the whole point of a dynamic
// secret. Those are ephemeral, lease-bound, and never persisted or listed by this module.

// ── KV v2 path builders ───────────────────────────────────────────────────────────────────────
// KV v2 splits a logical key into parallel API paths: data (values+current version), metadata
// (version history + config), delete/undelete (soft), destroy (hard). All are `<mount>/<verb>/<key>`.

function encKey(key: string): string {
  // Encode each path segment but preserve the "/" hierarchy KV v2 uses for folders.
  return key
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
}

export function kvDataPath(mount: string, key: string, version?: number): string {
  const base = `/v1/${mount}/data/${encKey(key)}`;
  return typeof version === 'number' && version > 0 ? `${base}?version=${version}` : base;
}

export function kvMetadataPath(mount: string, key: string): string {
  return `/v1/${mount}/metadata/${encKey(key)}`;
}

// Soft-delete SPECIFIC versions (recoverable) → POST <mount>/delete/<key> { versions: [...] }.
export function kvDeleteVersionsPath(mount: string, key: string): string {
  return `/v1/${mount}/delete/${encKey(key)}`;
}

// Undelete (recover) specific versions → POST <mount>/undelete/<key> { versions: [...] }.
export function kvUndeletePath(mount: string, key: string): string {
  return `/v1/${mount}/undelete/${encKey(key)}`;
}

// HARD, irreversible destroy of specific versions → POST <mount>/destroy/<key> { versions: [...] }.
export function kvDestroyPath(mount: string, key: string): string {
  return `/v1/${mount}/destroy/${encKey(key)}`;
}

// ── KV v2 version-metadata shaping ──────────────────────────────────────────────────────────────
// GET <mount>/metadata/<key> → { data: { current_version, oldest_version, max_versions,
//   created_time, updated_time, versions: { "1": { created_time, deletion_time, destroyed }, ... } } }

export interface RawVersionMeta {
  created_time?: unknown;
  deletion_time?: unknown;
  destroyed?: unknown;
}

export interface RawKeyMetadata {
  current_version?: unknown;
  oldest_version?: unknown;
  max_versions?: unknown;
  created_time?: unknown;
  updated_time?: unknown;
  versions?: unknown;
}

export interface SecretVersionRow {
  version: number;
  createdTime: string | null;
  deletionTime: string | null; // set (soft-deleted) → not readable until undeleted
  destroyed: boolean; // hard-destroyed → gone forever
  current: boolean;
  // Derived state label for the UI, so the component doesn't re-derive it.
  state: 'active' | 'deleted' | 'destroyed';
}

function versionState(destroyed: boolean, deleted: boolean): SecretVersionRow['state'] {
  if (destroyed) return 'destroyed';
  if (deleted) return 'deleted';
  return 'active';
}

export interface SecretVersionsView {
  currentVersion: number | null;
  oldestVersion: number | null;
  maxVersions: number | null; // 0 / null = unlimited (KV default keeps 10)
  createdTime: string | null;
  updatedTime: string | null;
  versions: SecretVersionRow[]; // newest first
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asPosInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v);
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number.parseInt(v, 10);
  return null;
}

function asBool(v: unknown): boolean {
  return v === true;
}

// A deletion_time is a real timestamp when soft-deleted, and OpenBao sends "" (or absent) otherwise.
function isDeleted(deletionTime: string | null, destroyed: boolean): boolean {
  return !destroyed && deletionTime !== null;
}

// Normalize KV v2 metadata into a version-history display model. Never throws; missing/partial data
// degrades to empty/nulls. `raw` is the `.data` envelope (the caller unwraps it).
export function buildSecretVersionsView(raw: RawKeyMetadata | null): SecretVersionsView {
  const meta = raw ?? {};
  const current = asPosInt(meta.current_version);
  const versionsObj =
    meta.versions && typeof meta.versions === 'object'
      ? (meta.versions as Record<string, RawVersionMeta>)
      : {};

  const rows: SecretVersionRow[] = Object.entries(versionsObj)
    .map(([k, info]) => {
      const version = asPosInt(k);
      if (version === null) return null;
      const createdTime = asStr(info?.created_time);
      const deletionTime = asStr(info?.deletion_time);
      const destroyed = asBool(info?.destroyed);
      const deleted = isDeleted(deletionTime, destroyed);
      return {
        version,
        createdTime,
        deletionTime,
        destroyed,
        current: current !== null && version === current,
        state: versionState(destroyed, deleted),
      } satisfies SecretVersionRow;
    })
    .filter((r): r is SecretVersionRow => r !== null)
    .sort((a, b) => b.version - a.version);

  return {
    currentVersion: current,
    oldestVersion: asPosInt(meta.oldest_version),
    maxVersions: asPosInt(meta.max_versions),
    createdTime: asStr(meta.created_time),
    updatedTime: asStr(meta.updated_time),
    versions: rows,
  };
}

// ── Seal / unseal request + response shaping ────────────────────────────────────────────────────
// PUT /v1/sys/unseal { key } → progressive; returns seal-status-shaped body each call.
// PUT /v1/sys/seal → 204, then re-read seal-status.

// A single unseal key share is a long hex/base64 string; validate shape without ever logging it.
export function validateUnsealKey(raw: unknown): {
  ok: boolean;
  key: string;
  error: string | null;
} {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key) return { ok: false, key: '', error: 'An unseal key share is required.' };
  if (key.length < 16 || key.length > 512) {
    return { ok: false, key: '', error: 'Unseal key share is not a plausible length.' };
  }
  // Base64 / hex charset (OpenBao emits base64 by default).
  if (!/^[A-Za-z0-9+/=_-]+$/.test(key)) {
    return { ok: false, key: '', error: 'Unseal key share contains invalid characters.' };
  }
  return { ok: true, key, error: null };
}

export interface SealActionView {
  sealed: boolean | null;
  threshold: number | null; // t: shares required
  shares: number | null; // n: total shares
  progress: number | null; // shares provided so far this unseal attempt
  version: string | null;
}

export function buildSealActionView(raw: Record<string, unknown> | null): SealActionView {
  const s = raw ?? {};
  return {
    sealed: typeof s.sealed === 'boolean' ? (s.sealed as boolean) : null,
    threshold: asPosInt(s.t),
    shares: asPosInt(s.n),
    progress: asPosInt(s.progress),
    version: asStr(s.version),
  };
}

// ── Lease listing + TTL shaping ─────────────────────────────────────────────────────────────────
// LIST /v1/sys/leases/lookup/<prefix> → { data: { keys: [...] } } (lease id suffixes under prefix).
// GET  /v1/sys/leases/lookup/<id>  →  { data: { id, ttl, expire_time, renewable, issue_time } }.

export function leaseLookupPath(prefix: string): string {
  const clean = prefix.replace(/^\/+|\/+$/g, '');
  return clean
    ? `/v1/sys/leases/lookup/${encKey(clean)}?list=true`
    : `/v1/sys/leases/lookup?list=true`;
}

export interface LeaseRow {
  id: string; // lease id / suffix (an opaque handle, not a secret)
  prefix: string;
}

// Join a list prefix with the child keys the LIST returned into full lease-id rows.
export function buildLeaseRows(prefix: string, rawKeys: unknown): LeaseRow[] {
  const clean = prefix.replace(/^\/+|\/+$/g, '');
  const arr = Array.isArray(rawKeys) ? rawKeys : [];
  const seen = new Set<string>();
  const rows: LeaseRow[] = [];
  for (const k of arr) {
    if (typeof k !== 'string') continue;
    const suffix = k.trim();
    if (!suffix || seen.has(suffix)) continue;
    seen.add(suffix);
    const id = clean ? `${clean}/${suffix}` : suffix;
    rows.push({ id, prefix: clean });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

export interface LeaseDetail {
  id: string | null;
  ttl: number | null; // seconds remaining
  renewable: boolean;
  issueTime: string | null;
  expireTime: string | null;
}

export function buildLeaseDetail(raw: Record<string, unknown> | null): LeaseDetail {
  const d =
    raw && typeof raw.data === 'object' && raw.data
      ? (raw.data as Record<string, unknown>)
      : (raw ?? {});
  return {
    id: asStr(d.id),
    ttl: asPosInt(d.ttl),
    renewable: d.renewable === true,
    issueTime: asStr(d.issue_time),
    expireTime: asStr(d.expire_time),
  };
}

// Format a TTL in seconds as a compact human string ("1h 5m", "45s", "—"). Pure display helper.
export function formatTtl(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '—';
  if (seconds === 0) return '0s';
  const parts: string[] = [];
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s && parts.length < 2) parts.push(`${s}s`);
  return parts.slice(0, 2).join(' ');
}

// ── Dynamic DB secrets shaping ──────────────────────────────────────────────────────────────────
// GET /v1/<dbMount>/creds/<role> → { lease_id, lease_duration, renewable,
//   data: { username, password } }. The creds are minted on demand, short-lived, and lease-bound.

export function dbCredsPath(dbMount: string, role: string): string {
  return `/v1/${dbMount}/creds/${encodeURIComponent(role)}`;
}

export function dbRolesPath(dbMount: string): string {
  return `/v1/${dbMount}/roles?list=true`;
}

export interface DynamicDbCreds {
  leaseId: string | null;
  leaseDuration: number | null; // seconds
  renewable: boolean;
  username: string | null;
  password: string | null; // ephemeral, minted-once dynamic credential (see module header)
}

export function buildDynamicDbCreds(raw: Record<string, unknown> | null): DynamicDbCreds {
  const r = raw ?? {};
  const data = r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : {};
  return {
    leaseId: asStr(r.lease_id),
    leaseDuration: asPosInt(r.lease_duration),
    renewable: r.renewable === true,
    username: asStr(data.username),
    password: asStr(data.password),
  };
}

// Validate a dynamic-secrets role name (same conservative charset as secret key segments).
export function validateRoleName(raw: unknown): {
  ok: boolean;
  role: string;
  error: string | null;
} {
  const role = typeof raw === 'string' ? raw.trim() : '';
  if (!role) return { ok: false, role: '', error: 'A role name is required.' };
  if (role.length > 128) return { ok: false, role: '', error: 'Role name is too long.' };
  if (!/^[A-Za-z0-9._-]+$/.test(role)) {
    return {
      ok: false,
      role: '',
      error: 'Role name may only contain letters, digits, ".", "_", "-".',
    };
  }
  return { ok: true, role, error: null };
}
