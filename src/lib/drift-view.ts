// PURE drift display-model normalizer — ZERO imports at module top, zero I/O, fully unit-testable
// (mirrors tenancy-policy.ts / lineage-view.ts). The drift adapter (src/lib/adapters/drift.ts)
// answers a normalized DriftReport, but the underlying Evidently collector emits a much looser,
// versioned JSON shape (per-feature drift flags nested under different keys). This module turns
// EITHER of those into one clean, defensive display model the drift read-back surface renders.
// The network read lives in a thin best-effort reader (readDriftView, below); this file never
// fetches. Types are re-declared locally so the pure core stays import-free.

// ── Display model ─────────────────────────────────────────────────────────────────────────────
export type DriftDisplayStatus = 'drift' | 'warning' | 'stable';

export interface FeatureDriftView {
  name: string;
  status: DriftDisplayStatus;
  // Per-feature drift score (PSI / statistical distance). null when the source omitted it.
  score: number | null;
  drifted: boolean;
}

export interface DriftView {
  engine: string;
  status: DriftDisplayStatus;
  // Convenience: true when the overall verdict is a hard drift.
  drifted: boolean;
  // Overall drift score — share of drifted features, or the strongest metric value. null when none.
  driftScore: number | null;
  features: FeatureDriftView[];
  // Windows compared (sample counts), when the source reported them.
  baseline: number;
  current: number;
  note: string | null;
  lastChecked: string | null;
}

// ── Raw input shapes (only fields we read; all optional / defensive) ────────────────────────────
// (a) The drift adapter's normalized DriftReport.
export interface RawDriftMetric {
  name?: string;
  value?: number;
  status?: string;
}

export interface RawDriftReport {
  engine?: string;
  status?: string;
  metrics?: RawDriftMetric[] | null;
  baseline?: number;
  current?: number;
  note?: string;
}

// (b) A raw Evidently report — the loose collector JSON. Evidently nests the dataset-drift result
// and a per-column map; both keys/shapes vary across versions, so every field is optional here.
export interface RawEvidentlyColumn {
  column_name?: string;
  drift_detected?: boolean;
  drift_score?: number;
  stattest_name?: string;
}

export interface RawEvidentlyReport {
  drift_detected?: boolean;
  dataset_drift?: boolean;
  share_drifted?: number;
  share_of_drifted_columns?: number;
  number_of_columns?: number;
  number_of_drifted_columns?: number;
  drift_by_columns?: Record<string, RawEvidentlyColumn> | null;
  columns?: RawEvidentlyColumn[] | null;
  reference_size?: number;
  current_size?: number;
  timestamp?: string;
  engine?: string;
}

export type RawDriftInput = (RawDriftReport & RawEvidentlyReport) | null | undefined;

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function normalizeStatus(v: unknown): DriftDisplayStatus {
  switch ((typeof v === 'string' ? v : '').toLowerCase()) {
    case 'drift':
    case 'drifted':
      return 'drift';
    case 'warning':
    case 'warn':
      return 'warning';
    default:
      return 'stable';
  }
}

// Derive a per-feature status when the source only gives a boolean + score.
function statusFromColumn(col: RawEvidentlyColumn): DriftDisplayStatus {
  if (col.drift_detected) return 'drift';
  const s = num(col.drift_score);
  if (s !== null && s >= 0.1) return 'warning';
  return 'stable';
}

function worst(a: DriftDisplayStatus, b: DriftDisplayStatus): DriftDisplayStatus {
  const rank: Record<DriftDisplayStatus, number> = { stable: 0, warning: 1, drift: 2 };
  return rank[a] >= rank[b] ? a : b;
}

// Is this input an Evidently-style report (per-column drift) rather than an adapter DriftReport?
function looksEvidently(src: RawDriftReport & RawEvidentlyReport): boolean {
  return (
    src.drift_by_columns != null ||
    Array.isArray(src.columns) ||
    src.dataset_drift !== undefined ||
    src.share_of_drifted_columns !== undefined ||
    src.number_of_columns !== undefined
  );
}

// Fallback drift share: explicit counts if present, else the fraction of drifted features, else null.
function shareFromCounts(src: RawEvidentlyReport, features: FeatureDriftView[]): number | null {
  if (num(src.number_of_drifted_columns) !== null && num(src.number_of_columns)) {
    return (src.number_of_drifted_columns ?? 0) / (src.number_of_columns as number);
  }
  if (features.length) return features.filter((f) => f.drifted).length / features.length;
  return null;
}

function featuresFromEvidently(src: RawEvidentlyReport): FeatureDriftView[] {
  let cols: RawEvidentlyColumn[] = [];
  if (Array.isArray(src.columns)) {
    cols = src.columns;
  } else if (src.drift_by_columns != null && typeof src.drift_by_columns === 'object') {
    cols = Object.entries(src.drift_by_columns).map(([k, v]) => ({
      column_name: v?.column_name ?? k,
      ...v,
    }));
  }
  return cols
    .map((c) => {
      const name = str(c?.column_name);
      if (!name) return null;
      return {
        name,
        status: statusFromColumn(c),
        score: num(c?.drift_score),
        drifted: c?.drift_detected === true,
      } satisfies FeatureDriftView;
    })
    .filter((f): f is FeatureDriftView => f !== null);
}

// Metrics on the adapter's DriftReport become "features" too (score_psi, mean_delta, share_drifted).
function featuresFromMetrics(metrics: RawDriftMetric[] | null | undefined): FeatureDriftView[] {
  return (Array.isArray(metrics) ? metrics : [])
    .map((m) => {
      const name = str(m?.name);
      if (!name) return null;
      const status = normalizeStatus(m?.status);
      return {
        name,
        status,
        score: num(m?.value),
        drifted: status === 'drift',
      } satisfies FeatureDriftView;
    })
    .filter((f): f is FeatureDriftView => f !== null);
}

// Normalize EITHER a raw Evidently report OR the drift adapter's DriftReport into the clean display
// model. Never throws — any missing / malformed field degrades to a safe default (stable, empty).
export function normalizeDrift(input: RawDriftInput): DriftView {
  const src = (input ?? {}) as RawDriftReport & RawEvidentlyReport;
  const engine = str(src.engine) ?? 'unknown';
  const note = str(src.note);

  if (looksEvidently(src)) {
    const features = featuresFromEvidently(src);
    const share =
      num(src.share_drifted) ?? num(src.share_of_drifted_columns) ?? shareFromCounts(src, features);
    const hardDrift = src.drift_detected === true || src.dataset_drift === true;
    let status: DriftDisplayStatus;
    if (hardDrift) status = 'drift';
    else if (share !== null && share > 0.1) status = 'warning';
    else status = features.reduce<DriftDisplayStatus>((acc, f) => worst(acc, f.status), 'stable');
    return {
      engine,
      status,
      drifted: status === 'drift',
      driftScore: share === null ? null : Number(share.toFixed(3)),
      features,
      baseline: num(src.reference_size) ?? 0,
      current: num(src.current_size) ?? 0,
      note,
      lastChecked: str(src.timestamp),
    };
  }

  // Adapter DriftReport path.
  const features = featuresFromMetrics(src.metrics);
  const status = normalizeStatus(src.status);
  const strongest = features.reduce<number | null>((max, f) => {
    if (f.score === null) return max;
    if (max === null) return f.score;
    return Math.max(max, f.score);
  }, null);
  return {
    engine,
    status,
    drifted: status === 'drift',
    driftScore: strongest,
    features,
    baseline: num(src.baseline) ?? 0,
    current: num(src.current) ?? 0,
    note,
    lastChecked: null,
  };
}

// ── Thin best-effort reader ─────────────────────────────────────────────────────────────────
// Calls the drift adapter and normalizes its report. Never throws — returns a { data, error }
// envelope so the read-back page always renders (mirrors readLineageView's contract). The dynamic
// import keeps this file's pure core import-free at module load.
export interface DriftReadResult {
  data: DriftView | null;
  error: string | null;
}

// Options forwarded to the drift run — a selection from the standard drift catalog (preset /
// per-column method / drift-share threshold). Kept structural (not importing the adapter type) so
// this file's pure core stays import-free at module load.
export interface ReadDriftOptions {
  orgId?: string;
  preset?: string | null;
  method?: string | null;
  columnMethods?: Record<string, string>;
  driftShareThreshold?: number;
}

export async function readDriftView(options?: ReadDriftOptions): Promise<DriftReadResult> {
  try {
    const { getDrift } = await import('@/lib/adapters/registry');
    const report = await getDrift().analyze(options);
    return { data: normalizeDrift(report as RawDriftInput), error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'drift analysis failed' };
  }
}
