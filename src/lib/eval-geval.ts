// PURE G-Eval (LLM-as-judge) prompt building + response parsing — ZERO imports, ZERO I/O, so it is
// unit-testable in isolation. G-Eval is the non-technical headline of the Evals surface: the operator
// writes a pass rule in PLAIN ENGLISH ("Does the answer cite a policy doc and stay under 200 words?")
// and an LLM judge — reached through the gateway by the runner (the I/O layer) — scores every answer
// against it on a 1..5 scale with a chain-of-thought rationale. This module owns only the pure parts:
//   - buildGEvalPrompt: turn the operator's criteria + the sample into the judge's system+user prompt;
//   - parseGEvalScore: turn the judge's raw text back into a normalized 0..1 score + rationale.
// Honesty bar: there is NO first-party heuristic for arbitrary plain-English criteria — an LLM judge
// is the only faithful scorer. When no gateway/judge is configured the runner must report
// UNAVAILABLE (no fabricated score), which `gEvalUnavailable()` expresses.

// The 1..5 Likert scale DeepEval's G-Eval uses. We ask the judge for an integer 1..5 and normalize.
export const GEVAL_SCALE_MIN = 1;
export const GEVAL_SCALE_MAX = 5;

// What the judge is shown about the answer under test. All fields optional — the criteria decides
// which matter, and we only render the ones present so the prompt stays tight.
export interface GEvalSample {
  question?: string;
  answer?: string;
  contexts?: string[];
  groundTruth?: string;
}

// The two chat messages the runner sends to the gateway judge.
export interface GEvalPrompt {
  system: string;
  user: string;
}

function section(label: string, body: string): string {
  return `${label}:\n${body}\n`;
}

// Build the judge prompt. The criteria is the operator's plain-English rule; we frame the judge to
// reason step-by-step then emit a strict, parseable verdict line so `parseGEvalScore` is robust.
export function buildGEvalPrompt(criteria: string, sample: GEvalSample): GEvalPrompt {
  const crit = criteria.trim() || 'Rate the overall quality of the answer.';
  const system = [
    'You are a strict, fair evaluation judge. You are given evaluation CRITERIA written in plain',
    'language and a model ANSWER (with optional question/context/reference). Judge ONLY how well the',
    `answer meets the criteria. Reason briefly step by step, then output a single integer score from`,
    `${GEVAL_SCALE_MIN} (does not meet the criteria at all) to ${GEVAL_SCALE_MAX} (fully meets it).`,
    'Do not reward verbosity or penalize brevity unless the criteria say so.',
    'End your response with EXACTLY one line in this format and nothing after it:',
    'SCORE: <integer 1-5>',
  ].join(' ');

  const parts: string[] = [section('CRITERIA', crit)];
  if (sample.question) parts.push(section('QUESTION', sample.question));
  if (sample.contexts && sample.contexts.length > 0) {
    parts.push(section('CONTEXT', sample.contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n')));
  }
  if (sample.groundTruth) parts.push(section('REFERENCE ANSWER', sample.groundTruth));
  parts.push(section('ANSWER', sample.answer ?? '(empty)'));
  parts.push('First give your reasoning, then the final "SCORE:" line.');

  return { system, user: parts.join('\n') };
}

export interface GEvalResult {
  // Normalized 0..1 score (the 1..5 Likert mapped to 0..1).
  score: number;
  // The judge's raw integer (1..5) for read-back, or null if we couldn't parse one.
  raw: number | null;
  // A short rationale extracted from the judge text (everything before the SCORE line, trimmed).
  rationale: string;
  // True only when a real integer verdict was parsed. When false the runner must NOT record a score.
  parsed: boolean;
}

function normalize(raw: number): number {
  const clamped = Math.max(GEVAL_SCALE_MIN, Math.min(GEVAL_SCALE_MAX, raw));
  return (clamped - GEVAL_SCALE_MIN) / (GEVAL_SCALE_MAX - GEVAL_SCALE_MIN);
}

// Parse the judge's raw text. Prefers the explicit "SCORE: n" line; falls back to the last integer
// 1..5 that appears in the text. Returns parsed:false when no integer verdict is present, so the
// runner degrades honestly rather than inventing a number.
export function parseGEvalScore(text: string): GEvalResult {
  const t = (text ?? '').trim();
  if (!t) return { score: 0, raw: null, rationale: '', parsed: false };

  let raw: number | null = null;
  const labeled = /SCORE\s*[:=]?\s*([1-5])(?:\s*\/\s*5)?/i.exec(t);
  if (labeled) {
    raw = Number(labeled[1]);
  } else {
    // Fallback: the last standalone 1..5 integer anywhere in the text.
    const nums = t.match(/\b([1-5])\b/g);
    if (nums && nums.length > 0) raw = Number(nums.at(-1));
  }

  if (raw === null || !Number.isFinite(raw)) {
    return { score: 0, raw: null, rationale: t.slice(0, 500), parsed: false };
  }

  // Rationale = text before the SCORE line (or the whole thing if unlabeled), trimmed to a sane length.
  const scoreIdx = t.search(/SCORE\s*[:=]/i);
  const rationale = (scoreIdx > 0 ? t.slice(0, scoreIdx) : t).trim().slice(0, 500);

  return { score: normalize(raw), raw, rationale, parsed: true };
}

// The honest "can't score" result — used by the runner when no gateway judge is configured, or when
// the judge call fails / returns unparseable text. NEVER a fabricated score: parsed=false tells the
// caller to record no score and surface the reason instead.
export function gEvalUnavailable(reason: string): GEvalResult {
  return { score: 0, raw: null, rationale: reason, parsed: false };
}
