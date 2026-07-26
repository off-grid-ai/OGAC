// PURE run-query display model — zero imports, zero I/O, fully unit-testable.
//
// A downstream agent step's query is composed by buildAgentQuery (app-run.ts) as:
//
//   THE REQUEST:
//   <what the person actually submitted — present only when the run had input>
//
//   CONTEXT FROM PRIOR STEPS:
//   - [connector-query] Read 12 row(s). [{...}, {...}]
//   - [agent] <prior answer text>
//
//   TASK: <the step's actual instruction>
//
// Either leading section may be absent: a first agent step has no prior context, and a run with no
// input has no request block. This module is the composer's INVERSE and must stay in step with it —
// when it did not know about THE REQUEST, a request-first query fell through to "one big task string"
// and the operator's Query panel showed the whole composed blob as the title.
//
// Rendering that whole string raw in the run-detail "Query" panel dumps an escaped JSON wall at the
// operator. This module parses the composed query back into its parts — the prior-context blocks and
// the actual TASK — so the UI can show a compact, collapsible "prior context" list and the task
// plainly. A query that was NOT composed this way (a plain user question) parses to just its task
// with no context blocks, so the caller renders it unchanged.

// The exact markers buildAgentQuery emits. Kept in sync with app-run.ts's composer (its inverse).
const REQUEST_HEADER = 'THE REQUEST:';
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
  /**
   * What the person submitted, when the composer included it. Empty string when the run had no input
   * or the query was not composed — so an operator can tell "they asked nothing" from "they asked X".
   */
  request: string;
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
  if (!raw) return { task: '', context: [], request: '' };

  // Peel the optional request block off the front, then parse the remainder exactly as before.
  let rest = raw;
  let request = '';
  if (rest.startsWith(REQUEST_HEADER)) {
    const body = rest.slice(REQUEST_HEADER.length);
    // The request runs until whichever section follows it — prior context, or the task itself.
    const ctxIdx = body.indexOf(`\n\n${CONTEXT_HEADER}`);
    const taskIdx = body.indexOf(TASK_MARKER);
    const end = ctxIdx !== -1 ? ctxIdx : taskIdx !== -1 ? taskIdx : body.length;
    request = body.slice(0, end).trim();
    rest = body.slice(end).trim();
  }

  if (!rest.startsWith(CONTEXT_HEADER)) {
    // No context section. What remains is either `TASK: <x>` or a plain uncomposed query.
    const marker = TASK_MARKER.trim(); // 'TASK:' — the leading blank line was consumed above
    const task = rest.startsWith(marker) ? rest.slice(marker.length).trim() : rest;
    return { task, context: [], request };
  }

  const afterHeader = rest.slice(CONTEXT_HEADER.length);
  const taskIdx = afterHeader.indexOf(TASK_MARKER);
  if (taskIdx === -1) {
    // Header but no TASK marker — treat the whole remainder as context, task unknown.
    return { task: '', context: parseContextBody(afterHeader.trim()), request };
  }
  const contextBody = afterHeader.slice(0, taskIdx).trim();
  const task = afterHeader.slice(taskIdx + TASK_MARKER.length).trim();
  return { task, context: parseContextBody(contextBody), request };
}
