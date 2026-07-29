// ─── What is happening right now, in a run — pure ────────────────────────────────────────────────────
//
// A governed run reads data, screens it, calls a model and writes a report, so it takes a minute or two of
// real time. For that whole minute the person who submitted a case saw one word: "Running…". Nothing said
// which of their four steps was underway, that anything had succeeded, or that a safety check had run at
// all — the thing that makes this different from a spreadsheet was invisible exactly when it was happening.
//
// This turns the app's own step list plus whatever the run has recorded so far into an ordered progress
// list. Every step the app declares appears, including the ones not started yet, so the shape of the work is
// visible from the first second rather than materialising line by line.

/** A step as the app declares it — the order and the words a person reads. */
export interface ProgressSpecStep {
  id: string;
  kind: string;
  label?: string;
}

/**
 * A step as the run recorded it. Absent from the run ⇒ not started.
 *
 * Both id spellings are accepted deliberately: the executor returns `stepId` on a StepResult, and the
 * persisted run row carries the folded state's `id`. Reading only one of them silently matched nothing on
 * the live path, and every step of a finished run rendered as "not started yet".
 */
export interface ProgressResultStep {
  id?: string;
  stepId?: string;
  kind?: string;
  status?: string;
}

export type ProgressState = 'done' | 'running' | 'pending' | 'waiting' | 'failed';

export interface RunProgressStep {
  label: string;
  state: ProgressState;
}

/** Fallback wording when a step carries no label, by kind — never a raw kind like `connector-query`. */
const KIND_LABEL: Record<string, string> = {
  'connector-query': 'Read the data it needs',
  agent: 'Work out the answer',
  guardrail: 'Safety and privacy checks',
  human: 'Wait for a person to decide',
  output: 'Send the result',
  action: 'Carry out the action',
};

function labelFor(step: ProgressSpecStep): string {
  const label = step.label?.trim();
  if (label) return label;
  return KIND_LABEL[step.kind] ?? 'Step';
}

function stateFor(status: string | undefined): ProgressState | null {
  switch (status) {
    case 'done':
      return 'done';
    case 'error':
      return 'failed';
    case 'awaiting_human':
      return 'waiting';
    default:
      return null;
  }
}

/**
 * The ordered progress of a run.
 *
 * A step the run has recorded takes that record's state. The FIRST unrecorded step after them is `running`
 * while the run is still live — that is the one being worked on. The rest are `pending`.
 *
 * When the run has settled, nothing is marked `running`: an interrupted run showing a permanently spinning
 * step would misreport a stalled run as a working one.
 */
export function runProgress(
  specSteps: readonly ProgressSpecStep[],
  resultSteps: readonly ProgressResultStep[],
  opts: { live: boolean } = { live: false },
): RunProgressStep[] {
  const byId = new Map<string, ProgressResultStep>();
  for (const result of resultSteps) {
    const id = result.stepId ?? result.id;
    if (id) byId.set(id, result);
  }

  let assignedRunning = false;
  const halted = resultSteps.some((result) => result.status === 'error');

  return specSteps.map((step) => {
    const recorded = byId.get(step.id);
    const state = stateFor(recorded?.status);
    if (state) return { label: labelFor(step), state };
    // Not recorded: the next one is what is being worked on, if the run is still going and has not halted.
    if (!assignedRunning && opts.live && !halted) {
      assignedRunning = true;
      return { label: labelFor(step), state: 'running' };
    }
    return { label: labelFor(step), state: 'pending' };
  });
}

/** The one-line summary above the list — what the run is doing, in a person's words. */
export function progressHeadline(progress: readonly RunProgressStep[]): string {
  const running = progress.find((step) => step.state === 'running');
  if (running) return `${running.label}…`;
  if (progress.some((step) => step.state === 'failed')) return 'This run stopped early.';
  if (progress.some((step) => step.state === 'waiting')) return 'Waiting for a decision.';
  if (progress.length > 0 && progress.every((step) => step.state === 'done')) return 'Finished.';
  return 'Starting…';
}
