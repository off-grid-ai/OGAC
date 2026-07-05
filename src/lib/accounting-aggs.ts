// PURE usage-&-spend accounting — zero I/O, unit-testable. Owns two halves of a native-OpenSearch
// rollup that attributes token usage + spend PER ACTOR (user), PER PROJECT/ORG, and PER MODEL over a
// time range:
//   1. buildAccountingQuery() — the `size:0` `_search` body: `terms` on actor / project / model, each
//      with `sum` on tokens (and prompt/completion token sub-sums when the docs carry them), plus a
//      per-model sub-terms UNDER each actor/project so spend can be priced correctly per model.
//   2. parseAccountingResponse() — turns the aggregation response into an `Accounting` breakdown,
//      pricing each bucket via the finops per-model rate.
//
// Why the nested per-model sub-terms: cost is per-model (a local model is $0, a cloud model isn't),
// so an actor's spend is Σ over the models THAT actor used of costForTokens(model, tokensOnThatModel).
// A single actor-level token sum can't be priced (it mixes rates). The org total is Σ over the
// top-level by-model buckets. No `fetch`, no `process.env` here — the adapter in accounting.ts wires
// those in. MIRRORS analytics-aggs.ts (buildAggsQuery / parseAggsResponse).
import { costForTokens } from '@/lib/finops';

// Field names in the gateway OpenSearch index (`offgrid-gateway`). `caller` is the actor (the
// console tags agent/chat spend via the caller/user-agent). `project` is present when a call is
// attributed to a project; docs without it fall into an explicit "(unattributed)" bucket. Keyword
// sub-fields are used for exact `terms` aggregation.
const ACTOR_FIELD = 'caller.keyword';
const PROJECT_FIELD = 'project.keyword';
const MODEL_FIELD = 'model.keyword';
export const UNATTRIBUTED = '(unattributed)';

// How many groups to return per dimension. Generous — the parser re-sorts and the page paginates.
const TERMS_SIZE = 1000;
// Per-model sub-terms under each actor/project need only cover the models an entity realistically
// touches; keep it bounded but ample.
const MODEL_SUB_SIZE = 200;

// The token sub-sums we compute per bucket. `tokens` is the always-present total; prompt/completion
// are summed when the docs carry them (missing → sum of 0, harmless).
function tokenSums(): Record<string, unknown> {
  return {
    tokens: { sum: { field: 'tokens' } },
    prompt_tokens: { sum: { field: 'promptTokens' } },
    completion_tokens: { sum: { field: 'completionTokens' } },
    // Per-model split so the parser can price the bucket correctly (see file header).
    by_model: {
      terms: { field: MODEL_FIELD, size: MODEL_SUB_SIZE, order: { model_tokens: 'desc' } },
      aggs: {
        model_tokens: { sum: { field: 'tokens' } },
        prompt_tokens: { sum: { field: 'promptTokens' } },
        completion_tokens: { sum: { field: 'completionTokens' } },
      },
    },
  };
}

/**
 * The single `size:0` accounting query. Time range is injected as ISO strings (pure — no Date.now
 * here). `fromIso`/`toIso` are optional; when both omitted it's a `match_all` over all time.
 */
export function buildAccountingQuery(fromIso?: string, toIso?: string): Record<string, unknown> {
  const range =
    fromIso || toIso
      ? { range: { '@timestamp': { ...(fromIso ? { gte: fromIso } : {}), ...(toIso ? { lte: toIso } : {}) } } }
      : { match_all: {} };
  return {
    size: 0,
    query: range,
    aggs: {
      // Org-wide token totals (prompt/completion/total) across the whole window.
      org_tokens: { sum: { field: 'tokens' } },
      org_prompt_tokens: { sum: { field: 'promptTokens' } },
      org_completion_tokens: { sum: { field: 'completionTokens' } },
      // Top-level per-model split — priced directly, and the source of the org spend total.
      by_model: {
        terms: { field: MODEL_FIELD, size: TERMS_SIZE, order: { model_tokens: 'desc' } },
        aggs: {
          model_tokens: { sum: { field: 'tokens' } },
          prompt_tokens: { sum: { field: 'promptTokens' } },
          completion_tokens: { sum: { field: 'completionTokens' } },
        },
      },
      // Per actor (user) and per project — each with a nested per-model split for correct pricing.
      // `missing` folds docs with no value into the explicit unattributed bucket.
      by_actor: {
        terms: { field: ACTOR_FIELD, size: TERMS_SIZE, missing: UNATTRIBUTED, order: { tokens: 'desc' } },
        aggs: tokenSums(),
      },
      by_project: {
        terms: { field: PROJECT_FIELD, size: TERMS_SIZE, missing: UNATTRIBUTED, order: { tokens: 'desc' } },
        aggs: tokenSums(),
      },
    },
  };
}

// ─── result shapes ───────────────────────────────────────────────────────────
export interface ModelSpend {
  model: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  tokens: number;
  costUsd: number;
}

// A user/project row: attributed tokens + priced spend, plus the per-model split behind it.
export interface AttributedSpend {
  label: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  tokens: number;
  costUsd: number;
  byModel: ModelSpend[];
}

export interface Accounting {
  range: { from: string | null; to: string | null };
  totals: {
    requests: number;
    promptTokens: number;
    completionTokens: number;
    tokens: number;
    costUsd: number;
  };
  byActor: AttributedSpend[];
  byProject: AttributedSpend[];
  byModel: ModelSpend[];
}

// ─── parser ──────────────────────────────────────────────────────────────────
interface OsModelBucket {
  key?: unknown;
  doc_count?: number;
  model_tokens?: { value?: number };
  prompt_tokens?: { value?: number };
  completion_tokens?: { value?: number };
}

interface OsGroupBucket {
  key?: unknown;
  doc_count?: number;
  tokens?: { value?: number };
  prompt_tokens?: { value?: number };
  completion_tokens?: { value?: number };
  by_model?: { buckets?: OsModelBucket[] };
}

interface OsAccountingAggs {
  org_tokens?: { value?: number };
  org_prompt_tokens?: { value?: number };
  org_completion_tokens?: { value?: number };
  by_model?: { buckets?: OsModelBucket[] };
  by_actor?: { buckets?: OsGroupBucket[] };
  by_project?: { buckets?: OsGroupBucket[] };
}

interface OsAccountingResponse {
  hits?: { total?: { value?: number } | number };
  aggregations?: OsAccountingAggs;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

function totalHits(resp: OsAccountingResponse): number {
  const t = resp.hits?.total;
  if (typeof t === 'number') return t;
  return num(t?.value);
}

// One model sub-bucket → a priced ModelSpend row.
function modelSpend(b: OsModelBucket): ModelSpend {
  const model = String(b.key ?? 'unknown');
  const tokens = Math.round(num(b.model_tokens?.value));
  return {
    model,
    requests: num(b.doc_count),
    promptTokens: Math.round(num(b.prompt_tokens?.value)),
    completionTokens: Math.round(num(b.completion_tokens?.value)),
    tokens,
    costUsd: round4(costForTokens(model, tokens)),
  };
}

// A group (actor/project) bucket → an AttributedSpend, priced by summing its per-model split so each
// model is charged at its own rate.
function attributedSpend(b: OsGroupBucket): AttributedSpend {
  const byModel = (b.by_model?.buckets ?? []).map(modelSpend).sort((a, c) => c.costUsd - a.costUsd);
  const costUsd = round4(byModel.reduce((a, m) => a + m.costUsd, 0));
  return {
    label: String(b.key ?? 'unknown'),
    requests: num(b.doc_count),
    promptTokens: Math.round(num(b.prompt_tokens?.value)),
    completionTokens: Math.round(num(b.completion_tokens?.value)),
    tokens: Math.round(num(b.tokens?.value)),
    costUsd,
    byModel,
  };
}

/**
 * Parse an OpenSearch accounting aggregation response into the `Accounting` breakdown. Pure — no
 * I/O. Groups are sorted by spend desc (the terms agg orders by tokens; we re-sort by priced cost).
 */
export function parseAccountingResponse(
  resp: OsAccountingResponse,
  range: { from: string | null; to: string | null } = { from: null, to: null },
): Accounting {
  const aggs = resp.aggregations ?? {};

  const byModel = (aggs.by_model?.buckets ?? []).map(modelSpend).sort((a, b) => b.costUsd - a.costUsd);
  const byActor = (aggs.by_actor?.buckets ?? []).map(attributedSpend).sort((a, b) => b.costUsd - a.costUsd);
  const byProject = (aggs.by_project?.buckets ?? [])
    .map(attributedSpend)
    .sort((a, b) => b.costUsd - a.costUsd);

  // Org spend = Σ over the top-level per-model buckets (each priced at its own rate).
  const costUsd = round4(byModel.reduce((a, m) => a + m.costUsd, 0));

  return {
    range,
    totals: {
      requests: totalHits(resp),
      promptTokens: Math.round(num(aggs.org_prompt_tokens?.value)),
      completionTokens: Math.round(num(aggs.org_completion_tokens?.value)),
      tokens: Math.round(num(aggs.org_tokens?.value)),
      costUsd,
    },
    byActor,
    byProject,
    byModel,
  };
}

// Real-zeros fallback when OpenSearch is unreachable — identical to aggregating over no docs.
export function emptyAccounting(
  range: { from: string | null; to: string | null } = { from: null, to: null },
): Accounting {
  return {
    range,
    totals: { requests: 0, promptTokens: 0, completionTokens: 0, tokens: 0, costUsd: 0 },
    byActor: [],
    byProject: [],
    byModel: [],
  };
}

// ─── time-range presets (pure) ─────────────────────────────────────────────────
// The page/route pass a preset key or explicit from/to; this resolves a key to ISO bounds given a
// clock. Kept pure (nowMs injected) so it's unit-testable. `all` → no bounds.
export type RangePreset = '24h' | '7d' | '30d' | '90d' | 'all';
const PRESET_MS: Record<Exclude<RangePreset, 'all'>, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  '90d': 90 * 86_400_000,
};

export function isRangePreset(v: string): v is RangePreset {
  return v === 'all' || v in PRESET_MS;
}

export function resolveRange(
  preset: RangePreset,
  nowMs: number,
): { from: string | null; to: string | null } {
  if (preset === 'all') return { from: null, to: null };
  return { from: new Date(nowMs - PRESET_MS[preset]).toISOString(), to: null };
}
