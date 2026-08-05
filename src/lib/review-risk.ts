import { groupForCurrency } from '@/lib/money';
// ─── Risk and confidence for a pending approval — pure ─────────────────────────────────────────────
//
// Flow 6 in `docs/roadmap-real.md`: *"Reviewer sees risk and confidence."* Nothing implemented it. A
// reviewer was shown the evidence and asked to approve with no signal about how much the decision rests
// on, or how much of it the run could actually establish.
//
// WHAT THIS DELIBERATELY IS NOT: a percentage. Every input here is a discrete fact about the run — a read
// was narrowed or it was not, a step errored or it did not, a sink will fire or it will not. Deriving
// "87% confident" from those would be inventing precision we do not have, which is the same defect as the
// agent inventing a currency symbol. `roadmap-real.md`'s "Honest product state" non-negotiable says the UI
// must never imply a control is active when it is not; a fabricated score implies a measurement.
//
// So both signals are LEVELS, and every level comes with the concrete reasons that produced it. A reviewer
// can disagree with the level and still act on the reasons. The reasons are the product; the level is
// just how they sort.

export type Level = 'low' | 'medium' | 'high';

export interface ReviewSignal {
  level: Level;
  /** The concrete facts behind the level, most important first. Never empty. */
  reasons: string[];
}

export interface ReviewAssessment {
  /** How much rests on this decision: irreversibility and money. */
  risk: ReviewSignal;
  /** How well the run established what it claims: scoped reads, clean steps, real sources. */
  confidence: ReviewSignal;
}

export interface AssessableStep {
  kind: string;
  status: string;
  label?: string;
  detail?: string;
  outcome?: string;
  wouldPerform?: { sink: string } | null;
}

/** Money in the case record, if any — the single biggest driver of how much a decision matters. */
export function caseAmount(caseRecord: Record<string, unknown> | null | undefined): number | null {
  if (!caseRecord) return null;
  for (const [k, v] of Object.entries(caseRecord)) {
    if (!/(^|_)(amount|value|total|premium|sum)$/i.test(k.replace(/([a-z0-9])([A-Z])/g, '$1_$2'))) continue;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Group digits without a currency symbol — the record does not state one (see agent-prompt-rules.ts).
 *
 * Grouped the Indian way (12,00,000 not 1,200,000) via the shared money module, so a bare figure here
 * cannot sit beside a ₹-prefixed lakh-grouped figure on the same screen and disagree about what the
 * number means. The symbol is still omitted deliberately: the record does not say which currency.
 */
function group(n: number): string {
  const [whole, fraction] = Math.abs(n).toString().split('.');
  const g = groupForCurrency(whole, 'INR');
  return `${n < 0 ? '-' : ''}${g}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Assess a run that is waiting on a person.
 *
 * `highValueAt` is the amount above which a decision counts as high-risk. It is a caller-supplied
 * threshold rather than a constant here, because "large" is a tenant's policy question, not ours.
 */
export function assessReview(
  steps: readonly AssessableStep[],
  caseRecord: Record<string, unknown> | null | undefined,
  highValueAt = 100_000,
): ReviewAssessment {
  const pending = steps.filter((s) => s.status === 'queued' || s.status === 'running');
  const willAct = pending.some((s) => s.kind === 'action' || s.kind === 'output');
  const shadowed = steps.some((s) => s.wouldPerform);
  const amount = caseAmount(caseRecord);

  // ── Risk: what happens after approval, and how much rides on it. ──
  const riskReasons: string[] = [];
  let risk: Level = 'low';
  if (willAct) {
    const labels = pending
      .filter((s) => s.kind === 'action' || s.kind === 'output')
      .map((s) => s.label?.trim())
      .filter((l): l is string => !!l);
    riskReasons.push(
      labels.length > 0
        ? `Approving runs the remaining steps, including ${labels.join(' and ')}.`
        : 'Approving runs the remaining steps, which send the result onward.',
    );
    risk = 'medium';
  } else {
    riskReasons.push('Nothing is sent or changed after this decision — it is recorded only.');
  }
  if (amount !== null && amount > 0) {
    riskReasons.push(`This decision covers ${group(amount)}.`);
    if (amount >= highValueAt) {
      riskReasons.push(`That is at or above the ${group(highValueAt)} high-value threshold.`);
      risk = 'high';
    }
  }
  if (shadowed) {
    riskReasons.push('This run is in shadow mode — side effects are recorded, not delivered.');
    risk = 'low';
  }

  // ── Confidence: how well the run established what it is claiming. ──
  const confReasons: string[] = [];
  let confidence: Level = 'high';
  const reads = steps.filter((s) => s.kind === 'connector-query');
  const failed = steps.filter((s) => s.status === 'error');
  // The detail line states the scope either way (case-scope.ts) — that is what makes this checkable.
  const unscoped = reads.filter((s) => /not narrowed to this case/i.test(s.detail ?? ''));

  if (failed.length > 0) {
    confReasons.push(
      `${failed.length} step${failed.length === 1 ? '' : 's'} did not complete, so part of this decision rests on data that was never read.`,
    );
    confidence = 'low';
  }
  if (unscoped.length > 0) {
    confReasons.push(
      `${unscoped.length} source${unscoped.length === 1 ? ' was' : 's were'} read without narrowing to this case, so other records are included.`,
    );
    if (confidence !== 'low') confidence = 'medium';
  }
  if (reads.length === 0) {
    confReasons.push('No source data was read — this decision rests on the request alone.');
    if (confidence !== 'low') confidence = 'medium';
  } else if (failed.length === 0 && unscoped.length === 0) {
    confReasons.push(
      `All ${reads.length} source${reads.length === 1 ? '' : 's'} were read and narrowed to this case.`,
    );
  }
  // An agent that says it could not determine something is the clearest possible confidence signal, and
  // it is easy to miss inside a long answer.
  const hedged = steps.some(
    (s) =>
      s.kind === 'agent' &&
      /\b(not determinable|cannot be determined|could not be determined|no data (?:is )?(?:provided|available)|insufficient (?:data|information))\b/i.test(
        s.outcome ?? '',
      ),
  );
  if (hedged) {
    confReasons.push('The reasoning step reported that it could not determine part of the answer.');
    confidence = 'low';
  }

  return {
    risk: { level: risk, reasons: riskReasons },
    confidence: { level: confidence, reasons: confReasons },
  };
}
