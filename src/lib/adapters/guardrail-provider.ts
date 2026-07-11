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
//   • llmGuardPii — the thin I/O adapter: POST the text + the console-generated scanner config (which
//     folds in the India recognizers — see llm-guard-config.ts) and normalize the answer.
//
// FAIL CLOSED (a guardrail must not be bypassable by killing the engine):
//   • CONFIGURED (URL set) but unreachable / errored ⇒ return `{ blocked:true }` — the run is DENIED
//     with a clear reason. There is NO silent fall-open to a weaker regex floor.
//   • NOT configured (no URL) ⇒ return `{ configured:false }` — an explicit "guardrails not
//     configured" state the UI surfaces. The step did not screen; it never pretends it did.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { buildLlmGuardScannerConfig, type LlmGuardScannerConfig } from '../llm-guard-config';
import type { NormalizedRecognizer } from '../presidio-recognizers';
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

// The default risk-score above which a scanner counts as "flagged". LLM Guard scores are 0..1.
const LLM_GUARD_SCORE_THRESHOLD = 0.5;

// Extract { name: score } pairs from the scanners object, keeping only finite numeric scores.
function scannerScores(v: unknown): Array<[string, number]> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
  return Object.entries(v as Record<string, unknown>).filter(
    (pair): pair is [string, number] => typeof pair[1] === 'number' && Number.isFinite(pair[1]),
  );
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
  const r = raw && typeof raw === 'object' ? raw : {};
  // is_valid may be absent (treat as valid) or a real boolean. Only an explicit `false` is a fail.
  const invalid = r.is_valid === false || r.is_valid === 'false';
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
  return { hits, entities, redacted: sanitized, engine, configured: true };
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
async function postLlmGuard(
  base: string,
  apiKey: string | undefined,
  text: string,
  scanners: LlmGuardScannerConfig,
): Promise<RawLlmGuardResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // llm-guard-api authenticates with a bearer AUTH_TOKEN when configured.
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${trimTrailingSlash(base)}/analyze/prompt`, {
    method: 'POST',
    headers,
    // `scanners` carries the console's scanner config INCLUDING the folded-in India recognizers, so
    // the engine screens Indian PII (PAN/Aadhaar/IFSC/UPI) it would otherwise miss (G-LG-2).
    body: JSON.stringify({ prompt: text, scanners }),
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`llm-guard POST ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
  return (await res.json()) as RawLlmGuardResponse;
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
  };
}

// The not-configured verdict — no engine URL. The step did NOT screen; it says so honestly. PURE.
export function guardrailNotConfigured(engine = 'llm-guard'): PiiResult {
  return { hits: false, configured: false, entities: [], engine };
}

// LLM Guard (Protect AI) as THE guardrails engine behind the PiiPort. Selected by default (registry);
// configured with OFFGRID_HTTP_GUARDRAIL_URL (the llm-guard-api base, e.g. http://llm-guard:8000) +
// optional OFFGRID_HTTP_GUARDRAIL_API_KEY (the server's AUTH_TOKEN).
//
// FAIL CLOSED: configured + unreachable ⇒ the run is BLOCKED (never a silent fall-open). NOT
// configured ⇒ an explicit "not configured" state (never a faked clean pass).
//
// `orgId` scopes the org's custom recognizers, which are folded into the scanner config ALONGSIDE
// the always-on India defaults. Loading them is best-effort — a config-load failure degrades to
// "India defaults only" (still a real screen), NOT to a bypass.
export const llmGuardPii: PiiPort = {
  meta: {
    id: 'llm-guard',
    capability: 'guardrails',
    vendor: 'LLM Guard (Protect AI)',
    license: 'MIT',
    render: 'headless',
    embedUrl: env.OFFGRID_HTTP_GUARDRAIL_URL,
    description:
      'The authoritative content-guardrail engine — self-hosted LLM Guard scanners (PII/Anonymize with the India recognizers folded in, Secrets, PromptInjection, Toxicity, Bias, BanTopics, Language, Regex, TokenLimit). POSTs the text + the console scanner config to /analyze/prompt. FAIL CLOSED: configured + unreachable blocks the run; not configured is surfaced as "guardrails not configured" (never a silent fall-open). Configure OFFGRID_HTTP_GUARDRAIL_URL (+ _API_KEY = AUTH_TOKEN).',
  },
  async scan(text, orgId) {
    const url = env.OFFGRID_HTTP_GUARDRAIL_URL;
    // Honest "not configured": no URL ⇒ the step did NOT screen. The UI reports this as "guardrails
    // not configured yet" (calm) via the registry's `configured` flag. Never a faked clean pass.
    if (!url) return guardrailNotConfigured();

    const scanners = await loadScannerConfig(orgId);
    try {
      const raw = await postLlmGuard(url, env.OFFGRID_HTTP_GUARDRAIL_API_KEY, text, scanners);
      return normalizeLlmGuardResponse(text, raw);
    } catch (err) {
      // FAIL CLOSED — configured but the engine could not screen. Block the run with a clear reason;
      // log the concrete cause so "why blocked?" is answerable from the logs, not guessed at.
      const reason = describeError(err);
      console.error('[llm-guard] engine unreachable — FAILING CLOSED (run blocked):', reason);
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

// Best-effort load of the org's custom recognizers, folded into the scanner config alongside the
// India defaults. A load failure (no DB, missing table, no request scope) degrades to "defaults
// only" — it NEVER throws (which would be caught by scan()'s fail-closed and wrongly block a run for
// a config-load hiccup). Isolated so scan() stays thin.
async function loadScannerConfig(orgId?: string): Promise<LlmGuardScannerConfig> {
  let recognizers: NormalizedRecognizer[] = [];
  try {
    const { listRecognizers } = await import('../presidio-recognizers');
    const resolvedOrg =
      orgId?.trim()
        ? orgId.trim()
        : await (await import('../tenancy')).currentOrgId();
    const recs = await listRecognizers(resolvedOrg);
    recognizers = recs as unknown as NormalizedRecognizer[];
  } catch (err) {
    console.warn('[llm-guard] recognizer load failed, using India defaults only:', describeError(err));
  }
  return buildLlmGuardScannerConfig(recognizers);
}
