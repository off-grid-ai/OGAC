// ─── STANDARD DRIFT CATALOG (Evidently) — PURE, zero-IO ────────────────────────────────────────────
//
// The founder's ask (same shape as the eval templates + the guardrails catalog): "aren't there a
// bunch of things related to drift that should be common?" — yes. Evidently ships a standard set of
// drift-detection METHODS (per-column statistical tests) and PRESETS (bundled report/test suites).
// An operator shouldn't hand-configure a stat test per column; they pick a preset (or override a
// method per column), set the drift-share threshold, and run.
//
// ── HOW A SELECTION FEEDS THE DRIFT RUN (no new run path) ─────────────────────────────────────────
// Selecting a preset/methods does NOT introduce a new engine. It becomes the `config` passed to the
// EXISTING drift run (getDrift().analyze(config) → the Evidently collector body, or the tuned
// fallback verdict). buildDriftRunConfig() below produces EXACTLY that config object. One run path,
// one verdict shape.
//
// ── HONEST DEGRADATION ────────────────────────────────────────────────────────────────────────────
// Evidently methods/presets are `ready` only when the drift adapter is configured (OFFGRID_ADAPTER_
// DRIFT=evidently AND OFFGRID_EVIDENTLY_URL set — the collector is reachable). Otherwise every item
// degrades to `fallback`: the console's built-in PSI heuristic still runs (it already computes PSI
// over the eval-score history), and the chosen drift-share threshold is still honored. We NEVER
// fabricate a drift score — the fallback returns the real PSI verdict, just without Evidently's
// richer per-column stat tests.
//
// ── GROUNDED — REAL Evidently methods/presets ONLY (do NOT invent) ────────────────────────────────
//   • Drift-detection methods (per-column stat tests), docs.evidentlyai.com — Data Drift algorithm:
//     PSI, KL divergence, Jensen-Shannon distance, Wasserstein distance, Kolmogorov-Smirnov,
//     Chi-square, Z-test, Total Variation Distance (TVD), Cramér's V. Evidently auto-selects a test
//     by column type + sample size; the operator can override per column.
//   • Presets: DataDriftPreset, DataSummaryPreset, DataQualityPreset. include_tests=True adds
//     explicit pass/fail tests (dataset-level share-of-drifted-columns; column-level per-column
//     drift). Dataset drift = share of drifted columns over a threshold.

// ─── Column types a method applies to ──────────────────────────────────────────────────────────────
export type DriftAppliesTo = 'numerical' | 'categorical' | 'text' | 'any';

// ─── Kind + engine ──────────────────────────────────────────────────────────────────────────────────
export type DriftKind = 'method' | 'preset';
export type DriftEngine = 'evidently';

// ─── DriftCatalogItem — one bundled Evidently method or preset ───────────────────────────────────────
export interface DriftCatalogItem {
  /** Stable catalog key (kebab). */
  id: string;
  /** Human name shown on the card. */
  name: string;
  kind: DriftKind;
  /** Plain-language "what it measures / when to pick it" — for a non-technical operator. */
  description: string;
  /** The real Evidently identifier — a stat-test name (e.g. `psi`) or a preset class (`DataDriftPreset`). */
  evidentlyName: string;
  /** Which column types the method applies to (presets apply to `any`). */
  appliesTo: DriftAppliesTo;
  /** Default per-column drift threshold Evidently uses for this test, when it has a standard one. */
  defaultThreshold?: number;
  engine: DriftEngine;
  /** Whether this is a common default choice (drives a "recommended" badge). */
  recommended: boolean;
}

// ─── THE CATALOG — real Evidently stat tests + presets ───────────────────────────────────────────────
export const DRIFT_CATALOG: DriftCatalogItem[] = [
  // ── Presets ─────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'data-drift-preset',
    name: 'Data Drift',
    kind: 'preset',
    engine: 'evidently',
    evidentlyName: 'DataDriftPreset',
    appliesTo: 'any',
    recommended: true,
    description:
      'The standard drift report: share of drifted columns + per-column drift, with a stat test auto-picked per column. Start here.',
  },
  {
    id: 'data-summary-preset',
    name: 'Data Summary',
    kind: 'preset',
    engine: 'evidently',
    evidentlyName: 'DataSummaryPreset',
    appliesTo: 'any',
    recommended: false,
    description:
      'Descriptive stats for every column across the two windows (mean, min/max, missing) — spot shape changes before formal drift.',
  },
  {
    id: 'data-quality-preset',
    name: 'Data Quality',
    kind: 'preset',
    engine: 'evidently',
    evidentlyName: 'DataQualityPreset',
    appliesTo: 'any',
    recommended: false,
    description:
      'Data-quality checks — missing values, out-of-range, constant/duplicated columns — to catch degradation that is not distribution drift.',
  },

  // ── Methods — numerical stat tests ────────────────────────────────────────────────────────────────
  {
    id: 'psi',
    name: 'PSI (Population Stability Index)',
    kind: 'method',
    engine: 'evidently',
    evidentlyName: 'psi',
    appliesTo: 'any',
    defaultThreshold: 0.1,
    recommended: true,
    description:
      'Population Stability Index — the industry-standard drift measure. This is exactly what the built-in fallback computes, so it works even without Evidently.',
  },
  {
    id: 'ks',
    name: 'Kolmogorov–Smirnov test',
    kind: 'method',
    engine: 'evidently',
    evidentlyName: 'ks',
    appliesTo: 'numerical',
    defaultThreshold: 0.05,
    recommended: true,
    description:
      'KS test — Evidently’s default for numerical columns with a large sample. Compares the two distributions; drift when p-value < threshold.',
  },
  {
    id: 'wasserstein',
    name: 'Wasserstein distance',
    kind: 'method',
    engine: 'evidently',
    evidentlyName: 'wasserstein',
    appliesTo: 'numerical',
    defaultThreshold: 0.1,
    recommended: false,
    description:
      'Normalized Wasserstein (earth-mover) distance — how far the numerical distribution has moved. Good when you care about magnitude of shift.',
  },
  {
    id: 'kl-div',
    name: 'Kullback–Leibler divergence',
    kind: 'method',
    engine: 'evidently',
    evidentlyName: 'kl_div',
    appliesTo: 'any',
    defaultThreshold: 0.1,
    recommended: false,
    description:
      'KL divergence — asymmetric information gain between the baseline and current distributions.',
  },
  {
    id: 'jensenshannon',
    name: 'Jensen–Shannon distance',
    kind: 'method',
    engine: 'evidently',
    evidentlyName: 'jensenshannon',
    appliesTo: 'any',
    defaultThreshold: 0.1,
    recommended: false,
    description:
      'Jensen–Shannon distance — a symmetric, bounded (0–1) divergence between the two distributions.',
  },

  // ── Methods — categorical stat tests ──────────────────────────────────────────────────────────────
  {
    id: 'chisquare',
    name: 'Chi-square test',
    kind: 'method',
    engine: 'evidently',
    evidentlyName: 'chisquare',
    appliesTo: 'categorical',
    defaultThreshold: 0.05,
    recommended: true,
    description:
      'Chi-square test — Evidently’s default for categorical columns with a large sample. Drift when p-value < threshold.',
  },
  {
    id: 'z',
    name: 'Z-test',
    kind: 'method',
    engine: 'evidently',
    evidentlyName: 'z',
    appliesTo: 'categorical',
    defaultThreshold: 0.05,
    recommended: false,
    description:
      'Proportion Z-test — Evidently’s default for binary categorical columns with a large sample.',
  },
  {
    id: 'tvd',
    name: 'Total Variation Distance',
    kind: 'method',
    engine: 'evidently',
    evidentlyName: 'TVD',
    appliesTo: 'categorical',
    defaultThreshold: 0.1,
    recommended: false,
    description:
      'Total Variation Distance — the largest difference in category frequencies between the windows.',
  },
  {
    id: 'cramer-v',
    name: 'Cramér’s V',
    kind: 'method',
    engine: 'evidently',
    evidentlyName: 'cramer_von_mises',
    appliesTo: 'categorical',
    defaultThreshold: 0.1,
    recommended: false,
    description:
      'Cramér’s V — association-strength drift for categorical columns (0–1).',
  },
];

// ─── Lookup + grouping (PURE) ────────────────────────────────────────────────────────────────────────
export function getDriftItem(id: string): DriftCatalogItem | null {
  return DRIFT_CATALOG.find((i) => i.id === id) ?? null;
}

export interface DriftKindGroup {
  kind: DriftKind;
  items: DriftCatalogItem[];
}

export const DRIFT_KINDS: DriftKind[] = ['preset', 'method'];
export const DRIFT_APPLIES_TO: DriftAppliesTo[] = ['any', 'numerical', 'categorical', 'text'];

// Group the catalog by kind (presets first, then methods); empty groups are dropped so the browse UI
// never renders an empty heading.
export function catalogByKind(items: DriftCatalogItem[] = DRIFT_CATALOG): DriftKindGroup[] {
  return DRIFT_KINDS.map((kind) => ({
    kind,
    items: items.filter((i) => i.kind === kind),
  })).filter((g) => g.items.length > 0);
}

// ─── Search / filter (PURE) — mirrors the guardrails/eval catalog seam ──────────────────────────────
export interface DriftCatalogFilter {
  q?: string;
  kind?: DriftKind;
  appliesTo?: DriftAppliesTo;
}

export function isDriftFilterActive(filter: DriftCatalogFilter): boolean {
  return Boolean(filter.q?.trim()) || Boolean(filter.kind) || Boolean(filter.appliesTo);
}

function matchesQuery(item: DriftCatalogItem, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    item.name.toLowerCase().includes(needle) ||
    item.description.toLowerCase().includes(needle) ||
    item.evidentlyName.toLowerCase().includes(needle)
  );
}

// Apply search + kind + appliesTo. Preserves input order. Pure — never mutates the input.
// A method with appliesTo `any` matches every appliesTo filter (it works on all column types).
export function filterDriftCatalog(
  items: readonly DriftCatalogItem[],
  filter: DriftCatalogFilter,
): DriftCatalogItem[] {
  const q = filter.q ?? '';
  return items.filter((i) => {
    if (!matchesQuery(i, q)) return false;
    if (filter.kind && i.kind !== filter.kind) return false;
    if (filter.appliesTo && i.appliesTo !== filter.appliesTo && i.appliesTo !== 'any') return false;
    return true;
  });
}

// ─── Engine availability (PURE) ──────────────────────────────────────────────────────────────────────
// Honest per-item availability. Evidently items are `ready` only when the drift adapter is the
// Evidently port AND its collector URL is configured; otherwise `fallback` — the built-in PSI
// heuristic still runs and still honors the drift-share threshold. Nothing here does I/O.
export interface DriftEngineStatus {
  /** The active drift adapter is the Evidently port. */
  evidentlySelected: boolean;
  /** The Evidently collector URL is configured (OFFGRID_EVIDENTLY_URL). */
  evidentlyConfigured: boolean;
}

export type DriftAvailability = 'ready' | 'fallback';

export interface DriftItemAvailability {
  status: DriftAvailability;
  detail: string;
}

export function driftItemAvailability(
  item: DriftCatalogItem,
  status: DriftEngineStatus,
): DriftItemAvailability {
  if (status.evidentlySelected && status.evidentlyConfigured) {
    return { status: 'ready', detail: 'Runs in the on-prem Evidently collector.' };
  }
  // PSI is the one method the fallback actually computes — call that out honestly.
  if (item.evidentlyName === 'psi') {
    return {
      status: 'fallback',
      detail:
        'Evidently is not configured — the built-in PSI heuristic computes exactly this, over the eval-score history.',
    };
  }
  return {
    status: 'fallback',
    detail:
      'Evidently is not configured. The run falls back to the built-in PSI heuristic (this exact stat test needs the Evidently collector).',
  };
}

// ─── Method auto-selection (PURE) ─────────────────────────────────────────────────────────────────────
// Evidently auto-selects a per-column stat test by column type + sample size. We mirror the real
// documented defaults so the UI can show "auto → this test" before the operator overrides:
//   • small sample (< ~1000 rows/window): numerical → KS, categorical → chi-square (binary → Z).
//   • large sample (≥ ~1000): numerical → Wasserstein, categorical → Jensen–Shannon / PSI.
// Grounded in Evidently's "Which test is the default?" table. Never throws.
export const EVIDENTLY_LARGE_SAMPLE = 1000;

export function autoSelectMethodId(
  columnType: 'numerical' | 'categorical',
  sampleSize: number,
  opts: { binary?: boolean } = {},
): string {
  const large = sampleSize >= EVIDENTLY_LARGE_SAMPLE;
  if (columnType === 'numerical') {
    return large ? 'wasserstein' : 'ks';
  }
  // categorical
  if (large) return 'jensenshannon';
  return opts.binary ? 'z' : 'chisquare';
}

// ─── Threshold + verdict (PURE) ───────────────────────────────────────────────────────────────────────
// Dataset drift = share of drifted columns over a threshold. The operator picks the drift-share
// threshold; this maps a computed share → verdict. Mirrors the adapter's own bands (warning at half
// the threshold) so the fallback and the Evidently path read consistently.
export type DriftVerdict = 'stable' | 'warning' | 'drift';

export const DEFAULT_DRIFT_SHARE_THRESHOLD = 0.5;
export const MIN_DRIFT_SHARE_THRESHOLD = 0;
export const MAX_DRIFT_SHARE_THRESHOLD = 1;

// Clamp an operator-entered threshold into [0,1]; a non-finite value falls back to the default.
export function clampDriftShareThreshold(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_DRIFT_SHARE_THRESHOLD;
  return Math.min(MAX_DRIFT_SHARE_THRESHOLD, Math.max(MIN_DRIFT_SHARE_THRESHOLD, n));
}

// Verdict from the share of drifted columns against the operator's threshold. `drift` at/over the
// threshold, `warning` at/over half of it, else `stable`. Never throws.
export function verdictFromShare(
  share: number,
  threshold: number = DEFAULT_DRIFT_SHARE_THRESHOLD,
): DriftVerdict {
  const s = Number.isFinite(share) ? share : 0;
  const t = clampDriftShareThreshold(threshold);
  if (s >= t && t > 0) return 'drift';
  if (s >= t / 2 && t > 0) return 'warning';
  // t === 0 means "any drift is drift"
  if (t === 0 && s > 0) return 'drift';
  return 'stable';
}

// ─── Drift-run config builder (PURE) ──────────────────────────────────────────────────────────────────
// Turn a catalog selection into EXACTLY the config the existing drift run accepts. A preset selection
// carries its preset name; method selections carry per-column (or global) method overrides. The
// drift-share threshold is always included. Same inputs → same config, no I/O.
//
// The shape below is what getDrift().analyze(config) forwards to the Evidently collector body (and
// what the fallback reads `driftShareThreshold` from). Column overrides are optional — an empty map
// means "let Evidently auto-select per column."
export interface DriftMethodOverride {
  column: string;
  /** A catalog method id (e.g. 'ks'); resolved to its evidentlyName in the config. */
  methodId: string;
}

export interface DriftRunConfig {
  /** Evidently preset class name, when a preset was chosen (else null → per-column methods). */
  preset: string | null;
  /** Global stat-test override applied to all columns, when a single method was chosen. */
  method: string | null;
  /** Per-column stat-test overrides (evidentlyName values). */
  columnMethods: Record<string, string>;
  /** Dataset drift-share threshold in [0,1]. */
  driftShareThreshold: number;
}

export interface BuildDriftRunInput {
  /** The chosen catalog item id (preset or method). */
  itemId: string;
  /** Optional per-column overrides (only used when itemId is a preset or omitted). */
  columnOverrides?: DriftMethodOverride[];
  /** Operator drift-share threshold; clamped to [0,1]. */
  driftShareThreshold?: number;
}

// Resolve a catalog item id + optional overrides into a DriftRunConfig. Unknown ids are dropped
// (never throw). If the chosen item is a preset → `preset` set, `method` null. If it's a method →
// `method` set (global), `preset` null. Column overrides always resolve to evidentlyName tokens.
export function buildDriftRunConfig(input: BuildDriftRunInput): DriftRunConfig {
  const item = getDriftItem(input.itemId);
  const columnMethods: Record<string, string> = {};
  for (const ov of input.columnOverrides ?? []) {
    const m = getDriftItem(ov.methodId);
    if (m && m.kind === 'method' && ov.column) columnMethods[ov.column] = m.evidentlyName;
  }
  const preset = item && item.kind === 'preset' ? item.evidentlyName : null;
  const method = item && item.kind === 'method' ? item.evidentlyName : null;
  return {
    preset,
    method,
    columnMethods,
    driftShareThreshold: clampDriftShareThreshold(input.driftShareThreshold),
  };
}
