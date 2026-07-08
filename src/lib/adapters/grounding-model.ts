// PURE grounding logic for the model-NLI (entailment-grade) adapter. Zero I/O, zero imports of
// the gateway — every function here is a plain data→data transform so it is fully unit-testable
// (feed it a fabricated model response, assert the score). The adapter in `grounding.ts` supplies
// the network model call and injects it; this module owns splitting claims, building the
// entailment prompt, parsing the model's JSON reply, and scoring it into a GroundingResult.
//
// Why a MODEL adapter at all (closes G-F3): the lexical floor scores by token overlap, so a
// PARAPHRASE of a source ("The central bank sets borrowing costs" vs "The RBI sets the repo
// rate") shares few tokens and scores 0/unsupported even though it is entailed. An NLI/entailment
// model judges semantic support, so an entailed paraphrase scores supported. The lexical adapter
// stays the always-on floor; this is the entailment upgrade selected by OFFGRID_ADAPTER_GROUNDING=model.
import type { ClaimVerdict, GroundingResult, GroundingSource } from './types';

// Bound on how many claims we send to the model in one call (cost + context safety). Kept identical
// to the lexical adapter so the two agree on what "truncated" means.
export const MAX_CLAIMS = 12;

/** Split an answer into atomic claims — one per sentence. Pure, deterministic. */
export function splitClaims(answer: string): string[] {
  return answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * A single model verdict as it appears in the model's JSON reply, before validation. Every field
 * is unknown/optional because the model is untrusted output — `scoreVerdicts` validates it.
 */
export interface RawModelVerdict {
  index?: unknown;
  supported?: unknown;
  score?: unknown;
  source?: unknown;
}

/** The model function the adapter injects: given the built prompt, return the model's raw text. */
export type EntailmentModel = (prompt: string) => Promise<string>;

/**
 * Build the constrained NLI/entailment prompt. Numbered sources (S1, S2, …) and numbered claims,
 * with a strict instruction to return per-claim JSON verdicts naming the supporting snippet. Pure.
 */
export function buildEntailmentPrompt(claims: string[], sources: GroundingSource[]): string {
  const src = sources.length
    ? sources.map((s, i) => `[S${i + 1}${s.id ? ` ${s.id}` : ''}] ${s.text}`).join('\n')
    : '(no sources provided)';
  const cl = claims.map((c, i) => `${i}. ${c}`).join('\n');
  return (
    `You are a strict natural-language-inference (entailment) checker. Decide, for each CLAIM, ` +
    `whether it is ENTAILED (logically supported) by the SOURCES. A claim is supported even when ` +
    `it PARAPHRASES a source — judge meaning, not word overlap. If the sources do not support a ` +
    `claim, it is unsupported.\n\n` +
    `SOURCES:\n${src}\n\nCLAIMS:\n${cl}\n\n` +
    `Return ONLY JSON of the form ` +
    `{"verdicts":[{"index":<claim number>,"supported":<true|false>,` +
    `"score":<0..1 entailment confidence>,"source":"S<n>"}]}. ` +
    `Include one verdict per claim. Do not add prose outside the JSON.`
  );
}

/** Pull the assistant text out of an OpenAI-compatible chat completion body. Pure, tolerant. */
export function extractCompletionText(body: unknown): string {
  const content = (body as { choices?: { message?: { content?: string } }[] })?.choices?.[0]
    ?.message?.content;
  return typeof content === 'string' ? content : '';
}

/**
 * Parse the model's raw text into an array of raw verdicts. Tolerant: accepts a bare JSON object,
 * a `{"verdicts":[…]}` wrapper, or a JSON array; strips ```json fences and surrounding prose by
 * locating the first `{`/`[`. Returns [] on anything it cannot parse (never throws) — the caller
 * turns a missing verdict into a safe unsupported default.
 */
export function parseModelVerdicts(raw: string): RawModelVerdict[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  const cleaned = stripFences(raw);
  const json = extractJson(cleaned);
  if (json === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { verdicts?: unknown })?.verdicts)
      ? (parsed as { verdicts: unknown[] }).verdicts
      : null;
  if (!arr) return [];
  return arr.filter((v): v is RawModelVerdict => typeof v === 'object' && v !== null);
}

function stripFences(raw: string): string {
  return raw.replace(/```(?:json)?/gi, '').trim();
}

// Grab the first balanced-looking JSON object/array substring so leading/trailing prose is ignored.
function extractJson(text: string): string | null {
  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');
  const starts = [firstObj, firstArr].filter((i) => i >= 0);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  return text.slice(start, end + 1);
}

// Clamp any untrusted numeric score into [0,1]; non-numbers become 0.
function clampScore(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Number(Math.min(1, Math.max(0, n)).toFixed(2));
}

// Coerce a raw source label to a clean "S#"/id string, or undefined.
function cleanSource(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length ? s : undefined;
}

/**
 * Score the model's raw verdicts against the claims we asked about. PURE. For each claim (by its
 * index) we find the model's verdict; a supported verdict must be BOTH `supported:true` AND clear
 * the entailment threshold, so a low-confidence "true" doesn't sneak through. A missing/garbled
 * verdict is a SAFE default: unsupported, score 0 (grounding fails closed — we never claim support
 * we can't back). The aggregate is the fraction of supported claims, 0..100.
 */
export function scoreVerdicts(
  claims: string[],
  raw: RawModelVerdict[],
  truncated: number,
  threshold = 0.5,
): GroundingResult {
  const byIndex = new Map<number, RawModelVerdict>();
  for (const v of raw) {
    const idx = typeof v.index === 'number' ? v.index : Number(v.index);
    if (Number.isInteger(idx)) byIndex.set(idx, v);
  }

  const verdicts: ClaimVerdict[] = claims.map((claim, i) => {
    const v = byIndex.get(i);
    if (!v) return { claim, supported: false, score: 0, source: undefined };
    const modelSaysTrue = v.supported === true;
    // A model that says supported:true but omits/garbles the score still earns credit at the
    // threshold — its explicit verdict shouldn't be dropped just because the number was unusable.
    const rawScore = clampScore(v.score);
    const score = modelSaysTrue && rawScore === 0 ? threshold : rawScore;
    // Supported requires BOTH an explicit true AND clearing the threshold, so a low-confidence
    // "true" doesn't sneak through, while a "false" with a high score never counts as support.
    const supported = modelSaysTrue && score >= threshold;
    return { claim, supported, score, source: cleanSource(v.source) };
  });

  const supported = verdicts.filter((v) => v.supported).length;
  const score = verdicts.length ? Math.round((supported / verdicts.length) * 100) : 0;
  return { score, verdicts, truncated: truncated || undefined };
}

/**
 * Full pure pipeline for the model adapter: split → prompt → (injected) model → parse → score.
 * The `model` fn is the ONLY impure seam and is injected, so this whole flow is unit-testable with
 * a fake model. The adapter wires the real gateway call as `model`.
 */
export async function verifyWithModel(
  answer: string,
  sources: GroundingSource[],
  model: EntailmentModel,
  threshold = 0.5,
): Promise<GroundingResult> {
  const claims = splitClaims(answer);
  const truncated = Math.max(0, claims.length - MAX_CLAIMS);
  const use = claims.slice(0, MAX_CLAIMS);
  if (use.length === 0) return { score: 0, verdicts: [], truncated: truncated || undefined };
  const prompt = buildEntailmentPrompt(use, sources);
  const rawText = await model(prompt);
  const rawVerdicts = parseModelVerdicts(rawText);
  return scoreVerdicts(use, rawVerdicts, truncated, threshold);
}
