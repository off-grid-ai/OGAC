// PURE run-query display model — zero imports, zero I/O, fully unit-testable.
//
// A downstream agent step's query is composed by buildAgentQuery (app-run.ts) as:
//
//   CONTEXT FROM PRIOR STEPS:
//   - [connector-query] Read 12 row(s). [{...}, {...}]
//   - [agent] <prior answer text>
//
//   TASK: <the step's actual instruction>
//
// Rendering that whole string raw in the run-detail "Query" panel dumps an escaped JSON wall at the
// operator. This module parses the composed query back into its parts — the prior-context blocks and
// the actual TASK — so the UI can show a compact, collapsible "prior context" list and the task
// plainly. A query that was NOT composed this way (a plain user question) parses to just its task
// with no context blocks, so the caller renders it unchanged.

// The exact markers buildAgentQuery emits. Kept in sync with app-run.ts's composer (its inverse).
const CONTEXT_HEADER = 'CONTEXT FROM PRIOR STEPS:';
const TASK_MARKER = '\n\nTASK: ';

export interface PriorContextBlock {
  /** The step kind tag the composer wrote in brackets (e.g. 'connector-query', 'agent'). */
  kind: string;
  /** The block's body text (may itself contain JSON — the UI renders it in a collapsible pre). */
  text: string;
}

export interface RunQueryView {
  /** The actual instruction the step was asked to perform. */
  task: string;
  /** Prior-step context blocks fed into the query; empty for a plain (uncomposed) query. */
  context: PriorContextBlock[];
}

/** One `- [kind] body` context line → a block. Lines without the tag attach to the previous block. */
function parseContextBody(body: string): PriorContextBlock[] {
  const blocks: PriorContextBlock[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const m = /^-\s*\[([^\]]*)\]\s*(.*)$/.exec(line);
    if (m) {
      blocks.push({ kind: m[1].trim() || 'step', text: m[2] });
    } else if (blocks.length > 0) {
      // A wrapped continuation of the previous block (e.g. a multi-line JSON dump).
      blocks[blocks.length - 1].text += `\n${line}`;
    }
    // A stray line before any block header is ignored (defensive; composer never emits one).
  }
  return blocks.map((b) => ({ kind: b.kind, text: b.text.trim() }));
}

/**
 * Parse a composed agent-step query into its prior-context blocks + the actual task. A plain query
 * (no CONTEXT header) returns `{ task: <the query>, context: [] }`. Pure, zero-IO, never throws.
 */
export function parseRunQuery(query: string | null | undefined): RunQueryView {
  const raw = (query ?? '').trim();
  if (!raw || !raw.startsWith(CONTEXT_HEADER)) {
    return { task: raw, context: [] };
  }
  const afterHeader = raw.slice(CONTEXT_HEADER.length);
  const taskIdx = afterHeader.indexOf(TASK_MARKER);
  if (taskIdx === -1) {
    // Header but no TASK marker — treat the whole remainder as context, task unknown.
    return { task: '', context: parseContextBody(afterHeader.trim()) };
  }
  const contextBody = afterHeader.slice(0, taskIdx).trim();
  const task = afterHeader.slice(taskIdx + TASK_MARKER.length).trim();
  return { task, context: parseContextBody(contextBody) };
}
