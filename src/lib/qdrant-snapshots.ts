// PURE Qdrant snapshot / collection-admin logic — ZERO imports, ZERO I/O, fully unit-testable.
//
// This is the brain behind the snapshot management surface: it validates collection + snapshot names
// (which also flow into URL path segments, so validation is the SSRF/path-traversal gate), normalizes
// Qdrant's `{ result: ... }` REST envelopes into typed rows, formats byte sizes, and shapes the
// recover-request body. The adapter (`adapters/qdrant-snapshots.ts`) does the fetch()es; everything
// here is a plain function over plain data so the whole normalization layer is tested with no network.

// ── Types (the console-facing contract) ─────────────────────────────────────────────────────────

/** A collection as shown in the list — name plus the health/size readout when available. */
export interface CollectionSummary {
  name: string;
  status: string; // 'green' | 'yellow' | 'red' | 'grey' | 'unknown'
  pointsCount: number | null;
  vectorsCount: number | null;
  segmentsCount: number | null;
}

/** Full collection info for the detail page. */
export interface CollectionInfo extends CollectionSummary {
  optimizerStatus: string;
  indexedVectorsCount: number | null;
  /** Vector params (size/distance) when a single unnamed vector config is present. */
  vectorSize: number | null;
  distance: string | null;
}

/** One snapshot row on the collection detail page. */
export interface SnapshotRow {
  name: string;
  /** Size in bytes as reported by Qdrant (may be absent → null). */
  size: number | null;
  /** ISO-ish creation timestamp string as reported by Qdrant, or null. */
  creationTime: string | null;
  checksum: string | null;
}

/** The request the console sends to restore a collection from a snapshot. */
export interface RecoverRequest {
  /** A URL or file:// location Qdrant can pull the snapshot from. */
  location: string;
  /**
   * Conflict resolution when a point exists in both the snapshot and the live collection.
   * Qdrant's PUT .../snapshots/recover `priority`. Defaults to 'snapshot' (snapshot wins) — the
   * restore-is-authoritative semantics an operator expects from a disaster-recovery action.
   */
  priority: 'snapshot' | 'replica' | 'no_sync';
  checksum?: string;
}

// ── Validation (also the path-segment safety gate) ──────────────────────────────────────────────
// Collection + snapshot names are interpolated into Qdrant REST paths. Rejecting anything outside a
// tight charset here is what prevents path traversal / request smuggling through those segments.

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

const COLLECTION_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
// Snapshot names carry Qdrant's timestamped shape (e.g. `offgrid-brain-2024-01-01-10-00-00.snapshot`)
// which can include colons in some versions; allow that set but never a slash or dot-dot.
const SNAPSHOT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,510}$/;

function hasTraversal(name: string): boolean {
  return name.includes('..') || name.includes('/') || name.includes('\\');
}

/** Validate a collection name for safe use as a path segment + a real Qdrant collection id. */
export function validateCollectionName(name: unknown): ValidationResult {
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, error: 'collection name is required' };
  }
  if (hasTraversal(name)) return { ok: false, error: 'collection name has illegal characters' };
  if (!COLLECTION_NAME_RE.test(name)) {
    return { ok: false, error: 'collection name must be 1-255 chars of [A-Za-z0-9._-]' };
  }
  return { ok: true };
}

/** Validate a snapshot name (delete / download / recover-from targets). */
export function validateSnapshotName(name: unknown): ValidationResult {
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, error: 'snapshot name is required' };
  }
  if (hasTraversal(name)) return { ok: false, error: 'snapshot name has illegal characters' };
  if (!SNAPSHOT_NAME_RE.test(name)) {
    return { ok: false, error: 'snapshot name has illegal characters' };
  }
  return { ok: true };
}

// ── Normalizers (parse Qdrant's `{ result }` envelope into typed rows) ───────────────────────────

function toFiniteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function toStr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

interface CollectionsEnvelope {
  result?: { collections?: unknown };
}

/** Parse GET /collections → the bare list of collection names (deduped, order-preserving). */
export function normalizeCollectionNames(json: unknown): string[] {
  const list = (json as CollectionsEnvelope)?.result?.collections;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of list) {
    const name = (c as { name?: unknown })?.name;
    if (typeof name === 'string' && name.length > 0 && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Parse GET /collections/{name} → full CollectionInfo. `name` is passed since the body omits it. */
export function normalizeCollectionInfo(name: string, json: unknown): CollectionInfo {
  const r = (json as { result?: Record<string, unknown> })?.result ?? {};
  const vectors = (r.config as { params?: { vectors?: unknown } } | undefined)?.params?.vectors;
  // A single unnamed vector config is `{ size, distance }`; named configs are a map → leave null.
  let vectorSize: number | null = null;
  let distance: string | null = null;
  if (vectors && typeof vectors === 'object' && 'size' in vectors) {
    vectorSize = toFiniteOrNull((vectors as { size?: unknown }).size);
    const d = (vectors as { distance?: unknown }).distance;
    distance = typeof d === 'string' ? d : null;
  }
  return {
    name,
    status: toStr(r.status, 'unknown'),
    optimizerStatus:
      typeof r.optimizer_status === 'string'
        ? r.optimizer_status
        : r.optimizer_status && typeof r.optimizer_status === 'object'
          ? 'error'
          : 'unknown',
    pointsCount: toFiniteOrNull(r.points_count),
    vectorsCount: toFiniteOrNull(r.vectors_count),
    indexedVectorsCount: toFiniteOrNull(r.indexed_vectors_count),
    segmentsCount: toFiniteOrNull(r.segments_count),
    vectorSize,
    distance,
  };
}

/** Build a CollectionSummary from CollectionInfo (list view projection). */
export function toCollectionSummary(info: CollectionInfo): CollectionSummary {
  return {
    name: info.name,
    status: info.status,
    pointsCount: info.pointsCount,
    vectorsCount: info.vectorsCount,
    segmentsCount: info.segmentsCount,
  };
}

function toSnapshotRow(entry: unknown): SnapshotRow | null {
  const e = entry as { name?: unknown; size?: unknown; creation_time?: unknown; checksum?: unknown };
  if (typeof e?.name !== 'string' || e.name.length === 0) return null;
  return {
    name: e.name,
    size: toFiniteOrNull(e.size),
    creationTime: typeof e.creation_time === 'string' ? e.creation_time : null,
    checksum: typeof e.checksum === 'string' ? e.checksum : null,
  };
}

/** Parse GET /collections/{name}/snapshots → typed rows (skips malformed entries), newest first. */
export function normalizeSnapshots(json: unknown): SnapshotRow[] {
  const list = (json as { result?: unknown })?.result;
  if (!Array.isArray(list)) return [];
  const rows: SnapshotRow[] = [];
  for (const entry of list) {
    const row = toSnapshotRow(entry);
    if (row) rows.push(row);
  }
  // Newest first when timestamps are present; undated rows sort last but keep stable order.
  return rows.sort((a, b) => (b.creationTime ?? '').localeCompare(a.creationTime ?? ''));
}

/** Parse POST /collections/{name}/snapshots (create) → the single created snapshot row. */
export function normalizeCreatedSnapshot(json: unknown): SnapshotRow | null {
  return toSnapshotRow((json as { result?: unknown })?.result);
}

// ── Size formatting ──────────────────────────────────────────────────────────────────────────────

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Human-readable byte size. null/negative → '—'. Binary (1024) steps to match ops tooling. */
export function formatSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`;
}

// ── Recover-request shaping ────────────────────────────────────────────────────────────────────

const VALID_PRIORITIES = new Set(['snapshot', 'replica', 'no_sync']);

/**
 * Shape a validated recover (restore) request from untrusted input. The `location` is required and
 * must be an http(s) or file URL Qdrant can pull; `priority` defaults to 'snapshot' (snapshot wins,
 * the DR-restore semantics). Returns { ok:false, error } on bad input so the route replies 400.
 */
export function buildRecoverRequest(input: {
  location?: unknown;
  priority?: unknown;
  checksum?: unknown;
}): { ok: true; request: RecoverRequest } | { ok: false; error: string } {
  const location = typeof input.location === 'string' ? input.location.trim() : '';
  if (!location) return { ok: false, error: 'location is required' };
  if (!/^(https?|file):\/\//i.test(location)) {
    return { ok: false, error: 'location must be an http(s):// or file:// URL' };
  }
  const rawPriority = typeof input.priority === 'string' ? input.priority : 'snapshot';
  if (!VALID_PRIORITIES.has(rawPriority)) {
    return { ok: false, error: 'priority must be snapshot, replica, or no_sync' };
  }
  const request: RecoverRequest = {
    location,
    priority: rawPriority as RecoverRequest['priority'],
  };
  if (typeof input.checksum === 'string' && input.checksum.trim().length > 0) {
    request.checksum = input.checksum.trim();
  }
  return { ok: true, request };
}

/**
 * Relative Qdrant REST path for a snapshot's raw file (used by the download proxy + as the default
 * self-recover location). Callers MUST pass names already through validate*Name(). Pure — no host.
 */
export function snapshotDownloadPath(collection: string, snapshot: string): string {
  return `/collections/${encodeURIComponent(collection)}/snapshots/${encodeURIComponent(snapshot)}`;
}
