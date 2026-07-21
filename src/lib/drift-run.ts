// ─── PURE drift-run attribution + display normalization ─────────────────────────────────────────
//
// Mirrors ragas-run.ts for the drift capability. The drift adapter answers a DriftReport; this
// module builds the RETAINED, engine-attributed record of HOW that verdict was produced — was it a
// genuine Evidently execution or the first-party PSI fallback — and normalizes a persisted blob back
// into a safe display shape. Zero I/O so it is unit-testable; the adapter/route feed it real data.

export type DriftEngine = 'evidently' | 'native';

export interface DriftAttribution {
  engine: DriftEngine;
  /** Evidently library version when the engine actually ran; null for the native PSI path. */
  evidentlyVersion: string | null;
  /** The preset/method the operator selected (e.g. DataDriftPreset), or null for the default. */
  method: string | null;
  /** true ⇒ a real Evidently collector run; false ⇒ first-party PSI (fallback or always-on native). */
  engineProven: boolean;
  /** Overall drift share (0..1) when reported, else null. */
  driftShare: number | null;
  status: 'drift' | 'warning' | 'stable';
  baseline: number; // samples in the baseline window
  current: number; // samples in the current window
  /** Why the run fell back to PSI (Evidently unreachable/errored), or null when it didn't. */
  fallbackReason: string | null;
  note: string;
}

export interface DriftAttributionView {
  engine: string;
  engineLabel: string;
  evidentlyVersion: string | null;
  method: string;
  engineProven: boolean;
  driftShare: number | null; // 0..1
  driftPct: number | null; // 0..100 for display
  status: 'drift' | 'warning' | 'stable';
  baseline: number;
  current: number;
  fallbackReason: string | null;
  note: string;
}

/**
 * Build the retained drift attribution. PURE. engineProven is true ONLY when Evidently actually ran
 * (engine==='evidently' AND no fallbackReason) — so a persisted run can never dress up the PSI
 * fallback as a governed Evidently execution.
 */
export function summarizeDrift(input: {
  engine: DriftEngine;
  evidentlyVersion: string | null;
  method: string | null;
  driftShare: number | null;
  status: 'drift' | 'warning' | 'stable';
  baseline: number;
  current: number;
  fallbackReason: string | null;
  note: string;
}): DriftAttribution {
  const engineProven = input.engine === 'evidently' && !input.fallbackReason;
  return {
    engine: input.engine,
    evidentlyVersion: engineProven ? input.evidentlyVersion : null,
    method: input.method,
    engineProven,
    driftShare: input.driftShare,
    status: input.status,
    baseline: input.baseline,
    current: input.current,
    fallbackReason: input.fallbackReason,
    note: input.note,
  };
}

/**
 * Normalize a persisted attribution blob (jsonb → unknown) into a safe display shape. PURE. Reads
 * every field defensively so a legacy/foreign row never throws in the UI.
 */
export function describeDriftAttribution(
  attr: Record<string, unknown> | null | undefined,
): DriftAttributionView | null {
  if (!attr || typeof attr !== 'object') return null;
  const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const engine = str(attr.engine, 'native');
  const share = num(attr.driftShare);
  const statusRaw = str(attr.status, 'stable');
  const status = statusRaw === 'drift' || statusRaw === 'warning' ? statusRaw : 'stable';
  return {
    engine,
    engineLabel: engine === 'evidently' ? 'Evidently' : 'Off Grid PSI',
    evidentlyVersion: typeof attr.evidentlyVersion === 'string' ? attr.evidentlyVersion : null,
    method: str(attr.method) || 'default drift',
    engineProven: attr.engineProven === true,
    driftShare: share,
    driftPct: share === null ? null : Math.round(share * 100),
    status,
    baseline: num(attr.baseline) ?? 0,
    current: num(attr.current) ?? 0,
    fallbackReason: typeof attr.fallbackReason === 'string' ? attr.fallbackReason : null,
    note: str(attr.note),
  };
}
