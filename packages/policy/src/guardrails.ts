// @offgrid/policy — guardrails.
// Deny patterns, input size caps, blocked models, and optional PII redaction via
// Microsoft Presidio. Runs entirely in `pre`. Presidio calls are best-effort and
// fail-open (a network hiccup must never block a request).

import type { Policy, PolicyContext } from './gateway-types.js';
import { readLastUserText, rewriteLastUserText } from './messages.js';

export interface GuardrailOptions {
  /** Substrings or regexes that, if matched in the user text, reject the request. */
  denyPatterns?: (string | RegExp)[];
  /** Reject if the user text exceeds this many characters. */
  maxInputChars?: number;
  /** Reject (403) if the requested model is in this list. */
  blockedModels?: string[];
  /** Redact PII in the user text before dispatch (requires presidioUrl). */
  piiRedact?: boolean;
  /** Base URL of a Presidio deployment, e.g. http://localhost:5002. */
  presidioUrl?: string;
}

/** Normalize a pattern to a RegExp (strings become case-insensitive literals). */
function toRegExp(p: string | RegExp): RegExp {
  if (p instanceof RegExp) return p;
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

/** Presidio /analyze response entry. */
interface PresidioSpan {
  entity_type: string;
  start: number;
  end: number;
  score: number;
}

/**
 * Best-effort PII redaction against a Presidio deployment.
 * Calls /analyze then /anonymize. Returns the redacted text, or the original on
 * any failure (fail-open).
 */
async function presidioRedact(text: string, presidioUrl: string): Promise<string> {
  const base = presidioUrl.replace(/\/+$/, '');
  try {
    const analyzeRes = await fetch(`${base}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, language: 'en' }),
    });
    if (!analyzeRes.ok) return text;
    const analyzerResults = (await analyzeRes.json()) as PresidioSpan[];
    if (!Array.isArray(analyzerResults) || analyzerResults.length === 0) return text;

    const anonRes = await fetch(`${base}/anonymize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, analyzer_results: analyzerResults }),
    });
    if (!anonRes.ok) return text;
    const anon = (await anonRes.json()) as { text?: unknown };
    return typeof anon.text === 'string' ? anon.text : text;
  } catch {
    return text; // fail-open
  }
}

export function guardrails(opts: GuardrailOptions = {}): Policy {
  const patterns = (opts.denyPatterns ?? []).map(toRegExp);
  const blocked = new Set(opts.blockedModels ?? []);

  return {
    name: 'guardrails',
    async pre(ctx: PolicyContext): Promise<void> {
      // 1. Blocked model check (cheap, no text needed).
      if (blocked.has(ctx.model)) {
        ctx.deny = {
          status: 403,
          message: `model '${ctx.model}' is blocked by policy`,
          policy: 'guardrails',
        };
        return;
      }

      const text = readLastUserText(ctx.body);

      // 2. Deny-pattern match.
      for (const re of patterns) {
        if (re.test(text)) {
          ctx.deny = {
            status: 400,
            message: 'request blocked by content guardrail',
            policy: 'guardrails',
          };
          return;
        }
      }

      // 3. Input size cap.
      if (typeof opts.maxInputChars === 'number' && text.length > opts.maxInputChars) {
        ctx.deny = {
          status: 400,
          message: `input exceeds ${opts.maxInputChars} characters`,
          policy: 'guardrails',
        };
        return;
      }

      // 4. PII redaction (best-effort, mutates body in place).
      if (opts.piiRedact && opts.presidioUrl && text) {
        const redacted = await presidioRedact(text, opts.presidioUrl);
        if (redacted !== text) {
          rewriteLastUserText(ctx.body, redacted);
          ctx.meta.piiRedacted = true;
        }
      }
    },
  };
}
