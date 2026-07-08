// PURE execution-planner for the public per-pipeline invocation route (PA-11). ZERO imports of
// db/IO/fetch — exhaustively unit-testable (mirrors pipeline-enforcement.ts / routing-policy.ts).
//
// The public route (POST /api/v1/pipeline/<id>/run) authenticates a provisioned key, loads the
// published pipeline, and runs the GOVERNED decision (enforceModelCall over the pipeline's contract).
// THIS module turns that governed verdict + the caller's request into a concrete EXECUTION PLAN the
// thin I/O executor (pipeline-execute.ts) carries out against the real gateway:
//
//   • which MODEL to call (the routing leash's model wins when the leash named one — a data-class rule
//     can pin a specific on-prem model — else the pipeline's defaultModel, else the platform default);
//   • whether the call is FORCE-LOCAL (egress 'local' ⇒ the gateway must stay on-prem — the pure
//     verdict already decided this; we surface it so the executor never reaches a cloud model);
//   • whether inbound text must be PII-MASKED before it leaves for the model (guardrail overlay);
//   • whether inbound prompts must be INJECTION-screened / a purpose is required (surfaced for audit).
//
// It NEVER re-implements the leash — it consumes the ModelCallVerdict the pure enforceModelCall
// produced. A blocked verdict is NOT this module's concern (the route refuses before planning); this
// only shapes an ALLOWED call.

import type { ModelCallVerdict } from '@/lib/pipeline-enforcement';

/** The platform's default answer model when neither the leash nor the pipeline names one. Kept here
 *  (pure) as a constant so the plan is deterministic without reading env; the executor may override
 *  from OFFGRID_GROUNDING_MODEL, but a plan alone is complete + testable. */
export const PLATFORM_DEFAULT_MODEL = 'gemma-local';

export interface PipelineRunPlan {
  /** The model the executor will call. Never empty. */
  model: string;
  /** true ⇒ the call is leashed on-prem (egress 'local'); the executor must not reach a cloud node. */
  forceLocal: boolean;
  /** true ⇒ the inbound prompt must be PII-masked before the model call (guardrail overlay). */
  requirePiiMasking: boolean;
  /** true ⇒ inbound prompts must be injection-screened (guardrail overlay). */
  blockPromptInjection: boolean;
  /** true ⇒ a stated purpose is required for this invocation (policy overlay). */
  requirePurpose: boolean;
  /** The effective egress the plan runs under ('local' | 'cloud'); never 'block' (that never plans). */
  egress: 'local' | 'cloud';
}

/**
 * Choose the model for the call. PURE, deterministic precedence:
 *   1. the routing leash's model (a data-class rule pinned it — e.g. PII → a specific local model),
 *   2. the pipeline's configured defaultModel,
 *   3. an explicit platform default.
 * Whitespace-only candidates are skipped. `defaultModelOverride` lets the executor inject the
 * env-configured default (OFFGRID_GROUNDING_MODEL) while keeping this function pure/testable.
 */
export function chooseModel(
  leashModel: string | null | undefined,
  pipelineDefaultModel: string | null | undefined,
  defaultModelOverride: string = PLATFORM_DEFAULT_MODEL,
): string {
  const leash = (leashModel ?? '').trim();
  if (leash) return leash;
  const pipe = (pipelineDefaultModel ?? '').trim();
  if (pipe) return pipe;
  const dflt = (defaultModelOverride ?? '').trim();
  return dflt || PLATFORM_DEFAULT_MODEL;
}

/**
 * Build the execution plan from the governed verdict + the leash's chosen model + the pipeline's
 * default model. PURE. Precondition: `verdict.allow === true` (a blocked call never reaches here).
 * The `egress` is narrowed to 'local' | 'cloud' — a blocked verdict is a programmer error and is
 * coerced to 'local' (the safe, on-prem default) rather than trusted, so a mis-wired caller can never
 * accidentally plan a cloud reach.
 */
export function buildRunPlan(
  verdict: ModelCallVerdict,
  leashModel: string | null | undefined,
  pipelineDefaultModel: string | null | undefined,
  defaultModelOverride: string = PLATFORM_DEFAULT_MODEL,
): PipelineRunPlan {
  const egress: 'local' | 'cloud' = verdict.egress === 'cloud' ? 'cloud' : 'local';
  return {
    model: chooseModel(leashModel, pipelineDefaultModel, defaultModelOverride),
    forceLocal: verdict.forceLocal || egress === 'local',
    requirePiiMasking: verdict.requirePiiMasking,
    blockPromptInjection: verdict.blockPromptInjection,
    requirePurpose: verdict.requirePurpose,
    egress,
  };
}

/**
 * Extract the caller's prompt from the request body. PURE. Accepts either a bare `input`/`prompt`
 * string OR an OpenAI-style `messages` array (last user message wins) so the public API is ergonomic
 * for both simple integrators and OpenAI-SDK callers. Returns '' when nothing usable is present (the
 * route treats an empty prompt as a 400 — never a fabricated call).
 */
export function extractPrompt(body: Record<string, unknown>): string {
  const direct =
    typeof body.input === 'string'
      ? body.input
      : typeof body.prompt === 'string'
        ? body.prompt
        : '';
  if (direct.trim()) return direct.trim();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown };
    if (m && m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
      return m.content.trim();
    }
  }
  // Fall back to the last message of any role with string content (a single-turn call).
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { content?: unknown };
    if (m && typeof m.content === 'string' && m.content.trim()) return m.content.trim();
  }
  return '';
}
