// ─── OPS COPILOT context + prompt builder — PURE, ZERO-IO ─────────────────────────────────────────
//
// M5. The ops copilot answers operator questions over the spine ("why did this run fail", "why is
// cost up this week", "what's drifting"). This file is the PURE half: given already-gathered spine
// context (recent audit events, finops rollup, drift, evals, run errors, anomaly scans), it
// (a) numbers each underlying record as a CITABLE fact `[n]`, and (b) assembles the exact
// system+user prompt sent to the gateway. It never does I/O and never calls the model — so the whole
// context/prompt assembly is unit-testable, and the honesty rule ("cite real records or say no
// data") is enforceable here, not buried in a fetch.
//
// The route (copilot-gateway.ts + the API handler) gathers the context via the existing reader libs
// and passes it in; this module owns the shape + the prompt.

import type { AuditRow } from './audit-log-view';
import type { FinOps } from './finops';
import type { DriftView } from './drift-view';
import type { EvalsView } from './evals-view';
import type { AnomalyScan } from './anomaly';

/** One numbered, citable fact drawn from a real spine record. */
export interface Citation {
  /** 1-based citation index the model must reference as [n]. */
  n: number;
  /** Which spine source this came from. */
  source: 'audit' | 'finops' | 'drift' | 'evals' | 'anomaly';
  /** One-line human-readable statement of the fact. */
  text: string;
  /** Optional link into the console where the operator can verify it. */
  ref?: string;
}

/** Everything the copilot can reason over. Any field may be absent (source unconfigured/empty). */
export interface CopilotContext {
  question: string;
  audit?: { rows: AuditRow[]; configured: boolean };
  finops?: FinOps | null;
  drift?: DriftView | null;
  evals?: EvalsView | null;
  anomalies?: { metric: string; scan: AnomalyScan }[];
}

export interface CopilotPrompt {
  system: string;
  user: string;
  citations: Citation[];
  /** True when there is at least one real fact to reason over. */
  hasData: boolean;
}

const MAX_AUDIT = 25; // cap facts so the prompt stays bounded
const MAX_ANOMALIES = 12;

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Turn gathered spine context into a numbered list of citable facts. Pure. Only emits a citation for
 * a record that actually exists — an unconfigured/empty source contributes nothing (so the model
 * can honestly say "no data"). Order: anomalies (most actionable), then drift, evals, finops, audit.
 */
export function buildCitations(ctx: CopilotContext): Citation[] {
  const cites: Citation[] = [];
  const push = (source: Citation['source'], text: string, ref?: string) =>
    cites.push({ n: cites.length + 1, source, text, ref });

  // Anomalies — the sharpest "something changed" signal.
  if (ctx.anomalies?.length) {
    let count = 0;
    for (const { metric, scan } of ctx.anomalies) {
      for (const a of scan.anomalies) {
        if (count >= MAX_ANOMALIES) break;
        push(
          'anomaly',
          `${metric} ${a.direction} on ${a.label}: value ${a.value} vs baseline ${a.baseline} (${a.severity}, ${Math.abs(a.deviation)}σ ${scan.method}).`,
          '/insights/copilot',
        );
        count++;
      }
    }
  }

  // Drift.
  if (ctx.drift) {
    const d = ctx.drift;
    push(
      'drift',
      `Drift verdict: ${d.status} (score ${d.driftScore ?? 'n/a'}), ${d.features.filter((f) => f.drifted).length}/${d.features.length} features drifted, ${d.baseline} baseline vs ${d.current} current samples${d.lastChecked ? `, checked ${d.lastChecked.slice(0, 19)}` : ''}.`,
      '/insights/drift',
    );
    for (const f of d.features.filter((f) => f.drifted).slice(0, 5)) {
      push('drift', `Feature "${f.name}" drifted (score ${f.score ?? 'n/a'}, ${f.status}).`, '/insights/drift');
    }
  }

  // Evals.
  if (ctx.evals && ctx.evals.totals.runs > 0) {
    const e = ctx.evals;
    push(
      'evals',
      `Evals: ${e.totals.passRate}% pass across ${e.totals.cases} cases in ${e.totals.runs} runs (${e.totals.failed} failed).`,
      '/insights',
    );
    for (const s of e.suites.filter((s) => s.passRate < 100).slice(0, 4)) {
      push('evals', `Suite "${s.engine}": ${s.passRate}% pass (${s.failed}/${s.total} cases failed), last run ${s.lastRun ?? 'n/a'}.`, '/insights');
    }
  }

  // FinOps.
  if (ctx.finops) {
    const f = ctx.finops;
    push(
      'finops',
      `Spend: ${fmtUsd(f.totals.costUsd)} over ${f.totals.requests} requests / ${f.totals.tokens} tokens (${f.totals.localShare}% served locally at $0).`,
      '/insights/finops',
    );
    for (const m of f.byModel.slice(0, 4)) {
      push('finops', `Model "${m.label}": ${fmtUsd(m.costUsd)} over ${m.requests} requests.`, '/insights/finops');
    }
    // Two most recent days for a "cost up this week" answer.
    for (const day of f.daily.slice(-2)) {
      push('finops', `Spend on ${day.day}: ${fmtUsd(day.costUsd)}.`, '/insights/finops');
    }
  }

  // Audit — recent errors/blocks first (most relevant to "why did this fail"), then a few others.
  if (ctx.audit?.configured && ctx.audit.rows.length) {
    const failing = ctx.audit.rows.filter((r) => r.outcome === 'error' || r.outcome === 'blocked');
    const rest = ctx.audit.rows.filter((r) => r.outcome !== 'error' && r.outcome !== 'blocked');
    for (const r of [...failing, ...rest].slice(0, MAX_AUDIT)) {
      push(
        'audit',
        `${r.ts.slice(0, 19)} — ${r.action} by ${r.actor} on ${r.project || 'default'}${r.model ? ` (${r.model})` : ''}: ${r.outcome}${r.runId ? ` [run ${r.runId}]` : ''}.`,
        r.runId ? `/apps` : '/insights/audit',
      );
    }
  }

  return cites;
}

const SYSTEM_PROMPT = [
  'You are the Ops Copilot for the Off Grid AI platform — a private, on-prem AI operations console.',
  'You answer an operator\'s question about the platform\'s health, cost, safety, and reliability.',
  'You are given a NUMBERED list of FACTS drawn from real platform records (audit log, cost rollup,',
  'drift, evals, anomaly detection). Rules you MUST follow:',
  '1. Ground every claim in the provided facts and cite them inline as [n] (matching the fact number).',
  '2. NEVER invent data, numbers, run ids, or causes not present in the facts.',
  '3. If the facts do not contain what is needed to answer, say so plainly ("I don\'t have data on X")',
  '   rather than guessing.',
  '4. Be concise and operator-focused: the likely answer/cause first, then the supporting evidence,',
  '   then a concrete next step if one is warranted.',
  '5. Do not name internal open-source engines; speak in capability terms (e.g. "drift checks", not the tool).',
].join('\n');

/**
 * Build the full copilot prompt (system + user) with numbered citations. Pure. When there are no
 * facts, `hasData` is false and the user prompt says so — the caller can short-circuit and return an
 * honest "no data" answer WITHOUT calling the model.
 */
export function buildCopilotPrompt(ctx: CopilotContext): CopilotPrompt {
  const citations = buildCitations(ctx);
  const hasData = citations.length > 0;

  const factBlock = hasData
    ? citations.map((c) => `[${c.n}] (${c.source}) ${c.text}`).join('\n')
    : '(no platform records are available for this question)';

  const user = [
    `Operator question: ${ctx.question}`,
    '',
    'Facts from the platform spine:',
    factBlock,
    '',
    hasData
      ? 'Answer the question using ONLY these facts, citing them as [n].'
      : 'There are no facts available. Tell the operator you have no data to answer this and suggest what to check or enable.',
  ].join('\n');

  return { system: SYSTEM_PROMPT, user, citations, hasData };
}
