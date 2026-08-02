// ─── The OPERATIONAL half of a compliance evidence pack — PURE ─────────────────────────────────────
//
// ROADMAP §10 Flow 8 step 2: "OGAC collects relevant runs, policies, approvals, versions, sources, and
// evaluations." The pack generated (and signed) correctly, but it carried only control POSTURE and
// governance records — a regulator reading it learned what the controls are, and nothing about what the
// system actually did in the period. Runs, approvals, evaluations and provenance coverage were absent.
//
// These builders turn already-read facts into report sections. Pure, so what a pack claims is
// unit-testable without generating a PDF, and so the same numbers can be asserted in a test the way a
// regulator would read them.
//
// A DELIBERATE RULE THROUGHOUT: a section with nothing in it says so in a sentence naming the period —
// "No human approvals were recorded between 4 Jul and 2 Aug 2026" is evidence. An omitted section is
// not, and an empty table implies the query failed.

import type { ReportSection } from '@/lib/reports/model';

export interface RunEvidence {
  total: number;
  completed: number;
  failed: number;
  awaitingHuman: number;
  /** Runs whose outcome carries a detached provenance signature. */
  signed: number;
}

export interface ApprovalEvidence {
  decisions: number;
  approved: number;
  rejected: number;
  escalated: number;
  /** Distinct people who made a decision — a control is only as real as the people exercising it. */
  reviewers: number;
}

export interface EvaluationEvidence {
  runs: number;
  suites: { engine: string; runs: number; lastScore: number | null; lastAt: string | null }[];
}

const n = (v: number) => v.toLocaleString('en-IN');

/** "4 Jul 2026 – 2 Aug 2026", or "the reporting period" when the window is open-ended. */
export function periodPhrase(from: string | null, to: string | null): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  if (from && to) return `${fmt(from)} – ${fmt(to)}`;
  if (to) return `up to ${fmt(to)}`;
  if (from) return `since ${fmt(from)}`;
  return 'the reporting period';
}

export function runsSection(runs: RunEvidence, period: string): ReportSection {
  if (runs.total === 0) {
    return {
      heading: 'Governed runs in period',
      blocks: [
        {
          type: 'callout',
          tone: 'info',
          text: `No governed runs were executed in ${period}. This is a statement of fact for the period, not an absence of records.`,
        },
      ],
    };
  }
  const coverage = runs.total ? Math.round((runs.signed / runs.total) * 100) : 0;
  return {
    heading: 'Governed runs in period',
    blocks: [
      {
        type: 'keyValues',
        rows: [
          { label: 'Runs executed', value: n(runs.total) },
          { label: 'Completed', value: n(runs.completed) },
          { label: 'Failed or halted', value: n(runs.failed) },
          { label: 'Paused for a human decision', value: n(runs.awaitingHuman) },
          // The number a regulator actually tests: can each outcome be proven un-tampered.
          { label: 'Outcomes with a provenance signature', value: `${n(runs.signed)} (${coverage}%)` },
        ],
      },
    ],
  };
}

export function approvalsSection(approvals: ApprovalEvidence, period: string): ReportSection {
  if (approvals.decisions === 0) {
    return {
      heading: 'Human approvals',
      blocks: [
        {
          type: 'callout',
          tone: 'info',
          text: `No human approval decisions were recorded in ${period}.`,
        },
      ],
    };
  }
  return {
    heading: 'Human approvals',
    blocks: [
      {
        type: 'keyValues',
        rows: [
          { label: 'Decisions recorded', value: n(approvals.decisions) },
          { label: 'Approved', value: n(approvals.approved) },
          { label: 'Rejected', value: n(approvals.rejected) },
          // Escalations are evidence that authority limits BIND — a reviewer met one and handed it on.
          { label: 'Escalated to a higher authority', value: n(approvals.escalated) },
          { label: 'Distinct reviewers', value: n(approvals.reviewers) },
        ],
      },
    ],
  };
}

export function evaluationsSection(evals: EvaluationEvidence, period: string): ReportSection {
  if (!evals.runs) {
    return {
      heading: 'Quality evaluations',
      blocks: [
        {
          type: 'callout',
          tone: 'info',
          text: `No evaluation runs were recorded in ${period}.`,
        },
      ],
    };
  }
  return {
    heading: 'Quality evaluations',
    blocks: [
      {
        type: 'keyValues',
        rows: [
          { label: 'Evaluation runs', value: n(evals.runs) },
          ...evals.suites.map((s) => ({
            label: s.engine,
            // The score AND when it was measured: a good score from six weeks ago is a different fact
            // from a good score from yesterday, and a pack that hides the date invites that confusion.
            value:
              s.lastScore === null
                ? `${n(s.runs)} runs · not scored`
                : `${n(s.runs)} runs · last ${s.lastScore}%${s.lastAt ? ` on ${new Date(s.lastAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`,
          })),
        ],
      },
    ],
  };
}

/** What was REFUSED — the strongest single piece of evidence that enforcement is real. */
export function enforcementSection(
  blocked: { ts: string; actor: string; action: string; outcome: string; resource: string }[],
  period: string,
): ReportSection {
  if (!blocked.length) {
    return {
      heading: 'Enforcement actions',
      blocks: [
        {
          type: 'callout',
          tone: 'info',
          text: `Nothing was blocked or denied in ${period}. No policy refused an action during this window.`,
        },
      ],
    };
  }
  return {
    heading: 'Enforcement actions',
    blocks: [
      {
        type: 'table',
        columns: ['When', 'Who', 'Action', 'Outcome'],
        rows: blocked.slice(0, 12).map((b) => [
          new Date(b.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
          b.actor,
          `${b.action}${b.resource ? ` · ${b.resource}` : ''}`,
          b.outcome,
        ]),
      },
      ...(blocked.length > 12
        ? [
            {
              type: 'callout' as const,
              tone: 'info' as const,
              text: `Showing the 12 most recent of ${n(blocked.length)} enforcement actions; the full ledger is exportable from Governance → Audit.`,
            },
          ]
        : []),
    ],
  };
}
