// PURE Marquez run-history + governance normalizer — zero imports of I/O, fully unit-testable.
//
// The proven read path (src/lib/marquez.ts) reads only a job's LATEST run state and drops the rest.
// The audit backbone for BFSI compliance needs the FULL run history per job with real timing —
// state, startedAt/endedAt, a duration (computed when Marquez didn't precompute it), and the
// OpenLineage NominalTimeRunFacet (the run's intended business time window). It also needs the
// governance metadata Marquez holds but the graph view discards: a namespace's OWNER + description,
// and each declared TAG's description. This module turns Marquez's loosely-shaped REST JSON into
// those clean display models. The network reads live in the thin adapter (adapters/marquez-lineage);
// this file never fetches.
import { type RunState, lineageNodeLabel } from './lineage-view';

export type { RunState };

// ── Raw Marquez run shapes (only the fields we read; everything optional/defensive) ────────────
export interface RawDatasetVersionRef {
  datasetVersionId?: { namespace?: string; name?: string; version?: string } | null;
  name?: string;
}

export interface RawRunFacets {
  // OpenLineage NominalTimeRunFacet — the run's intended (business) time window.
  nominalTime?: { nominalStartTime?: string; nominalEndTime?: string } | null;
  [key: string]: unknown;
}

export interface RawMarquezRun {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  state?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  nominalStartTime?: string | null;
  nominalEndTime?: string | null;
  inputDatasetVersions?: RawDatasetVersionRef[] | null;
  outputDatasetVersions?: RawDatasetVersionRef[] | null;
  facets?: RawRunFacets | null;
}

export interface RawJobRef {
  name?: string;
  type?: string;
  updatedAt?: string;
  latestRun?: { state?: string; endedAt?: string; startedAt?: string; createdAt?: string } | null;
}

export interface RawNamespaceOwnership {
  name?: string;
  ownerName?: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  isHidden?: boolean;
}

export interface RawTag {
  name?: string;
  description?: string | null;
}

// ── Clean display models ───────────────────────────────────────────────────────────────────────
export interface RunHistoryRow {
  id: string;
  state: RunState;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string | null;
  // Wall-clock duration in ms: Marquez's own value when present, else endedAt−startedAt, else null.
  durationMs: number | null;
  // Whether durationMs was derived here (Marquez left it null but both bounds were present).
  durationDerived: boolean;
  // OpenLineage NominalTimeRunFacet — the intended business time window (may differ from wall-clock).
  nominalStartTime: string | null;
  nominalEndTime: string | null;
  nominalDurationMs: number | null;
  hasNominalTime: boolean;
  inputs: string[];
  outputs: string[];
  // Names of the run-level facets Marquez holds (so the UI can show enrichments without raw JSON).
  facetNames: string[];
}

export interface RunHistorySummary {
  total: number;
  completed: number;
  failed: number;
  running: number;
  other: number;
  // completed / (completed + failed) as a 0..1 fraction, or null when neither has occurred.
  successRate: number | null;
  // Mean wall-clock duration across runs that have one, or null when none do.
  avgDurationMs: number | null;
  totalDurationMs: number;
  // Most-recent timestamp seen (endedAt ?? startedAt ?? createdAt) across runs, or null.
  lastRunAt: string | null;
}

export interface RunHistoryView {
  namespace: string;
  job: string;
  jobLabel: string;
  runs: RunHistoryRow[];
  summary: RunHistorySummary;
}

export interface JobRefView {
  name: string;
  label: string;
  type: string | null;
  lastRunState: RunState;
  lastRunAt: string | null;
}

export interface NamespaceOwnershipView {
  name: string;
  ownerName: string | null;
  description: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isHidden: boolean;
}

export interface TagView {
  name: string;
  description: string | null;
}

// ── Small pure helpers ─────────────────────────────────────────────────────────────────────────
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function normalizeState(state: string | null | undefined): RunState {
  switch ((state ?? '').toUpperCase()) {
    case 'COMPLETED':
      return 'COMPLETED';
    case 'FAILED':
    case 'FAIL':
      return 'FAILED';
    case 'RUNNING':
      return 'RUNNING';
    case 'ABORTED':
      return 'ABORTED';
    case 'NEW':
      return 'NEW';
    default:
      return 'UNKNOWN';
  }
}

// Milliseconds between two ISO instants, or null if either is unparseable or the range is negative.
function diffMs(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const d = b - a;
  return d >= 0 ? d : null;
}

// Dataset names off a run's input/output version list (typed-id names pass through; UI labels them).
function versionRefNames(refs: RawDatasetVersionRef[] | null | undefined): string[] {
  return (Array.isArray(refs) ? refs : [])
    .map((r) => str(r?.datasetVersionId?.name) ?? str(r?.name))
    .filter((n): n is string => n !== null);
}

// ── Duration formatting (human-readable, pure) ───────────────────────────────────────────────────
/**
 * Render a millisecond duration as a compact human string: "—" (null), "420ms", "3.2s", "1m 04s",
 * "1h 02m". Sub-second stays in ms; under a minute shows one decimal second; minutes/hours pad.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) {
    const secs = Math.round(totalSec - totalMin * 60);
    return `${totalMin}m ${String(secs).padStart(2, '0')}s`;
  }
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin - hours * 60;
  return `${hours}h ${String(mins).padStart(2, '0')}m`;
}

// ── Run normalization ────────────────────────────────────────────────────────────────────────────
/**
 * Normalize one raw Marquez run into a RunHistoryRow. Computes wall-clock duration from the bounds
 * when Marquez didn't precompute it, and lifts the NominalTimeRunFacet (from either the top-level
 * fields or the run.facets.nominalTime facet). Never throws. Pure, zero-IO.
 */
export function normalizeRun(raw: RawMarquezRun | null | undefined): RunHistoryRow {
  const r = raw && typeof raw === 'object' ? raw : {};
  const startedAt = str(r.startedAt);
  const endedAt = str(r.endedAt);
  const createdAt = str(r.createdAt);

  const provided = num(r.durationMs);
  const derived = provided === null ? diffMs(startedAt, endedAt) : null;
  const durationMs = provided ?? derived;

  const facets = r.facets && typeof r.facets === 'object' ? r.facets : {};
  const facetNames = Object.keys(facets);
  const nominalFacet = facets.nominalTime ?? null;
  const nominalStartTime = str(r.nominalStartTime) ?? str(nominalFacet?.nominalStartTime);
  const nominalEndTime = str(r.nominalEndTime) ?? str(nominalFacet?.nominalEndTime);

  return {
    id: str(r.id) ?? '(unknown)',
    state: normalizeState(r.state),
    startedAt,
    endedAt,
    createdAt,
    durationMs,
    durationDerived: provided === null && derived !== null,
    nominalStartTime,
    nominalEndTime,
    nominalDurationMs: diffMs(nominalStartTime, nominalEndTime),
    hasNominalTime: nominalStartTime !== null,
    inputs: versionRefNames(r.inputDatasetVersions),
    outputs: versionRefNames(r.outputDatasetVersions),
    facetNames,
  };
}

// Freshest timestamp on a run row for ordering / lastRunAt.
function rowInstant(row: RunHistoryRow): string | null {
  return row.endedAt ?? row.startedAt ?? row.createdAt;
}

/**
 * Fold a list of normalized run rows into summary stats: state tallies, success rate, average and
 * total wall-clock duration, and the most-recent run instant. Pure, zero-IO.
 */
export function summarizeRuns(rows: RunHistoryRow[]): RunHistorySummary {
  let completed = 0;
  let failed = 0;
  let running = 0;
  let other = 0;
  let totalDurationMs = 0;
  let durationCount = 0;
  let lastRunAt: string | null = null;

  for (const row of rows) {
    if (row.state === 'COMPLETED') completed += 1;
    else if (row.state === 'FAILED') failed += 1;
    else if (row.state === 'RUNNING') running += 1;
    else other += 1;

    if (row.durationMs !== null) {
      totalDurationMs += row.durationMs;
      durationCount += 1;
    }
    const ts = rowInstant(row);
    if (ts && (lastRunAt === null || ts > lastRunAt)) lastRunAt = ts;
  }

  const decided = completed + failed;
  return {
    total: rows.length,
    completed,
    failed,
    running,
    other,
    successRate: decided > 0 ? completed / decided : null,
    avgDurationMs: durationCount > 0 ? Math.round(totalDurationMs / durationCount) : null,
    totalDurationMs,
    lastRunAt,
  };
}

/**
 * Normalize a raw Marquez runs list into a full RunHistoryView for one job — rows sorted
 * most-recent-first, plus summary stats. Pure, zero-IO.
 */
export function normalizeRunHistory(input: {
  namespace: string;
  job: string;
  runs: RawMarquezRun[] | null | undefined;
}): RunHistoryView {
  const rows = (Array.isArray(input.runs) ? input.runs : []).map(normalizeRun);
  // Most-recent first; rows without any instant sink to the bottom (stable-ish).
  rows.sort((a, b) => {
    const ta = rowInstant(a) ?? '';
    const tb = rowInstant(b) ?? '';
    if (ta === tb) return 0;
    return ta > tb ? -1 : 1;
  });
  return {
    namespace: input.namespace,
    job: input.job,
    jobLabel: lineageNodeLabel(input.job),
    runs: rows,
    summary: summarizeRuns(rows),
  };
}

// ── Job list normalization ─────────────────────────────────────────────────────────────────────
export function normalizeJobRef(raw: RawJobRef | null | undefined): JobRefView {
  const j = raw && typeof raw === 'object' ? raw : {};
  const name = str(j.name) ?? '(unnamed)';
  const lr = j.latestRun ?? null;
  return {
    name,
    label: lineageNodeLabel(name),
    type: str(j.type),
    lastRunState: normalizeState(lr?.state),
    lastRunAt: str(lr?.endedAt) ?? str(lr?.startedAt) ?? str(lr?.createdAt) ?? str(j.updatedAt),
  };
}

export function normalizeJobList(raws: RawJobRef[] | null | undefined): JobRefView[] {
  return (Array.isArray(raws) ? raws : []).map(normalizeJobRef);
}

// ── Namespace ownership + tags ────────────────────────────────────────────────────────────────
export function normalizeNamespaceOwnership(
  raw: RawNamespaceOwnership | null | undefined,
): NamespaceOwnershipView | null {
  const n = raw && typeof raw === 'object' ? raw : null;
  const name = str(n?.name);
  if (!name) return null;
  return {
    name,
    ownerName: str(n?.ownerName),
    description: str(n?.description),
    createdAt: str(n?.createdAt),
    updatedAt: str(n?.updatedAt),
    isHidden: n?.isHidden === true,
  };
}

export function normalizeNamespaceList(
  raws: RawNamespaceOwnership[] | null | undefined,
): NamespaceOwnershipView[] {
  return (Array.isArray(raws) ? raws : [])
    .map(normalizeNamespaceOwnership)
    .filter((n): n is NamespaceOwnershipView => n !== null);
}

export function normalizeTag(raw: RawTag | null | undefined): TagView | null {
  const t = raw && typeof raw === 'object' ? raw : null;
  const name = str(t?.name);
  if (!name) return null;
  return { name, description: str(t?.description) };
}

export function normalizeTagList(raws: RawTag[] | null | undefined): TagView[] {
  return (Array.isArray(raws) ? raws : [])
    .map(normalizeTag)
    .filter((t): t is TagView => t !== null);
}

// ── Input validation (routes call these before touching Marquez) ────────────────────────────────
export interface Validated<T> {
  ok: boolean;
  error?: string;
  value?: T;
}

export interface OwnerInput {
  name: string;
  ownerName: string;
  description?: string;
}

/**
 * Validate a namespace-ownership write: both a namespace name and a non-empty owner are required
 * (Marquez requires ownerName on the namespace PUT). Description is optional. Pure, zero-IO.
 */
export function validateOwnerInput(input: {
  name?: unknown;
  ownerName?: unknown;
  description?: unknown;
}): Validated<OwnerInput> {
  const name = str(input.name);
  if (!name) return { ok: false, error: 'namespace name required' };
  const ownerName = str(input.ownerName);
  if (!ownerName) return { ok: false, error: 'ownerName required' };
  const description = str(input.description);
  return {
    ok: true,
    value: { name, ownerName, ...(description ? { description } : {}) },
  };
}

export function validateTagDecl(input: {
  name?: unknown;
  description?: unknown;
}): Validated<{ name: string; description?: string }> {
  const name = str(input.name);
  if (!name) return { ok: false, error: 'tag name required' };
  const description = str(input.description);
  return { ok: true, value: { name, ...(description ? { description } : {}) } };
}

/**
 * Validate a run-history read query: both namespace and job are required. Pure, zero-IO.
 */
export function validateRunQuery(input: {
  namespace?: unknown;
  job?: unknown;
}): Validated<{ namespace: string; job: string }> {
  const namespace = str(input.namespace);
  const job = str(input.job);
  if (!namespace) return { ok: false, error: 'namespace required' };
  if (!job) return { ok: false, error: 'job required' };
  return { ok: true, value: { namespace, job } };
}
