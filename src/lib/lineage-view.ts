// PURE lineage display-model normalizer — zero imports, zero I/O, fully unit-testable.
//
// Marquez's REST API returns loosely-shaped JSON (fields optional, arrays sometimes absent,
// run state under different keys across versions). This module turns the raw namespace / jobs /
// datasets responses into one clean, defensive display model the Lineage read-back surface renders.
// The network read lives in a thin reader (readLineageView, below); this file never fetches.

// ── Raw Marquez shapes (only the fields we read; everything optional/defensive) ───────────────
export interface RawNamespace {
  name?: string;
  ownerName?: string;
}

export interface RawDatasetRef {
  namespace?: string;
  name?: string;
}

export interface RawRun {
  state?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RawJob {
  name?: string;
  type?: string;
  namespace?: string;
  latestRun?: RawRun | null;
  updatedAt?: string;
  inputs?: RawDatasetRef[];
  outputs?: RawDatasetRef[];
}

export interface RawDataset {
  name?: string;
  type?: string;
  namespace?: string;
  updatedAt?: string;
}

// ── Clean display model ──────────────────────────────────────────────────────────────────────
export type RunState = 'COMPLETED' | 'FAILED' | 'RUNNING' | 'ABORTED' | 'NEW' | 'UNKNOWN';

export interface JobView {
  name: string;
  type: string | null;
  lastRunState: RunState;
  inputs: string[];
  outputs: string[];
}

export interface DatasetView {
  name: string;
  type: string | null;
}

export interface LineageEdge {
  from: string;
  to: string;
  kind: 'input' | 'output';
}

export interface LineageCounts {
  namespaces: number;
  jobs: number;
  datasets: number;
  edges: number;
}

export interface LineageView {
  namespace: string | null;
  namespaces: string[];
  jobs: JobView[];
  datasets: DatasetView[];
  edges: LineageEdge[];
  counts: LineageCounts;
  // Most-recent run timestamp seen across jobs (ISO string), or null when none is present.
  lastRun: string | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
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

// Datasets referenced by a job — filtered to real names.
function refNames(refs: RawDatasetRef[] | undefined): string[] {
  return (Array.isArray(refs) ? refs : [])
    .map((r) => str(r?.name))
    .filter((n): n is string => n !== null);
}

// The freshest timestamp on a run, whichever field carries it.
function runTimestamp(run: RawRun | null | undefined): string | null {
  if (!run) return null;
  return str(run.endedAt) ?? str(run.startedAt) ?? str(run.updatedAt) ?? str(run.createdAt);
}

function normalizeJob(raw: RawJob): JobView {
  return {
    name: str(raw?.name) ?? '(unnamed)',
    type: str(raw?.type),
    lastRunState: normalizeState(raw?.latestRun?.state),
    inputs: refNames(raw?.inputs),
    outputs: refNames(raw?.outputs),
  };
}

function normalizeDataset(raw: RawDataset): DatasetView {
  return {
    name: str(raw?.name) ?? '(unnamed)',
    type: str(raw?.type),
  };
}

// ── Dataset detail (single dataset read: GET /namespaces/{ns}/datasets/{ds}) ───────────────────
// Marquez returns the dataset with its current `fields` (schema), `tags`, and a `facets` map
// (schema / dataQualityMetrics / columnLineage / …). All optional & version-variant, so we read
// defensively.
export interface RawDatasetField {
  name?: string;
  type?: string;
  description?: string;
}

export interface RawDatasetDetail {
  name?: string;
  namespace?: string;
  type?: string;
  physicalName?: string;
  sourceName?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  fields?: RawDatasetField[];
  tags?: (string | { name?: string })[];
  facets?: Record<string, unknown> | null;
}

export interface DatasetFieldView {
  name: string;
  type: string | null;
  description: string | null;
}

export interface DatasetDetailView {
  name: string;
  namespace: string | null;
  type: string | null;
  description: string | null;
  updatedAt: string | null;
  fields: DatasetFieldView[];
  tags: string[];
  // Names of the OpenLineage facets present (schema, dataQualityMetrics, columnLineage, …) so the
  // UI can show which enrichments Marquez holds without dumping raw JSON.
  facetNames: string[];
  // rowCount / bytes lifted out of the dataQualityMetrics facet when present.
  rowCount: number | null;
  bytes: number | null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// Normalize one Marquez dataset response into the detail view. Never throws.
export function normalizeDatasetDetail(
  raw: RawDatasetDetail | null | undefined,
): DatasetDetailView | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(raw.name);
  if (!name) return null;

  const fields: DatasetFieldView[] = (Array.isArray(raw.fields) ? raw.fields : [])
    .map((f) => {
      const fname = str(f?.name);
      if (!fname) return null;
      return { name: fname, type: str(f?.type), description: str(f?.description) };
    })
    .filter((f): f is DatasetFieldView => f !== null);

  const tags = (Array.isArray(raw.tags) ? raw.tags : [])
    .map((t) => (typeof t === 'string' ? str(t) : str(t?.name)))
    .filter((t): t is string => t !== null);

  const facets =
    raw.facets && typeof raw.facets === 'object' ? (raw.facets as Record<string, unknown>) : {};
  const facetNames = Object.keys(facets);
  const dq = facets.dataQualityMetrics as
    | { rowCount?: unknown; bytes?: unknown }
    | undefined;

  return {
    name,
    namespace: str(raw.namespace),
    type: str(raw.type),
    description: str(raw.description),
    updatedAt: str(raw.updatedAt) ?? str(raw.createdAt),
    fields,
    tags,
    facetNames,
    rowCount: num(dq?.rowCount),
    bytes: num(dq?.bytes),
  };
}

export interface RawLineageInput {
  namespaces?: RawNamespace[] | null;
  jobs?: RawJob[] | null;
  datasets?: RawDataset[] | null;
  // The chosen/active namespace (the one jobs & datasets were fetched from).
  namespace?: string | null;
}

// Normalize raw Marquez responses into the clean display model. Never throws — any missing or
// malformed field degrades to a safe default rather than crashing the read-back page.
export function normalizeLineage(input: RawLineageInput | null | undefined): LineageView {
  const src = input ?? {};
  const namespaces = (Array.isArray(src.namespaces) ? src.namespaces : [])
    .map((n) => str(n?.name))
    .filter((n): n is string => n !== null);

  const rawJobs = Array.isArray(src.jobs) ? src.jobs : [];
  const jobs = rawJobs.map(normalizeJob);
  const datasets = (Array.isArray(src.datasets) ? src.datasets : []).map(normalizeDataset);

  const edges: LineageEdge[] = [];
  for (const j of jobs) {
    for (const i of j.inputs) edges.push({ from: i, to: j.name, kind: 'input' });
    for (const o of j.outputs) edges.push({ from: j.name, to: o, kind: 'output' });
  }

  let lastRun: string | null = null;
  for (const raw of rawJobs) {
    const ts = runTimestamp(raw?.latestRun);
    if (ts && (lastRun === null || ts > lastRun)) lastRun = ts;
  }

  return {
    namespace: str(src.namespace),
    namespaces,
    jobs,
    datasets,
    edges,
    counts: {
      namespaces: namespaces.length,
      jobs: jobs.length,
      datasets: datasets.length,
      edges: edges.length,
    },
    lastRun,
  };
}
