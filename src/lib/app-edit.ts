// ─── PLAIN-LANGUAGE ITERATE — change a governed workflow by describing the change ─────────────────
//
// The north-star persona (a tax/claims/ops person, no engineer) can already CREATE an app from plain
// language (app-compile.ts). They could not CHANGE one: every edit meant opening the builder and
// editing structure by hand. This module closes that loop — "also send it to Slack", "add an approval
// before it sends", "drop the approval step" — and does it as a governed, reviewable change.
//
// SOLID + the same shape as the compiler: EVERYTHING here is PURE (zero imports beyond the spec types
// + the compiler's own sink inference, which is itself pure), so the whole edit rule is unit-testable
// with no model and no I/O. The route owns the I/O; an LLM, when available, only proposes an EditPlan
// — it never mutates the spec directly, so a hallucinated instruction can't invent a binding.
//
// HONESTY RULES (mirroring the compiler's):
//   • An instruction we cannot map is NOT silently ignored — it comes back as an unapplied gap.
//   • We never fabricate a data binding or a recipient. Changing a sink to email without an address
//     records the gap; the author supplies it.
//   • Every applied change is described in plain language so the author can review what happened.

import type { AppSpec, AppStep, HumanStep, OutputStep } from '@/lib/app-model';
import { inferOutputSink, type OutputSinkKind } from '@/lib/app-compile';

/** One structural change. A model may PROPOSE these; only these shapes can ever be applied. */
export type EditOp =
  | { kind: 'set-output-sink'; sink: OutputSinkKind; config?: Record<string, unknown> }
  | { kind: 'add-approval'; label?: string }
  | { kind: 'remove-approval' }
  | { kind: 'rename'; title: string };

export interface EditPlan {
  ops: EditOp[];
  /** Anything the interpreter understood as intent but could not express as an op. */
  unsupported: string[];
}

export interface EditResult {
  spec: AppSpec;
  /** Plain-language description of each change actually applied (for the author's review). */
  changes: string[];
  /** Honest report of what was NOT done and why — never silently dropped. */
  gaps: string[];
}

const APPROVAL_RE = /\b(approval|approve|sign[- ]?off|review step|human review)\b/i;
const REMOVE_RE = /\b(remove|delete|drop|without|no longer|stop)\b/i;
const ADD_RE = /\b(add|insert|require|include|also)\b/i;
// "rename it to X" / "rename to X" / "call it X" / "retitle this to X" — the optional it/this must be
// consumed or it leaks into the captured title.
const RENAME_RE = /\b(?:rename|retitle|call|title)\b\s+(?:it\s+|this\s+|the app\s+)?(?:to\s+)?["']?([^"'.,]{2,60})["']?/i;
const DELIVERY_RE = /\b(send|post|email|deliver|notify|slack|webhook|whatsapp|report)\b/i;

/**
 * Interpret a plain-language instruction into an EditPlan — DETERMINISTICALLY, with no model. PURE.
 * This is the fallback the route uses when no model is available, and the safety net that makes the
 * feature work air-gapped. Order matters: a REMOVE phrasing must win over the ADD keyword that often
 * appears in the same sentence ("no longer require approval").
 */
export function heuristicEditPlan(instruction: string, spec: AppSpec): EditPlan {
  const text = (instruction ?? '').trim();
  const ops: EditOp[] = [];
  const unsupported: string[] = [];
  if (!text) return { ops, unsupported };

  // 1. Rename.
  const rename = RENAME_RE.exec(text);
  if (rename) ops.push({ kind: 'rename', title: rename[1].trim() });

  // 2. Approval add/remove.
  if (APPROVAL_RE.test(text)) {
    if (REMOVE_RE.test(text)) ops.push({ kind: 'remove-approval' });
    else if (ADD_RE.test(text) || /\bbefore\b/i.test(text)) ops.push({ kind: 'add-approval' });
  }

  // 3. Delivery channel. Reuse the compiler's PURE sink inference so "post to #ops" means the same
  // thing here as it does at create time (one rule, not two that drift).
  if (DELIVERY_RE.test(text)) {
    const inferred = inferOutputSink(text);
    if (inferred.sink !== 'console' || /\bconsole\b/i.test(text)) {
      ops.push({
        kind: 'set-output-sink',
        sink: inferred.sink,
        ...(inferred.config ? { config: inferred.config } : {}),
      });
      if (inferred.gap) unsupported.push(inferred.gap);
    }
  }

  if (ops.length === 0) {
    unsupported.push(
      `Could not turn "${text.slice(0, 120)}" into a change. Try naming a delivery channel (for example "also post it to Slack"), or adding/removing an approval step.`,
    );
  }
  return { ops, unsupported };
}

/** Is this step the app's terminal delivery step? PURE. */
function isOutput(step: AppStep): step is OutputStep {
  return step.kind === 'output';
}

/** Mint a step id that cannot collide with an existing one. PURE. */
function freeId(spec: AppSpec, base: string): string {
  const used = new Set((spec.steps ?? []).map((s) => s.id));
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}${n++}`;
  return id;
}

/**
 * Apply an EditPlan to a spec. PURE — returns a NEW spec, never mutates. Each op is applied only if
 * it is meaningful for THIS spec; an op that cannot apply is reported as a gap rather than silently
 * dropped (e.g. "remove the approval" on an app that has none).
 */
export function applyEditPlan(spec: AppSpec, plan: EditPlan): EditResult {
  let steps: AppStep[] = [...(spec.steps ?? [])];
  let edges = [...(spec.edges ?? [])];
  let title = spec.title;
  const changes: string[] = [];
  const gaps: string[] = [...plan.unsupported];

  for (const op of plan.ops) {
    if (op.kind === 'rename') {
      if (op.title.trim() && op.title.trim() !== title) {
        title = op.title.trim();
        changes.push(`Renamed the app to "${title}".`);
      }
      continue;
    }

    if (op.kind === 'set-output-sink') {
      const idx = steps.findIndex(isOutput);
      if (idx < 0) {
        gaps.push('This app has no delivery step to change.');
        continue;
      }
      const current = steps[idx] as OutputStep;
      if (current.sink === op.sink && !op.config) {
        gaps.push(`The result already goes to ${op.sink}.`);
        continue;
      }
      steps[idx] = {
        ...current,
        sink: op.sink,
        ...(op.config ? { config: { ...(current.config ?? {}), ...op.config } } : {}),
      };
      changes.push(`The result now goes to ${op.sink} instead of ${current.sink}.`);
      continue;
    }

    if (op.kind === 'add-approval') {
      if (steps.some((s) => s.kind === 'human')) {
        gaps.push('This app already pauses for a person, so no approval step was added.');
        continue;
      }
      const outIdx = steps.findIndex(isOutput);
      if (outIdx < 0) {
        gaps.push('This app has no delivery step, so there is nothing to gate with an approval.');
        continue;
      }
      const out = steps[outIdx];
      const human: HumanStep = { id: freeId(spec, 'approval'), label: op.label?.trim() || 'Review / approve', kind: 'human' };
      // Insert the approval immediately BEFORE the delivery step and rewire: everything that fed the
      // output now feeds the approval, and the approval feeds the output.
      steps = [...steps.slice(0, outIdx), human, ...steps.slice(outIdx)];
      edges = edges.map((e) => (e.to === out.id ? { ...e, to: human.id } : e));
      edges.push({ from: human.id, to: out.id });
      changes.push(`A person must now approve before the result is sent (${human.label}).`);
      continue;
    }

    // remove-approval
    const human = steps.find((s) => s.kind === 'human');
    if (!human) {
      gaps.push('This app has no approval step to remove.');
      continue;
    }
    const incoming = edges.filter((e) => e.to === human.id).map((e) => e.from);
    const outgoing = edges.filter((e) => e.from === human.id).map((e) => e.to);
    steps = steps.filter((s) => s.id !== human.id);
    edges = edges.filter((e) => e.from !== human.id && e.to !== human.id);
    // Reconnect around the removed step so the graph stays one connected path.
    for (const from of incoming) {
      for (const to of outgoing) {
        if (!edges.some((e) => e.from === from && e.to === to)) edges.push({ from, to });
      }
    }
    changes.push(`Removed the approval step — the result is now sent without waiting for a person.`);
  }

  return { spec: { ...spec, title, steps, edges }, changes, gaps };
}
