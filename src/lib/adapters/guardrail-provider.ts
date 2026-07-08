// ─────────────────────────────────────────────────────────────────────────────────────────────
// Third-party guardrail PROVIDER seam.
//
// The console ships two guardrails engines out of the box — the always-on regex floor and Microsoft
// Presidio (src/lib/adapters/pii.ts). This module adds a THIRD, generic seam so an EXTERNAL guardrail
// engine (Lakera Guard, Aporia, Prompt-Security, a self-hosted classifier, …) can be plugged in by
// CONFIG ALONE — no code change per vendor. It mirrors the Presidio adapter exactly: it implements
// the same `PiiPort` contract, registers in the same `guardrails` capability, and is selected with
// the same env switch `OFFGRID_ADAPTER_GUARDRAILS=http-guardrail`.
//
// SOLID seam:
//   • normalizeGuardrailResponse() — PURE, zero-IO, exhaustively unit-testable. Maps an external
//     provider's JSON response onto the console's normalized PiiResult verdict. Named vendors differ
//     only in their JSON shape, so ALL that a new vendor needs is (usually) a tweak here or a mapper
//     — the network plumbing below is shared.
//   • httpGuardrailPii — the thin I/O adapter: POST the text to the configured provider and normalize
//     the answer. Best-effort BY DESIGN: not configured (no URL) OR the provider is unreachable ⇒
//     degrade to the always-on regex floor, so turning an external provider on can never harden into
//     a hard dependency (the same fail-open contract as the Presidio adapter).
//
// HOW A NAMED VENDOR SLOTS IN (documented, not built — we ship ONE generic provider as proof):
//   Lakera / Aporia / Prompt-Security all expose "POST text → verdict JSON". Point
//   OFFGRID_HTTP_GUARDRAIL_URL at the vendor's endpoint, set OFFGRID_HTTP_GUARDRAIL_API_KEY, and (if
//   its JSON differs from the generic {flagged, entities?, redacted?} shape) add a one-line field
//   mapping in normalizeGuardrailResponse. No new adapter, no registry surgery — one config + at most
//   one mapper. That is the whole point of the seam.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { regexScan } from './pii-regex';
import type { PiiPort, PiiResult } from './types';

const env = process.env;

// A fetch timeout that survives environments where AbortSignal.timeout is unavailable-ish; 6s is
// generous for a remote classifier while still bounded so a hung provider can't stall a run.
const CHECK_TIMEOUT_MS = 6000;

// The loose response shape a generic HTTP guardrail provider returns. Every field is optional/unknown
// so a malformed body degrades to "clean pass" rather than throwing on the run path.
//   • flagged / blocked / block — truthy ⇒ the provider found something (a policy violation / PII).
//   • entities — the labels the provider matched (mapped straight onto PiiResult.entities).
//   • redacted / sanitized — a provider-sanitized form of the text, if it offers one.
export interface RawGuardrailResponse {
  flagged?: unknown;
  blocked?: unknown;
  block?: unknown;
  entities?: unknown;
  categories?: unknown;
  redacted?: unknown;
  sanitized?: unknown;
}

function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

/**
 * Map a generic external-provider response onto the console's normalized PiiResult. PURE — zero I/O.
 *
 * The provider is considered to have "hit" when it flagged/blocked the text OR it named any entity/
 * category. A named entity list is surfaced verbatim (so the audit shows what the vendor matched);
 * when the provider flagged without naming entities we synthesize a single `GUARDRAIL` label so the
 * verdict is still legible. A provider-supplied redaction/sanitization is preferred; otherwise the
 * original text is echoed back (this adapter does not invent redactions the provider didn't make).
 */
export function normalizeGuardrailResponse(
  original: string,
  raw: RawGuardrailResponse | null | undefined,
  engine = 'http-guardrail',
): PiiResult {
  const r = raw && typeof raw === 'object' ? raw : {};
  const flagged = asBool(r.flagged) || asBool(r.blocked) || asBool(r.block);
  const named = [...asStringArray(r.entities), ...asStringArray(r.categories)];
  const entities = named.length > 0 ? named : flagged ? ['GUARDRAIL'] : [];
  const hits = entities.length > 0;
  const redacted =
    typeof r.redacted === 'string'
      ? r.redacted
      : typeof r.sanitized === 'string'
        ? r.sanitized
        : original;
  return { hits, entities, redacted, engine };
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

// POST the text to the configured provider and return its raw JSON. Throws on a non-2xx / network
// error so the caller can decide to fail open to the regex floor (mirrors presidioAnalyze).
async function postGuardrail(
  url: string,
  apiKey: string | undefined,
  text: string,
): Promise<RawGuardrailResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // Bearer is the near-universal scheme (Lakera/Aporia/OpenAI-style). A vendor that wants a custom
  // header is one line in a mapper — but the seam's default covers the common case with no code.
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input: text, text }),
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `http-guardrail POST ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
    );
  }
  return (await res.json()) as RawGuardrailResponse;
}

// The generic external HTTP guardrail provider, behind the guardrails PiiPort. Selected with
// OFFGRID_ADAPTER_GUARDRAILS=http-guardrail; configured with OFFGRID_HTTP_GUARDRAIL_URL (+ optional
// _API_KEY). Not configured ⇒ honest fall-through to the regex floor (never a hard dependency).
export const httpGuardrailPii: PiiPort = {
  meta: {
    id: 'http-guardrail',
    capability: 'guardrails',
    vendor: 'External HTTP guardrail provider',
    license: 'third-party (bring-your-own)',
    render: 'headless',
    embedUrl: env.OFFGRID_HTTP_GUARDRAIL_URL,
    description:
      'Generic seam for a third-party guardrail engine (Lakera / Aporia / Prompt-Security / self-hosted). POSTs the text and reads a verdict. Configure with OFFGRID_HTTP_GUARDRAIL_URL + _API_KEY; a named vendor slots in via a one-line field mapping. Falls back to the regex floor when unset or unreachable.',
  },
  async scan(text) {
    const url = env.OFFGRID_HTTP_GUARDRAIL_URL;
    // Honest "not configured": no URL ⇒ the regex floor answers. The UI reports this as "not
    // configured yet" (calm) rather than "down" via the registry's `configured` flag.
    if (!url) return regexScan(text);
    try {
      const raw = await postGuardrail(url, env.OFFGRID_HTTP_GUARDRAIL_API_KEY, text);
      return normalizeGuardrailResponse(text, raw);
    } catch (err) {
      // Provider unreachable / errored — degrade to the regex floor and log the concrete reason so
      // "why regex?" is answerable from the logs, not guessed at.
      console.warn(
        '[http-guardrail] provider call failed, degrading to regex floor:',
        describeError(err),
      );
      return regexScan(text);
    }
  },
  async health() {
    const url = env.OFFGRID_HTTP_GUARDRAIL_URL;
    if (!url) return false;
    try {
      // A HEAD/GET to the base is the cheapest liveness signal; a provider without one still returns
      // *some* status, which is enough to distinguish "reachable" from "socket refused".
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(2500) });
      return res.ok;
    } catch {
      return false;
    }
  },
};
