// ─── SPEND FROM THE AUDIT LEDGER — attribution that actually survives ─────────────────────────────
//
// Phase 4.11 wants usage + spend "per user, per project/org, per model". The existing reader
// (accounting.ts) aggregates the OpenSearch `offgrid-gateway` index, which is the right shape but the
// wrong source TODAY: those docs ship with `caller="node"` and no `org` for governed runs
// (G-GATEWAY-ATTR-SWEEP), so per-user and per-org spend read as unattributed and governed traffic
// looks free.
//
// Fixing the producer means threading attribution through ~10 gateway call sites — a sweep that is
// explicitly out of scope. But the Postgres audit ledger (`audit_events_v2`) now carries exactly what
// is needed on every governed run: actor, org, project, model, total_tokens and cost_usd. So the
// rollup reads the ledger instead of the index. Same `Accounting` shape, so the existing surface
// renders it unchanged.
//
// SOLID: the SQL does the grouping (the Postgres equivalent of native aggregations — not a JS rollup
// over raw rows), and the PURE assembler below shapes grouped rows into the view model, so every
// pricing/aggregation rule is unit-testable with zero I/O.

import {
  type Accounting,
  type AttributedSpend,
  type ModelSpend,
  emptyAccounting,
  resolveRange,
  type RangePreset,
} from '@/lib/accounting-aggs';

/** One grouped row as the SQL returns it: a (dimension value, model) pair with summed usage. */
export interface LedgerGroupRow {
  /** The actor id, or the project — whichever dimension this grouping is over. */
  label: string | null;
  model: string | null;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  tokens: number;
  costUsd: number;
}

const UNATTRIBUTED = '(unattributed)';
const UNKNOWN_MODEL = '(unknown)';
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/**
 * Fold (label, model) grouped rows into per-label spend with a per-model breakdown. PURE.
 *
 * Cost is SUMMED from the ledger rather than recomputed: each audit row was priced when it was
 * written, with the model that actually served it. Re-pricing a label's combined token total would
 * mix rates across models and silently disagree with the per-run ledger.
 */
export function foldAttributed(rows: readonly LedgerGroupRow[]): AttributedSpend[] {
  const byLabel = new Map<string, AttributedSpend>();

  for (const row of rows) {
    const label = row.label?.trim() || UNATTRIBUTED;
    const model = row.model?.trim() || UNKNOWN_MODEL;
    const entry = byLabel.get(label) ?? {
      label,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      tokens: 0,
      costUsd: 0,
      byModel: [],
    };

    entry.requests += row.requests;
    entry.promptTokens += row.promptTokens;
    entry.completionTokens += row.completionTokens;
    entry.tokens += row.tokens;
    entry.costUsd = round6(entry.costUsd + row.costUsd);
    entry.byModel.push({
      model,
      requests: row.requests,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      tokens: row.tokens,
      costUsd: round6(row.costUsd),
    });
    byLabel.set(label, entry);
  }

  // Biggest spender first — an operator opens this to find who is costing money.
  return [...byLabel.values()]
    .map((e) => ({
      ...e,
      byModel: e.byModel.sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens),
    }))
    .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);
}

/** Collapse grouped rows to a per-model total, ignoring the label dimension. PURE. */
export function foldByModel(rows: readonly LedgerGroupRow[]): ModelSpend[] {
  const byModel = new Map<string, ModelSpend>();
  for (const row of rows) {
    const model = row.model?.trim() || UNKNOWN_MODEL;
    const entry = byModel.get(model) ?? {
      model,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      tokens: 0,
      costUsd: 0,
    };
    entry.requests += row.requests;
    entry.promptTokens += row.promptTokens;
    entry.completionTokens += row.completionTokens;
    entry.tokens += row.tokens;
    entry.costUsd = round6(entry.costUsd + row.costUsd);
    byModel.set(model, entry);
  }
  return [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);
}

/**
 * Assemble the full view model from the two groupings. PURE.
 *
 * Totals come from the ACTOR grouping, not from summing both: every audited call has an actor, but
 * project is optional, so totalling the project rollup would drop project-less calls and understate
 * org spend.
 */
export function buildLedgerAccounting(
  actorRows: readonly LedgerGroupRow[],
  projectRows: readonly LedgerGroupRow[],
  range: { from: string | null; to: string | null },
): Accounting {
  const byActor = foldAttributed(actorRows);
  const byModel = foldByModel(actorRows);
  return {
    range,
    totals: {
      requests: byModel.reduce((n, m) => n + m.requests, 0),
      promptTokens: byModel.reduce((n, m) => n + m.promptTokens, 0),
      completionTokens: byModel.reduce((n, m) => n + m.completionTokens, 0),
      tokens: byModel.reduce((n, m) => n + m.tokens, 0),
      costUsd: round6(byModel.reduce((n, m) => n + m.costUsd, 0)),
    },
    byActor,
    byProject: foldAttributed(projectRows),
    byModel,
  };
}

// ─── thin I/O ─────────────────────────────────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const toRows = (rows: Record<string, unknown>[]): LedgerGroupRow[] =>
  rows.map((r) => ({
    label: r.label == null ? null : String(r.label),
    model: r.model == null ? null : String(r.model),
    requests: num(r.requests),
    promptTokens: num(r.prompt_tokens),
    completionTokens: num(r.completion_tokens),
    tokens: num(r.tokens),
    costUsd: num(r.cost_usd),
  }));

/**
 * Read attributed usage + spend for an org from the audit ledger. Never throws — an unreachable DB
 * degrades to an empty (honest) rollup rather than a wrong one.
 *
 * Only rows that actually recorded tokens are counted: an audit event for a config change has no
 * usage, and including it would inflate the request count with calls that never hit a model.
 */
export async function computeLedgerAccounting(
  preset: RangePreset = 'all',
  orgId = 'default',
): Promise<Accounting> {
  const range = resolveRange(preset, Date.now());
  try {
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');

    const from = range.from ? new Date(range.from) : new Date(0);
    const to = range.to ? new Date(range.to) : new Date(8640000000000000);

    const group = async (dimension: 'actor_id' | 'project') => {
      const col = dimension === 'actor_id' ? sql`actor_id` : sql`project`;
      const res = await db.execute(sql`
        SELECT ${col} AS label,
               model,
               COUNT(*)::int                       AS requests,
               COALESCE(SUM(prompt_tokens), 0)::int      AS prompt_tokens,
               COALESCE(SUM(completion_tokens), 0)::int  AS completion_tokens,
               COALESCE(SUM(total_tokens), 0)::int       AS tokens,
               COALESCE(SUM(cost_usd), 0)::float8        AS cost_usd
        FROM audit_events_v2
        WHERE org = ${orgId}
          AND ts >= ${from} AND ts <= ${to}
          AND COALESCE(total_tokens, 0) > 0
        GROUP BY ${col}, model;
      `);
      return toRows(res.rows as unknown as Record<string, unknown>[]);
    };

    const [actorRows, projectRows] = await Promise.all([group('actor_id'), group('project')]);
    return buildLedgerAccounting(actorRows, projectRows, range);
  } catch {
    return emptyAccounting(range);
  }
}

// ─── which source to believe ──────────────────────────────────────────────────────────────────────

export type AccountingSource = 'ledger' | 'gateway-index' | 'none';

export interface ResolvedAccounting {
  accounting: Accounting;
  source: AccountingSource;
  /**
   * Set when the gateway index HAS traffic but cannot attribute it. Surfacing this stops the
   * accounting page from looking simply "empty" when the real story is "the producer did not stamp
   * who made these calls" (G-GATEWAY-ATTR-SWEEP).
   */
  note?: string;
}

/** True when a rollup can actually answer "who spent this". PURE. */
export function hasAttributedSpend(a: Accounting): boolean {
  return a.byActor.some((row) => row.label !== UNATTRIBUTED && (row.tokens > 0 || row.costUsd > 0));
}

/**
 * Choose the rollup to display. PURE.
 *
 * The ledger wins whenever it can attribute spend, because it records the actor that the console
 * itself resolved for the run. The gateway index stays the fallback: it still sees traffic the
 * console did not originate. If neither can attribute, we say so rather than rendering a confident
 * zero.
 */
export function chooseAccounting(ledger: Accounting, index: Accounting): ResolvedAccounting {
  if (hasAttributedSpend(ledger)) return { accounting: ledger, source: 'ledger' };
  if (hasAttributedSpend(index)) return { accounting: index, source: 'gateway-index' };
  const indexSawTraffic = index.totals.requests > 0;
  return {
    accounting: indexSawTraffic ? index : ledger,
    source: indexSawTraffic ? 'gateway-index' : 'none',
    note: indexSawTraffic
      ? 'Model traffic was recorded but not attributed to a user, so per-user spend cannot be shown for it.'
      : undefined,
  };
}
