// ─── LiteLLM SPEND adapter (I/O) — talks to the DB-backed proxy's analytics endpoints ────────────
//
// Reads LiteLLM's OWN spend store and hands the raw JSON to the PURE litellm-spend.ts for shaping.
// All decision logic (window→dates, normalize, rollups, summary) lives in the pure module; this file
// only does fetch + endpoint-availability handling.
//
// Primary source: GET /spend/logs?start_date=&end_date= (per-request rows — always present on the
// DB-backed proxy). Optional aggregate cross-checks: GET /global/spend/keys and /global/spend/models
// — these vary by LiteLLM version, so a 404/unreachable is reported as typed "unavailable", never a
// page error. This keeps the surface honest about what the deployed version actually exposes.
import {
  assembleSpendView,
  normalizeSpendLogs,
  parseWindow,
  type AggregateAvailability,
  type SpendFinOpsView,
  type SpendLogRow,
  type SpendRange,
  type SpendWindow,
} from '@/lib/litellm-spend';
import {
  LiteLLMHttpError,
  litellmGet,
  litellmHttpConfigured,
  type Fetcher,
} from '@/lib/litellm-http';

/** Fetch the raw per-request spend rows for a window. Throws on proxy/HTTP failure. */
export async function fetchSpendLogs(
  range: SpendRange,
  fetcher: Fetcher = fetch,
  now: number = Date.now(),
): Promise<unknown> {
  const w = parseWindow(range, now);
  const qs = `?start_date=${w.startDate}&end_date=${w.endDate}`;
  return litellmGet(`/spend/logs${qs}`, fetcher);
}

/**
 * Probe an optional aggregate endpoint. 404 (and other HTTP errors) ⇒ typed unavailable rather than
 * a thrown error, so a version that lacks the endpoint degrades gracefully.
 */
async function probeAggregate(
  path: string,
  fetcher: Fetcher,
): Promise<AggregateAvailability> {
  try {
    await litellmGet(path, fetcher);
    return { available: true };
  } catch (e) {
    if (e instanceof LiteLLMHttpError) {
      return { available: false, reason: e.status === 404 ? 'not on this version (404)' : e.message };
    }
    return { available: false, reason: (e as Error).message };
  }
}

/** Which of LiteLLM's optional aggregate rollups the deployed version exposes. */
export async function probeAggregateEndpoints(
  fetcher: Fetcher = fetch,
): Promise<SpendFinOpsView['aggregates']> {
  const [globalSpendKeys, globalSpendModels] = await Promise.all([
    probeAggregate('/global/spend/keys', fetcher),
    probeAggregate('/global/spend/models', fetcher),
  ]);
  return { globalSpendKeys, globalSpendModels };
}

/**
 * The complete FinOps view for a window — NEVER throws into a page. Unconfigured ⇒ configured:false.
 * Proxy unreachable / spend-logs error ⇒ configured:true, live:false, empty view + honest error.
 * A per-request spend read that succeeds ⇒ live:true, real rollups, plus aggregate-endpoint probes.
 */
export async function getSpendFinOpsView(
  range: SpendRange,
  fetcher: Fetcher = fetch,
  now: number = Date.now(),
): Promise<SpendFinOpsView> {
  const window = parseWindow(range, now);
  if (!litellmHttpConfigured()) {
    return assembleSpendView([], window, { configured: false, live: false });
  }
  let raw: unknown;
  try {
    raw = await fetchSpendLogs(range, fetcher, now);
  } catch (e) {
    return assembleSpendView([], window, {
      configured: true,
      live: false,
      error: (e as Error).message,
    });
  }
  const rows = normalizeSpendLogs(raw);
  const aggregates = await probeAggregateEndpoints(fetcher);
  return assembleSpendView(rows, window, { configured: true, live: true, aggregates });
}

export interface SpendLogsResult {
  configured: boolean;
  live: boolean;
  window: SpendWindow;
  rows: SpendLogRow[];
  error?: string;
}

/**
 * The normalized per-request spend rows for the drill-down list — most-recent first. NEVER throws.
 * Same degradation contract as getSpendFinOpsView (unconfigured / unreachable ⇒ empty + honest flag).
 */
export async function getSpendLogRows(
  range: SpendRange,
  fetcher: Fetcher = fetch,
  now: number = Date.now(),
): Promise<SpendLogsResult> {
  const window = parseWindow(range, now);
  if (!litellmHttpConfigured()) return { configured: false, live: false, window, rows: [] };
  try {
    const raw = await fetchSpendLogs(range, fetcher, now);
    const rows = normalizeSpendLogs(raw).sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    return { configured: true, live: true, window, rows };
  } catch (e) {
    return { configured: true, live: false, window, rows: [], error: (e as Error).message };
  }
}
