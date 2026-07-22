// PURE dataset-management logic for the Langfuse-native datasets surface — ZERO imports, ZERO I/O.
//
// The brain behind the Langfuse datasets adapter: validates dataset/item input, shapes request bodies
// for the public API (`POST /api/public/v2/datasets`, `POST /api/public/dataset-items`), and
// normalizes the API JSON (datasets, items, runs) into stable display models. No fetch here — one
// rule, one place, fully unit-testable with no network.
//
// Langfuse dataset model: a dataset is a NAME grouping ITEMS (each an input + optional expectedOutput
// + metadata, ACTIVE or ARCHIVED). Items are UPSERTED by id (so "edit" = re-POST with the same id).
// A dataset RUN is one experiment execution over the items (created by the SDK during evals); the
// console reads runs back but doesn't launch them here.

// ── Types (public contract) ────────────────────────────────────────────────────────────────────
export type DatasetItemStatus = 'ACTIVE' | 'ARCHIVED';
export const ITEM_STATUSES: readonly DatasetItemStatus[] = ['ACTIVE', 'ARCHIVED'];

const MAX_NAME_LEN = 255;
const MAX_ID_LEN = 255;

// ── Raw API shapes (mirror the Langfuse OpenAPI) ─────────────────────────────────────────────────
export interface RawDataset {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  metadata?: unknown;
  projectId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface RawDatasetItem {
  id?: string | null;
  status?: string | null;
  input?: unknown;
  expectedOutput?: unknown;
  metadata?: unknown;
  sourceTraceId?: string | null;
  sourceObservationId?: string | null;
  datasetId?: string | null;
  datasetName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface RawDatasetRun {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  metadata?: unknown;
  datasetId?: string | null;
  datasetName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

// ── Display models ───────────────────────────────────────────────────────────────────────────────
export interface DatasetRow {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetItemView {
  id: string;
  status: DatasetItemStatus;
  /** Pretty-printed JSON (or the raw string) of each field, ready to render/edit. */
  input: string;
  expectedOutput: string;
  metadata: string;
  sourceTraceId: string;
  sourceObservationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetRunView {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export type Valid<T> = { ok: true; value: T } | { ok: false; error: string };
function ok<T>(value: T): Valid<T> {
  return { ok: true, value };
}
function err<T>(error: string): Valid<T> {
  return { ok: false, error };
}

// ── Validation ─────────────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f]/;

/** Validate a dataset name (pure). Non-empty, ≤255, no control chars. Returns the trimmed name. */
export function validateDatasetName(raw: string | null | undefined): Valid<string> {
  const name = (raw ?? '').trim();
  if (!name) return err('Dataset name is required');
  if (name.length > MAX_NAME_LEN) return err(`Dataset name must be ≤ ${MAX_NAME_LEN} characters`);
  if (CONTROL_RE.test(name)) return err('Dataset name contains control characters');
  return ok(name);
}

/** Validate an optional dataset-item id (pure). Blank → undefined (server generates). ≤255 chars. */
export function validateItemId(raw: string | null | undefined): Valid<string | undefined> {
  const id = (raw ?? '').trim();
  if (!id) return ok(undefined);
  if (id.length > MAX_ID_LEN) return err(`Item id must be ≤ ${MAX_ID_LEN} characters`);
  return ok(id);
}

/** Coerce a status string to a valid DatasetItemStatus (pure). Unknown/blank → ACTIVE (the default). */
export function coerceStatus(raw: string | null | undefined): DatasetItemStatus {
  const s = (raw ?? '').trim().toUpperCase();
  return s === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';
}

/**
 * Coerce an operator-entered field (input / expectedOutput / metadata) into the JSON value the API
 * stores (pure). A blank string → null (field omitted). Otherwise try to parse as JSON — a valid
 * JSON literal/object/array is stored as-is; anything else is stored as the raw string. This mirrors
 * the Langfuse UI, which accepts both structured JSON and plain text.
 */
export function coerceJsonField(raw: string | null | undefined): unknown {
  const s = (raw ?? '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/**
 * Validate metadata specifically (pure): blank → null; otherwise it MUST be a JSON OBJECT (metadata
 * is a key/value bag, not a scalar). Returns the parsed object or an error.
 */
export function validateMetadata(raw: string | null | undefined): Valid<Record<string, unknown> | null> {
  const s = (raw ?? '').trim();
  if (!s) return ok(null);
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return err('Metadata must be valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return err('Metadata must be a JSON object');
  return ok(parsed as Record<string, unknown>);
}

// ── Request-body shaping ───────────────────────────────────────────────────────────────────────
export interface CreateDatasetInput {
  name?: string | null;
  description?: string | null;
  metadata?: string | null;
}

export interface CreateDatasetBody {
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/** Validate + shape a create-dataset body (pure). Name required; description/metadata optional. */
export function buildCreateDatasetBody(input: CreateDatasetInput): Valid<CreateDatasetBody> {
  const nameV = validateDatasetName(input.name);
  if (!nameV.ok) return err(nameV.error);
  const metaV = validateMetadata(input.metadata);
  if (!metaV.ok) return err(metaV.error);
  const description = (input.description ?? '').trim();
  return ok({
    name: nameV.value,
    ...(description ? { description } : {}),
    ...(metaV.value ? { metadata: metaV.value } : {}),
  });
}

export interface CreateItemInput {
  datasetName?: string | null;
  input?: string | null;
  expectedOutput?: string | null;
  metadata?: string | null;
  id?: string | null;
  status?: string | null;
}

export interface CreateItemBody {
  datasetName: string;
  input: unknown;
  expectedOutput: unknown;
  metadata: unknown;
  status: DatasetItemStatus;
  id?: string;
}

/**
 * Validate + shape a create/upsert dataset-item body (pure). `POST /api/public/dataset-items` upserts
 * on id, so this same body both creates a new item (no id) and edits an existing one (with id). The
 * `input` is required (an item with no input is meaningless); expectedOutput/metadata are optional.
 * Metadata, if present, must be a JSON object; input/expectedOutput accept JSON or plain text.
 */
export function buildCreateItemBody(input: CreateItemInput): Valid<CreateItemBody> {
  const nameV = validateDatasetName(input.datasetName);
  if (!nameV.ok) return err('datasetName is required');
  const idV = validateItemId(input.id);
  if (!idV.ok) return err(idV.error);
  if (!(input.input ?? '').trim()) return err('Item input is required');
  const metaV = validateMetadata(input.metadata);
  if (!metaV.ok) return err(metaV.error);
  return ok({
    datasetName: nameV.value,
    input: coerceJsonField(input.input),
    expectedOutput: coerceJsonField(input.expectedOutput),
    metadata: metaV.value,
    status: coerceStatus(input.status),
    ...(idV.value ? { id: idV.value } : {}),
  });
}

// ── Normalization (API JSON → display models) ────────────────────────────────────────────────────
/** Pretty-print a stored JSON field for display/editing (pure). Strings pass through unquoted. */
export function fieldToText(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(raw);
  }
}

function byCreatedDesc<T extends { createdAt: string; id: string }>(a: T, b: T): number {
  if (a.createdAt < b.createdAt) return 1;
  if (a.createdAt > b.createdAt) return -1;
  return a.id.localeCompare(b.id);
}

/** Shape dataset rows, newest-created first (pure). */
export function shapeDatasets(rows: RawDataset[]): DatasetRow[] {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      id: (r.id ?? '').trim(),
      name: (r.name ?? '').trim() || 'unnamed',
      description: (r.description ?? '').trim(),
      createdAt: (r.createdAt ?? '').trim(),
      updatedAt: (r.updatedAt ?? '').trim(),
    }))
    .sort((a, b) => {
      if (a.createdAt < b.createdAt) return 1;
      if (a.createdAt > b.createdAt) return -1;
      return a.name.localeCompare(b.name);
    });
}

/** Shape a single dataset (pure). Returns null for a missing row. */
export function shapeDataset(row: RawDataset | null | undefined): DatasetRow | null {
  if (!row) return null;
  return {
    id: (row.id ?? '').trim(),
    name: (row.name ?? '').trim() || 'unnamed',
    description: (row.description ?? '').trim(),
    createdAt: (row.createdAt ?? '').trim(),
    updatedAt: (row.updatedAt ?? '').trim(),
  };
}

/** Shape dataset items, newest-created first (pure). Each field is rendered to text. */
export function shapeDatasetItems(rows: RawDatasetItem[]): DatasetItemView[] {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      id: (r.id ?? '').trim(),
      status: coerceStatus(r.status),
      input: fieldToText(r.input),
      expectedOutput: fieldToText(r.expectedOutput),
      metadata: fieldToText(r.metadata),
      sourceTraceId: (r.sourceTraceId ?? '').trim(),
      sourceObservationId: (r.sourceObservationId ?? '').trim(),
      createdAt: (r.createdAt ?? '').trim(),
      updatedAt: (r.updatedAt ?? '').trim(),
    }))
    .sort(byCreatedDesc);
}

/** Shape a single dataset item (pure). Returns null for a missing row. */
export function shapeDatasetItem(row: RawDatasetItem | null | undefined): DatasetItemView | null {
  if (!row) return null;
  return shapeDatasetItems([row])[0] ?? null;
}

/** Shape dataset runs, newest-created first (pure). */
export function shapeDatasetRuns(rows: RawDatasetRun[]): DatasetRunView[] {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      id: (r.id ?? '').trim(),
      name: (r.name ?? '').trim() || 'unnamed',
      description: (r.description ?? '').trim(),
      createdAt: (r.createdAt ?? '').trim(),
      updatedAt: (r.updatedAt ?? '').trim(),
    }))
    .sort(byCreatedDesc);
}
