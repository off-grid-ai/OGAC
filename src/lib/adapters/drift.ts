import { listEvalRuns } from '@/lib/evals';
import type {
  DriftMetric,
  DriftPort,
  DriftReport,
  DriftRunOptions,
  DriftStatus,
} from './types';

// Drift / degradation detection. The signal is the eval-score history: we split it into a baseline
// window (older runs) and a current window (recent runs) and ask two questions — has the score
// DISTRIBUTION shifted (Population Stability Index) and has the MEAN quality DEGRADED. First-party
// computes both in-process; Evidently ships the same windows to a collector for full test suites.
const EVIDENTLY_URL = process.env.OFFGRID_EVIDENTLY_URL;
const WINDOW = 20; // runs per window when enough history exists
const PSI_BINS = [0, 25, 50, 75, 101]; // score buckets (0..100)

function statusFromPsi(psi: number): DriftStatus {
  if (psi >= 0.25) return 'drift';
  if (psi >= 0.1) return 'warning';
  return 'stable';
}

function statusFromDelta(delta: number): DriftStatus {
  if (delta <= -15) return 'drift';
  if (delta <= -7) return 'warning';
  return 'stable';
}

// Evidently verdict: honor the operator's drift-share threshold `t` when supplied (>0 → banded by
// t and t/2; ===0 → any positive share is drift), else Evidently's own flag / the 0.1 warning band.
function statusFromEvidently(
  driftDetected: boolean,
  share: number,
  t: number | undefined,
): DriftStatus {
  if (driftDetected) return 'drift';
  if (t === undefined) return share > 0.1 ? 'warning' : 'stable';
  if (share >= t && t > 0) return 'drift';
  if (share >= t / 2 && t > 0) return 'warning';
  if (t === 0 && share > 0) return 'drift';
  return 'stable';
}

function worst(a: DriftStatus, b: DriftStatus): DriftStatus {
  const rank: Record<DriftStatus, number> = { stable: 0, warning: 1, drift: 2 };
  return rank[a] >= rank[b] ? a : b;
}

function histogram(scores: number[]): number[] {
  const counts = new Array(PSI_BINS.length - 1).fill(0);
  for (const s of scores) {
    for (let i = 0; i < PSI_BINS.length - 1; i++) {
      if (s >= PSI_BINS[i] && s < PSI_BINS[i + 1]) {
        counts[i] += 1;
        break;
      }
    }
  }
  // Laplace-smooth to avoid div-by-zero / log(0) in PSI.
  const n = scores.length || 1;
  return counts.map((c) => (c + 0.5) / (n + 0.5 * counts.length));
}

// Population Stability Index between a baseline and current score distribution.
function psi(baseline: number[], current: number[]): number {
  const b = histogram(baseline);
  const c = histogram(current);
  let total = 0;
  for (let i = 0; i < b.length; i++) {
    total += (c[i] - b[i]) * Math.log(c[i] / b[i]);
  }
  return Number(total.toFixed(3));
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0;
}

// When a drift-share threshold is supplied (from the standard drift catalog), band the OVERALL
// verdict by the share of drifted metrics against that threshold — mirroring Evidently's dataset
// drift = share-of-drifted-columns rule. The per-metric statuses (PSI, mean-delta) are unchanged;
// only the roll-up verdict responds to the operator's chosen threshold.
function overallStatus(metrics: DriftMetric[], driftShareThreshold?: number): DriftStatus {
  const stat = metrics.reduce<DriftStatus>((acc, m) => worst(acc, m.status), 'stable');
  if (driftShareThreshold === undefined || metrics.length === 0) return stat;
  const share = metrics.filter((m) => m.status === 'drift').length / metrics.length;
  const t = Math.min(1, Math.max(0, driftShareThreshold));
  if (t === 0) return share > 0 ? 'drift' : stat;
  if (share >= t) return 'drift';
  if (share >= t / 2) return worst('warning', stat);
  return stat;
}

function analyzeFirstParty(scores: number[], options?: DriftRunOptions): DriftReport {
  if (scores.length < 4) {
    return {
      engine: 'native',
      status: 'stable',
      metrics: [],
      baseline: 0,
      current: scores.length,
      note: 'Not enough eval-run history yet (need ≥4 runs) — run more evals to enable drift.',
    };
  }
  // listEvalRuns returns newest-first; current = recent window, baseline = the window before it.
  const n = Math.min(WINDOW, Math.floor(scores.length / 2));
  const current = scores.slice(0, n);
  const baseline = scores.slice(n, n * 2);
  const psiValue = psi(baseline, current);
  const delta = Number((mean(current) - mean(baseline)).toFixed(1));
  const metrics: DriftMetric[] = [
    { name: 'score_psi', value: psiValue, status: statusFromPsi(psiValue) },
    { name: 'mean_delta', value: delta, status: statusFromDelta(delta) },
  ];
  const selected = options?.preset ?? options?.method;
  return {
    engine: 'native',
    status: overallStatus(metrics, options?.driftShareThreshold),
    metrics,
    baseline: baseline.length,
    current: current.length,
    note:
      (selected
        ? `Evidently not configured — ran the built-in PSI heuristic for "${selected}". `
        : '') +
      (delta < 0
        ? `Mean eval score down ${Math.abs(delta)} pts vs the prior window.`
        : 'No degradation detected in the eval-score history.'),
  };
}

async function scoreHistory(orgId?: string): Promise<number[]> {
  const runs = await listEvalRuns(WINDOW * 2, orgId);
  return runs.map((r) => r.score);
}

export const nativeDrift: DriftPort = {
  meta: {
    id: 'native',
    capability: 'drift',
    vendor: 'Off Grid AI drift (PSI)',
    license: 'first-party',
    render: 'native',
    description:
      'Population Stability Index + mean-degradation over the eval-score history (always on).',
  },
  async analyze(options?: DriftRunOptions) {
    return analyzeFirstParty(await scoreHistory(options?.orgId), options);
  },
  health: () => Promise.resolve(true),
};

// Evidently — ship the baseline + current windows to an Evidently collector, which runs full
// data/embedding-drift test suites and returns a report. Falls back to first-party PSI if the
// collector is unreachable, so the drift verdict always returns.
interface EvidentlyResponse {
  drift_detected?: boolean;
  share_drifted?: number;
}

export const evidentlyDrift: DriftPort = {
  meta: {
    id: 'evidently',
    capability: 'drift',
    vendor: 'Evidently AI',
    license: 'Apache-2.0',
    render: 'headless',
    embedUrl: EVIDENTLY_URL,
    description:
      'Data / embedding / output drift test suites + degradation monitoring. Runs the bundled Evidently sidecar (compose `qa` profile); falls back to first-party PSI if unreachable.',
  },
  async analyze(options?: DriftRunOptions) {
    const scores = await scoreHistory(options?.orgId);
    if (!EVIDENTLY_URL) return analyzeFirstParty(scores, options);
    try {
      const n = Math.min(WINDOW, Math.floor(scores.length / 2));
      // Forward the standard-catalog selection (preset / per-column method / threshold) to the
      // collector. The collector maps `preset`→the Evidently preset class, `method`/`columnMethods`
      // →per-column stat tests, and `drift_share_threshold`→the dataset-drift rule.
      const res = await fetch(`${EVIDENTLY_URL}/iterate/offgrid`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reference: scores.slice(n, n * 2),
          current: scores.slice(0, n),
          ...(options?.preset ? { preset: options.preset } : {}),
          ...(options?.method ? { method: options.method } : {}),
          ...(options?.columnMethods && Object.keys(options.columnMethods).length
            ? { column_methods: options.columnMethods }
            : {}),
          ...(options?.driftShareThreshold !== undefined
            ? { drift_share_threshold: options.driftShareThreshold }
            : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error('evidently collector error');
      const data = (await res.json()) as EvidentlyResponse;
      const share = data.share_drifted ?? 0;
      // Honor the operator's drift-share threshold for the verdict when supplied; else Evidently's
      // own drift_detected flag / the default 0.1 warning band.
      const t = options?.driftShareThreshold;
      const status: DriftStatus = statusFromEvidently(Boolean(data.drift_detected), share, t);
      const selected = options?.preset ?? options?.method;
      return {
        engine: 'evidently',
        status,
        metrics: [{ name: 'share_drifted', value: Number(share.toFixed(3)), status }],
        baseline: scores.slice(n, n * 2).length,
        current: scores.slice(0, n).length,
        ...(selected ? { note: `Evidently ran "${selected}".` } : {}),
      };
    } catch {
      return analyzeFirstParty(scores, options);
    }
  },
  async health() {
    if (!EVIDENTLY_URL) return false;
    try {
      const res = await fetch(`${EVIDENTLY_URL}/`, { signal: AbortSignal.timeout(2500) });
      return res.ok;
    } catch {
      return false;
    }
  },
};

export const DRIFT_PORTS: DriftPort[] = [nativeDrift, evidentlyDrift];
