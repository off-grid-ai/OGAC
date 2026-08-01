// ─── What changed between two versions of an app — PURE ────────────────────────────────────────────
//
// ROADMAP §10 Flow 7: an operator investigating a bad run "compares with previous versions". A list of
// version numbers does not let anyone compare anything — the question is always "what is different, and
// is that difference why the run went wrong". So this turns two AppSpec snapshots into a short list of
// human sentences about what an operator can act on: steps added/removed/reordered, instructions
// rewritten, a domain rebound, the pipeline swapped, the trigger changed, publication toggled.
//
// Deliberately NOT a generic object diff. A JSON diff of two specs produces dozens of lines about keys
// nobody edited and buries the one that matters. Every rule here corresponds to something a person did
// on purpose in the builder.
//
// Zero I/O; every input is already-read JSON.

export interface AppSnapshotStep {
  id: string;
  kind: string;
  label?: string;
  domain?: string;
  agentId?: string;
  agent?: { systemPrompt?: string; model?: string };
  [key: string]: unknown;
}

export interface AppSnapshot {
  title?: string;
  summary?: string;
  visibility?: string;
  pipelineId?: string | null;
  published?: boolean;
  slug?: string | null;
  trigger?: { kind?: string; config?: Record<string, unknown> };
  inputForm?: unknown;
  steps?: AppSnapshotStep[];
  edges?: unknown;
  [key: string]: unknown;
}

export type ChangeKind =
  | 'step-added'
  | 'step-removed'
  | 'step-reordered'
  | 'step-relabelled'
  | 'instructions'
  | 'data-binding'
  | 'pipeline'
  | 'trigger'
  | 'publication'
  | 'input-form'
  | 'metadata';

export interface AppChange {
  kind: ChangeKind;
  /** One sentence, written for an operator, naming the thing that changed. */
  summary: string;
  /** The step this concerns, when it concerns one — so the UI can point at it. */
  stepId?: string;
}

const stepName = (s: AppSnapshotStep) => s.label?.trim() || s.kind;

function promptOf(step: AppSnapshotStep): string {
  const inline = step.agent?.systemPrompt;
  return typeof inline === 'string' ? inline.trim() : '';
}

/** Order-independent view of a step list, keyed by step id. */
function byId(steps: AppSnapshotStep[]): Map<string, AppSnapshotStep> {
  return new Map(steps.map((s) => [s.id, s]));
}

// eslint-disable-next-line complexity
export function diffAppVersions(before: AppSnapshot, after: AppSnapshot): AppChange[] {
  const changes: AppChange[] = [];
  const prevSteps = before.steps ?? [];
  const nextSteps = after.steps ?? [];
  const prev = byId(prevSteps);
  const next = byId(nextSteps);

  for (const step of nextSteps) {
    if (!prev.has(step.id)) {
      changes.push({
        kind: 'step-added',
        stepId: step.id,
        summary: `Step added — ${stepName(step)} (${step.kind})`,
      });
    }
  }
  for (const step of prevSteps) {
    if (!next.has(step.id)) {
      changes.push({
        kind: 'step-removed',
        stepId: step.id,
        summary: `Step removed — ${stepName(step)} (${step.kind})`,
      });
    }
  }

  // Reordering is reported once, not per step: "steps 2 and 3 swapped" is one edit to a person.
  const commonBefore = prevSteps.filter((s) => next.has(s.id)).map((s) => s.id);
  const commonAfter = nextSteps.filter((s) => prev.has(s.id)).map((s) => s.id);
  if (commonBefore.length && commonBefore.join('>') !== commonAfter.join('>')) {
    changes.push({ kind: 'step-reordered', summary: 'Steps were reordered' });
  }

  for (const step of nextSteps) {
    const was = prev.get(step.id);
    if (!was) continue;
    if ((was.label ?? '') !== (step.label ?? '')) {
      changes.push({
        kind: 'step-relabelled',
        stepId: step.id,
        summary: `Renamed — "${stepName(was)}" → "${stepName(step)}"`,
      });
    }
    const before2 = promptOf(was);
    const after2 = promptOf(step);
    if (before2 !== after2) {
      // The instruction text is what actually executes, so the SIZE of the rewrite is the useful signal;
      // the full text belongs in the version viewer, not in a one-line change list.
      const verb = !before2 ? 'added' : !after2 ? 'removed' : 'rewritten';
      changes.push({
        kind: 'instructions',
        stepId: step.id,
        summary: `Instructions ${verb} on ${stepName(step)} (${before2.length} → ${after2.length} characters)`,
      });
    }
    if ((was.domain ?? '') !== (step.domain ?? '')) {
      changes.push({
        kind: 'data-binding',
        stepId: step.id,
        summary: `Data binding changed on ${stepName(step)} — ${was.domain || 'unbound'} → ${step.domain || 'unbound'}`,
      });
    }
    if ((was.agentId ?? '') !== (step.agentId ?? '')) {
      changes.push({
        kind: 'instructions',
        stepId: step.id,
        summary: `Agent changed on ${stepName(step)} — ${was.agentId || 'inline'} → ${step.agentId || 'inline'}`,
      });
    }
  }

  if ((before.pipelineId ?? null) !== (after.pipelineId ?? null)) {
    changes.push({
      kind: 'pipeline',
      summary: `Runs on a different pipeline — ${before.pipelineId ?? 'org default'} → ${after.pipelineId ?? 'org default'}`,
    });
  }
  if ((before.trigger?.kind ?? 'on-demand') !== (after.trigger?.kind ?? 'on-demand')) {
    changes.push({
      kind: 'trigger',
      summary: `Trigger changed — ${before.trigger?.kind ?? 'on-demand'} → ${after.trigger?.kind ?? 'on-demand'}`,
    });
  }
  if (Boolean(before.published) !== Boolean(after.published)) {
    changes.push({
      kind: 'publication',
      summary: after.published ? 'Published' : 'Unpublished',
    });
  }
  if (JSON.stringify(before.inputForm ?? null) !== JSON.stringify(after.inputForm ?? null)) {
    changes.push({ kind: 'input-form', summary: 'The input form changed' });
  }
  if ((before.title ?? '') !== (after.title ?? '')) {
    changes.push({ kind: 'metadata', summary: `Renamed — "${before.title}" → "${after.title}"` });
  }
  if ((before.summary ?? '') !== (after.summary ?? '')) {
    changes.push({ kind: 'metadata', summary: 'Description changed' });
  }
  if ((before.visibility ?? '') !== (after.visibility ?? '')) {
    changes.push({
      kind: 'metadata',
      summary: `Visibility — ${before.visibility} → ${after.visibility}`,
    });
  }
  return changes;
}

/**
 * One line for a version row: what this version did. Empty history is a real state — the first version
 * is not "no changes", it is where the app started.
 */
export function describeChanges(changes: AppChange[], isFirst = false): string {
  if (isFirst) return 'Created';
  if (!changes.length) return 'No functional change';
  if (changes.length === 1) return changes[0].summary;
  return `${changes.length} changes — ${changes[0].summary}`;
}

/**
 * Whether a version differs from the live spec in any way this module considers meaningful. Used to
 * decide whether writing a new version is worth it: re-saving an app with nothing changed should not
 * inflate its history, exactly as re-saving an identical artifact does not.
 */
export function hasMeaningfulChange(before: AppSnapshot, after: AppSnapshot): boolean {
  return diffAppVersions(before, after).length > 0;
}
