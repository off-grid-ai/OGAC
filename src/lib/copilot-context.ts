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

import type { AnomalyScan } from './anomaly';
import { publicLabel } from '@/lib/lineage-labels';
import type { AuditRow } from './audit-log-view';
import { modelLabel } from './model-catalog';
import { selectRelevantFacts } from './copilot-relevance';
import { isPageExplanation } from './guide-events';
import { plainAction, plainOrg, plainRefs } from './plain-identifiers';
import { runHref } from './runs-monitor';
import type { DriftView } from './drift-view';
import type { EvalsView } from './evals-view';
import type { FinOps } from './finops';

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
  /** Whether the model has anything to answer FROM — records, or a screen to describe. */
  answerable: boolean;
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
  // SANITISED AT THE ONE SEAM every citation passes through, so no fact type can be added later
  // without it. Observed live 2026-08-06: the copilot answered `Review the "ragas" and "golden"
  // evaluation suites` and listed `Suite "ragas": 89% pass` — an internal engine name, on a surface
  // built for demo visitors.
  //
  // The system prompt already tells the model not to name engines, and it was obeying: the name was
  // in the FACTS it was given, as a suite id, so repeating it was correct behaviour. An instruction
  // cannot fix data. Cleaning the input is the reliable half, and the two together are defence in
  // depth rather than duplication.
  // Two passes, because they catch different things. `publicLabel` has a VOCABULARY of names we
  // must never say (engines, codenames). `plainRefs` has none — it un-colons any machine reference,
  // whatever it is called, which is what caught `proof:ceiling` sitting in an actor field where no
  // vocabulary list would ever have looked for it.
  const push = (source: Citation['source'], text: string, ref?: string) =>
    cites.push({ n: cites.length + 1, source, text: plainRefs(publicLabel(text)), ref });

  // Anomalies — the sharpest "something changed" signal.
  if (ctx.anomalies?.length) {
    let count = 0;
    for (const { metric, scan } of ctx.anomalies) {
      for (const a of scan.anomalies) {
        if (count >= MAX_ANOMALIES) break;
        push(
          'anomaly',
          `${metric} ${a.direction} on ${a.label}: value ${a.value} vs baseline ${a.baseline} (${a.severity}, ${Math.abs(a.deviation)}σ ${scan.method}).`,
          '/insights/ai/copilot',
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
      '/insights/quality/drift',
    );
    for (const f of d.features.filter((f) => f.drifted).slice(0, 5)) {
      push(
        'drift',
        `Feature "${f.name}" drifted (score ${f.score ?? 'n/a'}, ${f.status}).`,
        '/insights/quality/drift',
      );
    }
  }

  // Evals.
  if (ctx.evals && ctx.evals.totals.runs > 0) {
    const e = ctx.evals;
    push(
      'evals',
      `Evals: ${e.totals.passRate}% pass across ${e.totals.cases} cases in ${e.totals.runs} runs (${e.totals.failed} failed).`,
      '/insights/quality/scorecards',
    );
    for (const s of e.suites.filter((s) => s.passRate < 100).slice(0, 4)) {
      push(
        'evals',
        `Suite "${s.engine}": ${s.passRate}% pass (${s.failed}/${s.total} cases failed), last run ${s.lastRun ?? 'n/a'}.`,
        '/insights/quality/scorecards',
      );
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
      push(
        'finops',
        `Model "${m.label}": ${fmtUsd(m.costUsd)} over ${m.requests} requests.`,
        '/insights/finops',
      );
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
        // Plain language, because the model QUOTES these facts back. A reader who asked what
        // stops a bad answer was told it was blocked "by proof:ceiling on org_suraksha" — true,
        // and unusable. The run id stays: that is the reader's own evidence and the thing they go
        // and look up.
        `${r.ts.slice(0, 19)} — ${plainAction(r.action)} by ${r.actor} in ${plainOrg(r.project)}${r.model ? ` (${modelLabel(r.model)})` : ''}: ${r.outcome}${r.runId ? ` [run ${r.runId}]` : ''}.`,
        // Link to THE run named in the text, not to the list it lives in. The row quoted
        // "[run apprun_eee51b30]" and then sent the reader to the apps directory to go and find it.
        // Falls back to the audit log when the id is not one we can place — a wrong link is worse
        // than a general one.
        (r.runId ? runHref(r.runId) : null) ?? '/governance/evidence/audit',
      );
    }
  }

  return cites;
}

const SYSTEM_PROMPT = [
  'You are the Ops Copilot for the Off Grid AI platform — a private, on-prem AI operations console.',
  "You answer an operator's question about the platform's health, cost, safety, and reliability.",
  'You are given a NUMBERED list of FACTS drawn from real platform records (audit log, cost rollup,',
  'drift, evals, anomaly detection). Rules you MUST follow:',
  '1. Ground every claim in the provided facts and cite them inline as [n] (matching the fact number).',
  '2. NEVER invent data, numbers, run ids, or causes not present in the facts.',
  '3. If the facts do not contain what is needed to answer, say so plainly ("I don\'t have data on X")',
  '   rather than guessing.',
  '4. Be concise and operator-focused: the likely answer/cause first, then the supporting evidence,',
  '   then a concrete next step if one is warranted.',
  '5. Do not name internal open-source engines; speak in capability terms (e.g. "drift checks", not the tool).',
  // LENGTH IS LATENCY, and this is an interactive surface. Measured on the live box: answers were
  // running to ~3,000 tokens and taking 16-43 SECONDS at the model's 43 tok/s, because nothing told
  // it how long to be — "be concise" is not a budget. A reader watching a loader for 40s reads the
  // product as slow no matter how good the answer is, so the limit is stated in words the model can
  // actually count against.
  '6. LENGTH: at most ~150 words. Lead with a one-sentence answer, then at most 4 short bullets of',
  '   evidence. Do not restate the question, do not add a summary, and stop as soon as the question is',
  '   answered — brevity matters more than completeness here.',
].join('\n');

/**
 * Build the full copilot prompt (system + user) with numbered citations. Pure. When there are no
 * facts, `hasData` is false and the user prompt says so — the caller can short-circuit and return an
 * honest "no data" answer WITHOUT calling the model.
 */
export function buildCopilotPrompt(ctx: CopilotContext): CopilotPrompt {
  // SELECT, then answer. Handing a 2B model forty records gathered the same way for every question
  // is what produced "Pipeline data is successfully masked by the service account" — records stitched
  // together because they were in the prompt, not because they related. Keeping only the ones that
  // bear on the question makes the answer better AND faster: a shorter prompt on this hardware is
  // the difference between a considered reply and a long one.
  //
  // Selecting NOTHING is a real outcome, not a failure: the no-data path below already says so
  // honestly and then answers from what the console does. Padding the prompt with a weak match so
  // there is something to cite is exactly how an off-topic record reaches a buyer labelled evidence.
  // "Explain this page" is a different KIND of question and gets NO records at all.
  //
  // Not a performance choice — a correctness one. With records in the prompt the model describes the
  // screen in terms of them: asked about Work ("what needs a decision from you, and the apps that do
  // your work"), it answered "the /work page displays your current pipeline status and recent audit
  // logs", because audit rows were the only concrete thing in front of it. The page's own description
  // is the material for this question; anything else in the prompt competes with it.
  const explainingAPage = isPageExplanation(ctx.question);
  const citations = explainingAPage ? [] : selectRelevantFacts(ctx.question, buildCitations(ctx));
  const hasData = citations.length > 0;

  const factBlock = hasData
    ? citations.map((c) => `[${c.n}] (${c.source}) ${c.text}`).join('\n')
    : explainingAPage
      ? '(none needed — this question is about a screen, not about the records)'
      : '(no platform records are available for this question)';

  const user = [
    `Operator question: ${ctx.question}`,
    '',
    // The facts are gathered the SAME way for every question — recent anomalies, drift, evals, cost,
    // audit — so for a question they do not cover they are not evidence, they are just what happened
    // to be lying around. Asked "what can and cannot leave" on the egress page, the model answered
    // with cost spikes and feature drift and called them "Evidence", because the prompt said answer
    // from these facts and never said what to do when they do not fit.
    //
    // Naming them "recent platform activity" rather than "facts about the question", and requiring an
    // explicit relevance check first, is what stops an off-topic dump being presented as an answer.
    'Records from this platform, selected as the ones most likely to bear on the question:',
    factBlock,
    '',
    hasData
      ? [
          // Selection is keyword-based, so a record can still be a near-miss; the relevance check
          // stays. It is SHORTER now because a small model follows two rules better than six, and
          // the pile it had to reason over has already been cut down for it.
          'Answer the question using only the records above, citing each as [n].',
          "If they do not actually answer it, say \"I don't have records about that\" in one sentence,",
          'then answer from what this console does — plainly, with no citations — and stop.',
        ].join('\n')
      : explainingAPage
        ? // A SCREEN always exists, so "I have no records" is never the answer to "what is this
          // page". Asked to explain Work, the copilot replied "I have no platform records to answer
          // this question yet. Check that the relevant module is configured" — untrue, and
          // unanswerable nonsense to someone who only wanted to know what they were looking at.
          [
            'Explain this screen: what it is for, and what the reader should look at first.',
            // The invention rule is the load-bearing one. Given only a path, the model described Work
            // as "your current active AI model and system status" with a "System Health section" —
            // none of which exists. It is answering about a screen it cannot see, so anything it was
            // not told is a guess, and a confident guess about the product is worse than a short
            // answer.
            'Use ONLY the page name and description in the question. Do NOT name any section, tab,',
            'metric, button or feature you were not told about — if you were not told, leave it out',
            'and keep the answer short.',
            'Do not mention records, data availability, or modules being configured: none of that was',
            'asked and none of it applies. No citations. Three sentences at most.',
          ].join('\n')
        : 'There are no records available. Tell the operator you have no data to answer this and suggest what to check or enable.',
  ].join('\n');

  // `answerable` and `hasData` are NOT the same question, and conflating them is what broke
  // "Explain this page". hasData asks whether we found records; answerable asks whether the model has
  // anything to work with. For a screen, the page description IS the material — so a page explanation
  // is answerable with no records at all, and short-circuiting on hasData skipped the model entirely
  // and returned a canned "I have no platform records" to someone who just asked what a page does.
  return { system: SYSTEM_PROMPT, user, citations, hasData, answerable: hasData || explainingAPage };
}
