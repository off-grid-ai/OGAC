// ─── How much retrieved source text a governed step may put in front of the model ─────────────────
//
// LIVE FINDING (2026-08-05, on-prem demo box). Two of the insurer's three demo apps could not finish.
// The measured chain: the node answers a trivial prompt in 3.79s, and the SAME node answered
// Death-Claim Assessment's real prompt in 262s — once — then stopped answering at all. The
// discriminator was not the model, the network, or the timeout (that was a separate bug, see
// inference-timeout.ts). It was PROMPT SIZE: `bhapp_reimb` works because its context is ~2 small rows;
// `app_14940314` folds a whole claim document plus up to six premium rows in, and on CPU-class hardware
// prefill — not generation — dominates, so the node's prefill collapses.
//
// The composer built its context as `hits.map(h => `[i] ${title}: ${snippet}`).join('\n')` with NO
// bound of any kind: however much the retriever returned went into the prompt verbatim. That is a cost
// and reliability defect independently of this box — it is why this is the product-level fix rather
// than buying a bigger node.
//
// WHY THE TRIM IS REPORTED AND NOT SILENT. This is a governance product; its whole claim is that an
// answer is grounded in specific evidence. Quietly dropping half that evidence to fit a budget would
// make the citation list a lie — the run would still say "grounded in 8 sources" while the model saw 3.
// So `boundSourceContext` returns what it included, what it dropped, and what it truncated, and the
// caller is expected to surface that. A bound you cannot see is indistinguishable from data loss.
//
// Pure. Zero IO — the call site does the retrieval and the model call.

/** Per-source character allowance. Roughly a few hundred tokens: enough for a real excerpt. */
export const DEFAULT_MAX_CHARS_PER_SOURCE = 1_200;

/**
 * Total character allowance across all sources. The number that actually protects prefill — a hundred
 * short sources are as expensive as a few long ones, so a per-source cap alone is not a bound.
 */
export const DEFAULT_MAX_TOTAL_CHARS = 8_000;

/**
 * How many sources may be cited at all. Beyond roughly this many, an answer is not "grounded" in any
 * meaningful sense and the marginal source only costs prefill.
 */
export const DEFAULT_MAX_SOURCES = 8;

/** A floor on each cap, so a zeroed or typo'd env var cannot silently send an empty context. */
const MIN_CHARS = 200;
const MIN_SOURCES = 1;

export interface SourceLike {
  title?: string | null;
  snippet?: string | null;
}

export interface SourceBudget {
  maxSources: number;
  maxCharsPerSource: number;
  maxTotalChars: number;
}

export interface BoundedSourceContext {
  /** The text to put in the prompt. Empty string when there were no usable sources. */
  context: string;
  /** How many sources actually reached the model. */
  includedCount: number;
  /** How many were left out entirely because a cap was reached. */
  droppedCount: number;
  /** How many of the included ones had their text shortened. */
  truncatedCount: number;
  /** True when anything at all was dropped or shortened — the flag a caller surfaces to the operator. */
  bounded: boolean;
}

function clampInt(value: number, min: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  return n < min ? min : n;
}

/**
 * Resolve the budget from env, falling back to the defaults.
 *
 * Unparseable values fall back rather than throwing, for the same reason as the inference timeout: an
 * operator's typo must degrade to a sane default, never disable grounding while looking like config.
 */
export function sourceBudgetFromEnv(
  env: Record<string, string | undefined> = process.env,
): SourceBudget {
  return {
    maxSources: clampInt(
      Number(env.OFFGRID_MAX_SOURCES ?? NaN),
      MIN_SOURCES,
      DEFAULT_MAX_SOURCES,
    ),
    maxCharsPerSource: clampInt(
      Number(env.OFFGRID_MAX_SOURCE_CHARS ?? NaN),
      MIN_CHARS,
      DEFAULT_MAX_CHARS_PER_SOURCE,
    ),
    maxTotalChars: clampInt(
      Number(env.OFFGRID_MAX_CONTEXT_CHARS ?? NaN),
      MIN_CHARS,
      DEFAULT_MAX_TOTAL_CHARS,
    ),
  };
}

// Collapse runs of whitespace. A retrieved DB row arrives as pretty-printed JSON whose newlines and
// padding are pure prefill cost and carry no meaning for the model.
function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Mark a shortened excerpt so the model is told the text is partial. Without this the model treats a
 * sentence cut mid-clause as the whole record and can reason confidently from half a fact.
 */
const ELLIPSIS = '…';

/**
 * Build a bounded, numbered source context for a prompt.
 *
 * Citation numbering follows the INPUT order and is contiguous over what was included, so `[3]` in the
 * prompt is the third included source — the caller's citation list must be built from the same included
 * slice, which is why `includedCount` is returned rather than just the string.
 */
export function boundSourceContext(
  sources: readonly SourceLike[],
  budget: SourceBudget = sourceBudgetFromEnv(),
): BoundedSourceContext {
  const usable = sources.filter((s) => tidy(String(s.snippet ?? '')) !== '');
  const empty: BoundedSourceContext = {
    context: '',
    includedCount: 0,
    droppedCount: usable.length,
    truncatedCount: 0,
    bounded: usable.length > 0,
  };
  if (usable.length === 0) return { ...empty, droppedCount: 0, bounded: false };

  const lines: string[] = [];
  let used = 0;
  let included = 0;
  let truncated = 0;

  for (const source of usable) {
    if (included >= budget.maxSources) break;
    const title = tidy(String(source.title ?? '')) || 'source';
    let body = tidy(String(source.snippet ?? ''));
    if (body.length > budget.maxCharsPerSource) {
      body = body.slice(0, budget.maxCharsPerSource) + ELLIPSIS;
      truncated += 1;
    }
    const line = `[${included + 1}] ${title}: ${body}`;
    // Stop BEFORE exceeding the total, so the budget is a real ceiling rather than a suggestion. A
    // source that cannot fit whole is dropped rather than shaved to nothing — a two-word fragment of a
    // claim document is worse than an honest omission.
    if (used + line.length > budget.maxTotalChars && included > 0) break;
    lines.push(line);
    used += line.length + 1; // +1 for the join newline
    included += 1;
  }

  return {
    context: lines.join('\n'),
    includedCount: included,
    droppedCount: usable.length - included,
    truncatedCount: truncated,
    bounded: included < usable.length || truncated > 0,
  };
}

/**
 * A one-line, plain-language note for the operator when the context was bounded — no engine names, no
 * jargon. Returns null when nothing was trimmed, so a caller can append it unconditionally.
 */
export function boundedSourceNote(result: BoundedSourceContext): string | null {
  if (!result.bounded) return null;
  const parts: string[] = [];
  if (result.droppedCount > 0) {
    parts.push(
      `${result.droppedCount} of ${result.includedCount + result.droppedCount} sources were set aside to keep the request answerable`,
    );
  }
  if (result.truncatedCount > 0) {
    parts.push(`${result.truncatedCount} were shortened`);
  }
  return `${parts.join('; ')}.`;
}
