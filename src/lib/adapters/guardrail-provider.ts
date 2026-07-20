// ─────────────────────────────────────────────────────────────────────────────────────────────
// LLM Guard (Protect AI, MIT) — THE authoritative content-guardrail engine.
//
// Founder decision (DRY consolidation): the console relies COMPLETELY on LLM Guard for content
// guardrails — PII/DLP, secrets, prompt-injection, toxicity, language. The four-engine seam (regex
// floor, Presidio, a generic BYO http-guardrail, LLM Guard) collapsed to ONE real engine. The DIP
// port (PiiPort) stays so the checks spine is engine-agnostic, but LLM Guard is the only backing.
//
// SOLID seam:
//   • normalizeLlmGuardResponse() — PURE, zero-IO, exhaustively unit-testable. Maps LLM Guard's
//     /analyze verdict JSON onto the console's normalized PiiResult.
//   • llmGuardPii — the thin I/O adapter: POST stock v0.3.16 request bodies to the phase-correct
//     endpoint and normalize the answer. Scanner selection/configuration is a startup YAML concern
//     owned by the fleet, never an ignored per-request field.
//
// FAIL CLOSED (a guardrail must not be bypassable by killing the engine):
//   • CONFIGURED (URL set) but unreachable / errored ⇒ return `{ blocked:true }` — the run is DENIED
//     with a clear reason. There is NO silent fall-open to a weaker regex floor.
//   • NOT configured (no URL) ⇒ return `{ configured:false }` — an explicit "guardrails not
//     configured" state the UI surfaces. The step did not screen; it never pretends it did.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import type { PiiPort, PiiResult } from './types';

const env = process.env;

// A fetch timeout that survives environments where AbortSignal.timeout is unavailable-ish; 6s is
// generous for a remote classifier while still bounded so a hung engine can't stall a run.
const CHECK_TIMEOUT_MS = 6000;

// LLM Guard's response (POST /analyze/prompt):
//   { is_valid: boolean, scanners: { "<ScannerName>": <risk score 0..1>, … }, sanitized_prompt: "…" }
// The mapping:
//   • hits          — a scan "hit" when the verdict is NOT valid (is_valid === false). LLM Guard's
//     `is_valid` is `all(scanner passed)`, so is_valid===false means at least one scanner tripped.
//   • entities      — the names of the scanners that flagged. A scanner is considered to have flagged
//     when its risk score exceeds `scoreThreshold` (default 0.5), OR — when is_valid is false but no
//     score cleared the bar (some scanners report a boolean-ish 0/1) — every non-zero scanner. When
//     is_valid is false and nothing else is nameable we synthesize a single `GUARDRAIL` label so the
//     verdict is still legible.
//   • redacted      — LLM Guard's `sanitized_prompt` (Anonymize rewrites PII in place); else the
//     original text (we never invent a redaction the engine didn't make).
export interface RawLlmGuardResponse {
  is_valid?: unknown;
  scanners?: unknown;
  sanitized_prompt?: unknown;
  sanitized_output?: unknown;
}

export type LlmGuardAnalyzeRequest =
  | { phase: 'input'; prompt: string; scanners_suppress?: string[] }
  | { phase: 'output'; prompt: string; output: string; scanners_suppress?: string[] };

export interface LlmGuardAnalyzeResponse {
  body: RawLlmGuardResponse;
  answeredBy: string[];
  degraded: string[];
}

// The default risk-score above which a scanner counts as "flagged". LLM Guard scores are 0..1.
const LLM_GUARD_SCORE_THRESHOLD = 0.5;

// Extract { name: score } pairs from the scanners object, keeping only finite numeric scores.
function scannerScores(v: unknown): Array<[string, number]> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
  return Object.entries(v as Record<string, unknown>).filter(
    (pair): pair is [string, number] => typeof pair[1] === 'number' && Number.isFinite(pair[1]),
  );
}

export function isLlmGuardVerdict(raw: unknown): raw is RawLlmGuardResponse {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const verdict = raw as RawLlmGuardResponse;
  return (
    typeof verdict.is_valid === 'boolean' &&
    !!verdict.scanners &&
    typeof verdict.scanners === 'object' &&
    !Array.isArray(verdict.scanners) &&
    Object.values(verdict.scanners as Record<string, unknown>).every(
      (score) => typeof score === 'number' && Number.isFinite(score),
    )
  );
}

function isPhaseCompleteVerdict(
  raw: unknown,
  phase: LlmGuardAnalyzeRequest['phase'],
): raw is RawLlmGuardResponse {
  if (!isLlmGuardVerdict(raw)) return false;
  return phase === 'input'
    ? typeof raw.sanitized_prompt === 'string'
    : typeof raw.sanitized_output === 'string';
}

/**
 * Map an LLM Guard `/analyze/*` response onto the console's normalized PiiResult. PURE — zero I/O.
 * `threshold` is the risk-score at/above which a scanner is treated as a flag (default 0.5).
 * A successfully-parsed engine answer is always `configured:true` (the engine screened this run).
 */
export function normalizeLlmGuardResponse(
  original: string,
  raw: RawLlmGuardResponse | null | undefined,
  threshold: number = LLM_GUARD_SCORE_THRESHOLD,
  engine = 'llm-guard',
): PiiResult {
  if (!isLlmGuardVerdict(raw)) return guardrailUnavailable('malformed guardrail verdict', engine);
  const r = raw;
  const invalid = r.is_valid === false;
  const scores = scannerScores(r.scanners);
  // Scanners over the threshold are the primary signal. If the verdict is invalid but nothing cleared
  // the bar, fall back to any scanner with a non-zero score so we still name what tripped.
  let flaggedScanners = scores.filter(([, s]) => s >= threshold).map(([name]) => name);
  if (invalid && flaggedScanners.length === 0) {
    flaggedScanners = scores.filter(([, s]) => s > 0).map(([name]) => name);
  }
  const hits = invalid || flaggedScanners.length > 0;
  let entities: string[] = [];
  if (flaggedScanners.length > 0) entities = flaggedScanners;
  else if (hits) entities = ['GUARDRAIL'];
  let sanitized = original;
  if (typeof r.sanitized_prompt === 'string') sanitized = r.sanitized_prompt;
  else if (typeof r.sanitized_output === 'string') sanitized = r.sanitized_output;
  return {
    hits,
    entities,
    redacted: sanitized,
    engine,
    requestedEngine: engine,
    configured: true,
    status: 'applied',
    scope: 'content-guardrail',
  };
}

// Flatten an unknown thrown value into a diagnosable one-liner — fetch() hides the useful bit
// (ECONNREFUSED / ETIMEDOUT / ENOTFOUND) on `err.cause.code`, not `err.message`. Surface it.
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const code =
      cause && typeof cause === 'object' && 'code' in cause
        ? (cause as { code?: unknown }).code
        : undefined;
    return code ? `${err.message} (cause: ${String(code)})` : err.message;
  }
  return String(err);
}

// Strip a trailing slash so `${base}/analyze/prompt` never doubles up.
function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

// POST the prompt + the console's scanner config to LLM Guard's /analyze/prompt and return its raw
// JSON. Throws on non-2xx / network so the caller can FAIL CLOSED (block the run).
export async function postLlmGuard(
  base: string,
  apiKey: string | undefined,
  request: LlmGuardAnalyzeRequest,
  fetcher: typeof fetch = fetch,
): Promise<LlmGuardAnalyzeResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // llm-guard-api authenticates with a bearer AUTH_TOKEN when configured.
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const endpoint = request.phase === 'input' ? 'prompt' : 'output';
  const { phase: _phase, ...requestBody } = request;
  const res = await fetcher(`${trimTrailingSlash(base)}/analyze/${endpoint}`, {
    method: 'POST',
    headers,
    // v0.3.16 accepts only prompt/output + optional scanners_suppress. Scanner configuration is
    // loaded from CONFIG_FILE at process start. Sending a `scanners` object here is silently ignored
    // by the stock Pydantic model and therefore forbidden by this closed request union.
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`llm-guard POST ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
  const split = (name: string): string[] =>
    (res.headers.get(name) ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part && part !== 'none');
  const responseBody = (await res.json()) as RawLlmGuardResponse;
  if (!isPhaseCompleteVerdict(responseBody, request.phase)) {
    throw new Error('llm-guard returned a malformed 2xx verdict');
  }
  return {
    body: responseBody,
    answeredBy: split('x-offgrid-guard-answered'),
    degraded: split('x-offgrid-guard-degraded'),
  };
}

// The blocked (fail-closed) verdict returned when LLM Guard is CONFIGURED but unreachable. PURE.
// A blocked result is a HIT (something is wrong) + `blocked:true` so the checks spine denies the run.
export function guardrailUnavailable(reason: string, engine = 'llm-guard'): PiiResult {
  return {
    hits: true,
    blocked: true,
    configured: true,
    entities: ['GUARDRAIL_UNAVAILABLE'],
    redacted: `[guardrail unavailable: ${reason}]`,
    engine,
    requestedEngine: engine,
    status: 'down',
    reason,
    scope: 'content-guardrail',
  };
}

// The not-configured verdict — no engine URL. The step did NOT screen; it says so honestly. PURE.
export function guardrailNotConfigured(engine = 'llm-guard'): PiiResult {
  return {
    hits: false,
    configured: false,
    entities: [],
    engine,
    requestedEngine: engine,
    status: 'unconfigured',
    reason: 'LLM Guard URL is not configured; content was not screened',
    scope: 'content-guardrail',
  };
}

// LLM Guard (Protect AI) as THE guardrails engine behind the PiiPort. Selected by default (registry);
// configured with OFFGRID_HTTP_GUARDRAIL_URL (the llm-guard-api base, e.g. http://llm-guard:8000) +
// optional OFFGRID_HTTP_GUARDRAIL_API_KEY (the server's AUTH_TOKEN).
//
// FAIL CLOSED: configured + unreachable ⇒ the run is BLOCKED (never a silent fall-open). NOT
// configured ⇒ an explicit "not configured" state (never a faked clean pass).
//
export const llmGuardPii: PiiPort = {
  meta: {
    id: 'llm-guard',
    capability: 'guardrails',
    vendor: 'LLM Guard (Protect AI)',
    license: 'MIT',
    render: 'headless',
    embedUrl: env.OFFGRID_HTTP_GUARDRAIL_URL,
    description:
      'The authoritative content-guardrail engine. Input uses /analyze/prompt; generated output uses /analyze/output with its prompt context. Scanner configuration, including India recognizers, is loaded from the fleet CONFIG_FILE at startup. FAIL CLOSED when configured but unreachable.',
  },
  async scan(text) {
    const url = env.OFFGRID_HTTP_GUARDRAIL_URL;
    // Honest "not configured": no URL ⇒ the step did NOT screen. The UI reports this as "guardrails
    // not configured yet" (calm) via the registry's `configured` flag. Never a faked clean pass.
    if (!url) return guardrailNotConfigured();

    try {
      const response = await postLlmGuard(url, env.OFFGRID_HTTP_GUARDRAIL_API_KEY, {
        phase: 'input',
        prompt: text,
      });
      return {
        ...normalizeLlmGuardResponse(text, response.body),
        answeredBy: response.answeredBy,
        degraded: response.degraded,
      };
    } catch (err) {
      // FAIL CLOSED — configured but the engine could not screen. Block the run with a clear reason;
      // log the concrete cause so "why blocked?" is answerable from the logs, not guessed at.
      const reason = describeError(err);
      console.error('[llm-guard] engine unreachable — FAILING CLOSED (run blocked):', reason);
      return guardrailUnavailable(reason);
    }
  },
  async scanOutput(prompt, output) {
    const url = env.OFFGRID_HTTP_GUARDRAIL_URL;
    if (!url) return guardrailNotConfigured();
    try {
      const response = await postLlmGuard(url, env.OFFGRID_HTTP_GUARDRAIL_API_KEY, {
        phase: 'output',
        prompt,
        output,
      });
      return {
        ...normalizeLlmGuardResponse(output, response.body),
        answeredBy: response.answeredBy,
        degraded: response.degraded,
      };
    } catch (err) {
      const reason = describeError(err);
      console.error('[llm-guard] output engine unreachable — FAILING CLOSED (run blocked):', reason);
      return guardrailUnavailable(reason);
    }
  },
  async health() {
    const url = env.OFFGRID_HTTP_GUARDRAIL_URL;
    if (!url) return false;
    try {
      // llm-guard-api exposes GET /healthz (liveness); a 200 there is the true "reachable" signal.
      const res = await fetch(`${trimTrailingSlash(url)}/healthz`, {
        signal: AbortSignal.timeout(2500),
      });
      return res.ok;
    } catch {
      return false;
    }
  },
};
