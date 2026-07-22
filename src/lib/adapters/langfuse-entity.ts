// ─── Langfuse per-entity trace source — the I/O adapter behind an interface ─────────────────────────
//
// This is the ONLY impure seam for per-entity AI observability. It fetches the recent trace/score
// firehose (and one trace's spans) from Langfuse's public REST API, then hands the raw rows to the
// PURE shaping in `observability-entity.ts` (filter to the entity + window, roll up cost/latency/
// quality, build the trace-detail waterfall). No shaping logic lives here — one rule, one place (DRY).
//
// Langfuse doesn't index traces by our entity id server-side, so attribution is best-effort over a
// recent page: the source pulls the recent traces + windowed scores, and the pure layer narrows them
// to THIS entity (by the `pipeline:<id>` tag substring, or an explicit normalized-run-id set for
// app/agent runs) AND to the selected time window. Honest by construction — an entity with no matching
// trace in the window returns a real-empty view, never a fabricated one.
//
// The interface (`EntityTraceSource`) is what routes/tests depend on; `langfuseEntitySource` is the
// live implementation. Tests inject a fake source to exercise the orchestration without the network.
import {
  fetchScores,
  type LangfuseObservation,
  type LangfuseScore,
  type LangfuseTrace,
  langfuseReadConfigured,
  listObservations,
  listTraces,
  resolveRange,
} from '@/lib/langfuse';
import {
  type EntityMatch,
  type EntityObservability,
  emptyEntityObservability,
  filterTracesByWindow,
  filterTracesForEntity,
  filterScoresForTraces,
  rollupEntityObservability,
  shapeTraceDetail,
  toTraceRow,
  type TraceDetail,
} from '@/lib/observability-entity';

// How wide a recent page to pull. Langfuse caps the public list at 100; entity attribution is
// best-effort over that recent window (documented on the page as an honest limitation).
const RECENT_LIMIT = 100;

// ─── the port ───────────────────────────────────────────────────────────────────────────────────────
export interface EntityWindowData {
  configured: boolean;
  traces: LangfuseTrace[];
  scores: LangfuseScore[];
  error?: string;
}

export interface EntityTraceSource {
  /** Sync "is trace read-back configured on this deployment?" (env-derived). */
  configured(): boolean;
  /** Recent traces + windowed scores — the raw firehose the pure layer narrows. Never throws. */
  fetchWindow(fromIso: string, toIso: string): Promise<EntityWindowData>;
  /** One trace's spans/generations. Never throws (empty on failure). */
  fetchObservations(traceId: string): Promise<LangfuseObservation[]>;
}

// ─── live implementation over langfuse.ts ─────────────────────────────────────────────────────────
export const langfuseEntitySource: EntityTraceSource = {
  configured: () => langfuseReadConfigured(),
  async fetchWindow(fromIso, toIso) {
    if (!langfuseReadConfigured()) return { configured: false, traces: [], scores: [] };
    const [traces, scores] = await Promise.allSettled([
      listTraces(RECENT_LIMIT),
      fetchScores(fromIso, toIso, RECENT_LIMIT),
    ]);
    const errors: string[] = [];
    if (traces.status === 'rejected') errors.push((traces.reason as Error).message);
    if (scores.status === 'rejected') errors.push((scores.reason as Error).message);
    return {
      configured: true,
      traces: traces.status === 'fulfilled' ? traces.value : [],
      scores: scores.status === 'fulfilled' ? scores.value : [],
      error: errors.length ? [...new Set(errors)].join('; ') : undefined,
    };
  },
  async fetchObservations(traceId) {
    if (!langfuseReadConfigured()) return [];
    try {
      return await listObservations(traceId);
    } catch {
      return [];
    }
  },
};

// ─── orchestration: entity observability view (list + rollups) ────────────────────────────────────
export interface EntityObservabilityResult {
  configured: boolean;
  range: string;
  view: EntityObservability;
  error?: string;
}

// Impure orchestration — thin: resolve the window, fetch via the source, delegate ALL shaping to the
// pure layer. Reused by the pipeline/app/agent OBSERVE surfaces and the fetch route (DRY seam).
export async function getEntityObservability(
  match: EntityMatch,
  range: string | undefined,
  source: EntityTraceSource = langfuseEntitySource,
  now: Date = new Date(),
): Promise<EntityObservabilityResult> {
  const win = resolveRange(range, now);
  if (!source.configured()) {
    return { configured: false, range: win.range, view: emptyEntityObservability(match.id) };
  }
  const data = await source.fetchWindow(win.fromIso, win.toIso);
  const windowed = filterTracesByWindow(data.traces, win.fromIso, win.toIso);
  const view = rollupEntityObservability(windowed, data.scores, match);
  return { configured: true, range: win.range, view, error: data.error };
}

// ─── orchestration: one trace's detail (waterfall + scores) ───────────────────────────────────────
export interface EntityTraceDetailResult {
  configured: boolean;
  /** false when the trace exists but doesn't belong to this entity (honest cross-entity scoping). */
  belongs: boolean;
  detail: TraceDetail | null;
  error?: string;
}

// Impure orchestration for the deep-linked trace detail. Verifies the trace belongs to the entity
// (so one entity can't inspect another's trace), then shapes the detail from its row + observations +
// scores. All shaping is the pure `shapeTraceDetail`.
export async function getEntityTraceDetail(
  match: EntityMatch,
  traceId: string,
  range: string | undefined,
  source: EntityTraceSource = langfuseEntitySource,
  now: Date = new Date(),
): Promise<EntityTraceDetailResult> {
  const win = resolveRange(range, now);
  if (!source.configured()) return { configured: false, belongs: false, detail: null };

  const data = await source.fetchWindow(win.fromIso, win.toIso);
  const matched = filterTracesForEntity(data.traces, match);
  const traceMeta = matched.find((t) => t.id === traceId) ?? null;
  // The trace id must be one of the entity's matched traces (or explicitly in its trace-id set) —
  // otherwise refuse to render it under this entity.
  const inIdSet = (match.traceIds ?? []).includes(traceId);
  if (!traceMeta && !inIdSet) {
    return { configured: true, belongs: false, detail: null, error: data.error };
  }

  const entityScores = filterScoresForTraces(
    data.scores,
    matched.map((t) => t.id),
  );
  const observations = await source.fetchObservations(traceId);
  const row = traceMeta ? toTraceRow(traceMeta, entityScores) : null;
  const detail = shapeTraceDetail(traceId, row, observations, entityScores);
  return { configured: true, belongs: true, detail, error: data.error };
}
