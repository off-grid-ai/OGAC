// ─── ANOMALY DETECTION over the spine's time-series — PURE, ZERO-IO ───────────────────────────────
//
// M5 ("the platform runs itself"). The observability spine already emits time-series: cost/day,
// latency, error-rate, tokens (finops.daily, audit rollups). Fixed thresholds are the thing the
// roadmap explicitly rejects ("anomaly detection (not fixed thresholds)") — a $50/day budget alarm
// is noise for a $500/day pipeline and silent for a $5/day one. Instead we flag points that deviate
// from the SERIES' OWN recent behaviour.
//
// Two complementary detectors, both distribution-relative:
//   • rolling z-score       — (x − rolling mean) / rolling stddev over a trailing window.
//   • rolling modified z    — 0.6745·(x − rolling median) / MAD. Robust to the very spikes we hunt
//                             (a single outlier barely moves the median/MAD, so it can't mask the
//                             next one), which a mean/stddev detector suffers from.
//
// We default to the MAD detector because a cost/error spike is exactly the case a mean-based method
// hides. Everything here is a pure function of the input series — unit-testable on synthetic data,
// no DB, no clock, no env.

export type AnomalyMethod = 'zscore' | 'mad';
export type AnomalyDirection = 'spike' | 'dip';
export type AnomalySeverity = 'warning' | 'critical';

/** One labelled point of a spine time-series (ISO day/ts + numeric value). */
export interface SeriesPoint {
  /** ISO date/timestamp label for the point (e.g. '2026-07-04'). */
  label: string;
  value: number;
}

export interface AnomalyOptions {
  /** Trailing window used to compute the baseline for each point. Default 7. */
  window?: number;
  /** Deviation (in robust/standard sigmas) at/above which a point is flagged. Default 3. */
  threshold?: number;
  /** Escalate to 'critical' at/above this deviation. Default 5. */
  criticalThreshold?: number;
  /** Which detector to use. Default 'mad' (robust to the spikes we hunt). */
  method?: AnomalyMethod;
  /** When set, only flag deviations in this direction (e.g. error-rate: spikes only). */
  only?: AnomalyDirection;
}

export interface Anomaly {
  index: number;
  label: string;
  value: number;
  /** The baseline the point was compared against (rolling mean or median). */
  baseline: number;
  /** Signed deviation in sigmas/robust-sigmas. Positive = above baseline. */
  deviation: number;
  direction: AnomalyDirection;
  severity: AnomalySeverity;
  method: AnomalyMethod;
}

export interface AnomalyScan {
  method: AnomalyMethod;
  window: number;
  threshold: number;
  points: number;
  anomalies: Anomaly[];
}

const DEFAULTS: Required<Omit<AnomalyOptions, 'only'>> = {
  window: 7,
  threshold: 3,
  criticalThreshold: 5,
  method: 'mad',
};

// Reported deviation for a jump off a perfectly flat baseline (spread === 0). A real deviation is
// undefined (÷0); we treat it as maximal and cap it to a large finite value for JSON/display.
const FLAT_JUMP_DEVIATION = 999;

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stddev(xs: number[], mu: number): number {
  if (xs.length < 2) return 0;
  const variance = xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Median absolute deviation, scaled (×1.4826) to be a consistent estimator of stddev for normal data.
function mad(xs: number[], med: number): number {
  if (xs.length < 2) return 0;
  const absDevs = xs.map((x) => Math.abs(x - med));
  return median(absDevs) * 1.4826;
}

/**
 * Deviation of `value` from a baseline window, in sigmas. Returns the signed deviation and the
 * baseline used. When the window has no spread (constant series) any exact match is deviation 0 and
 * any change is treated as maximal (±Infinity) so a jump off a flat line is still caught.
 */
function deviate(
  value: number,
  window: number[],
  method: AnomalyMethod,
): { deviation: number; baseline: number } {
  if (method === 'mad') {
    const med = median(window);
    const spread = mad(window, med);
    if (spread === 0) {
      return { deviation: value === med ? 0 : value > med ? Infinity : -Infinity, baseline: med };
    }
    return { deviation: (value - med) / spread, baseline: med };
  }
  const mu = mean(window);
  const sd = stddev(window, mu);
  if (sd === 0) {
    return { deviation: value === mu ? 0 : value > mu ? Infinity : -Infinity, baseline: mu };
  }
  return { deviation: (value - mu) / sd, baseline: mu };
}

/**
 * Scan a time-series for anomalies relative to each point's OWN trailing window (never a fixed
 * threshold). Pure. The first `window` points seed the baseline and are never flagged (too little
 * history). A point is an anomaly when |deviation| ≥ threshold; severity escalates at
 * criticalThreshold. `Infinity` deviations (a jump off a perfectly flat baseline) are always flagged
 * and reported as a large finite deviation for display.
 */
export function detectAnomalies(series: SeriesPoint[], options: AnomalyOptions = {}): AnomalyScan {
  const window = Math.max(2, Math.floor(options.window ?? DEFAULTS.window));
  const threshold = options.threshold ?? DEFAULTS.threshold;
  const critical = options.criticalThreshold ?? DEFAULTS.criticalThreshold;
  const method = options.method ?? DEFAULTS.method;
  const only = options.only;

  const anomalies: Anomaly[] = [];
  for (let i = window; i < series.length; i++) {
    const pt = series[i];
    if (!Number.isFinite(pt.value)) continue;
    const win = series
      .slice(i - window, i)
      .map((p) => p.value)
      .filter(Number.isFinite);
    if (win.length < 2) continue;

    const { deviation, baseline } = deviate(pt.value, win, method);
    const absDev = Math.abs(deviation);
    if (absDev < threshold) continue;

    const direction: AnomalyDirection = deviation >= 0 ? 'spike' : 'dip';
    if (only && direction !== only) continue;

    anomalies.push({
      index: i,
      label: pt.label,
      value: pt.value,
      baseline: Number(baseline.toFixed(4)),
      deviation: Number.isFinite(deviation)
        ? Number(deviation.toFixed(2))
        : deviation > 0
          ? FLAT_JUMP_DEVIATION
          : -FLAT_JUMP_DEVIATION,
      direction,
      severity: absDev >= critical ? 'critical' : 'warning',
      method,
    });
  }

  return { method, window, threshold, points: series.length, anomalies };
}

/** Convenience: was the MOST RECENT point anomalous? Drives "something's wrong right now" badges. */
export function latestIsAnomalous(scan: AnomalyScan): Anomaly | null {
  const last = scan.points - 1;
  return scan.anomalies.find((a) => a.index === last) ?? null;
}
