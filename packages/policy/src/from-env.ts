// @offgrid/policy — assemble a default policy set from environment variables.
// Convenience for wiring the gateway with zero code: set env vars, get Policy[].

import type { Policy } from './gateway-types.js';
import { guardrails } from './guardrails.js';
import { rateLimit } from './rate-limit.js';
import { budget } from './budget.js';
import { cache } from './cache.js';

/**
 * Reads (env or process.env):
 *  - OFFGRID_GUARDRAIL_DENY   comma-separated deny keywords/patterns
 *  - OFFGRID_MAX_INPUT_CHARS  max user-text length
 *  - OFFGRID_BLOCKED_MODELS   comma-separated blocked model ids
 *  - OFFGRID_PRESIDIO_URL     enables PII redaction when set
 *  - OFFGRID_RATELIMIT_RPM    requests-per-minute cap
 *  - OFFGRID_BUDGET_TOKENS    rolling token budget
 *  - OFFGRID_BUDGET_WINDOW_MS budget window (default 60000)
 *  - OFFGRID_CACHE_TTL_MS     enables response cache when set (>0)
 */
export function policiesFromEnv(env: Record<string, string | undefined> = readProcessEnv()): Policy[] {
  const policies: Policy[] = [];

  const deny = splitList(env.OFFGRID_GUARDRAIL_DENY);
  const blockedModels = splitList(env.OFFGRID_BLOCKED_MODELS);
  const maxInputChars = num(env.OFFGRID_MAX_INPUT_CHARS);
  const presidioUrl = env.OFFGRID_PRESIDIO_URL?.trim() || undefined;

  if (deny.length || blockedModels.length || maxInputChars || presidioUrl) {
    policies.push(
      guardrails({
        denyPatterns: deny.length ? deny : undefined,
        blockedModels: blockedModels.length ? blockedModels : undefined,
        maxInputChars,
        piiRedact: Boolean(presidioUrl),
        presidioUrl,
      }),
    );
  }

  const rpm = num(env.OFFGRID_RATELIMIT_RPM);
  if (rpm && rpm > 0) policies.push(rateLimit({ rpm }));

  const maxTokens = num(env.OFFGRID_BUDGET_TOKENS);
  if (maxTokens && maxTokens > 0) {
    policies.push(budget({ maxTokens, windowMs: num(env.OFFGRID_BUDGET_WINDOW_MS) }));
  }

  const ttlMs = num(env.OFFGRID_CACHE_TTL_MS);
  if (ttlMs && ttlMs > 0) policies.push(cache({ ttlMs }));

  return policies;
}

/** Read process.env without depending on @types/node (kept optional). */
function readProcessEnv(): Record<string, string | undefined> {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env ?? {};
}

function splitList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
