import { getPii } from './adapters/registry';
import type { PiiResult } from './adapters/types';
import { CHECK_IDS } from './check-ids';

export { CHECK_IDS } from './check-ids';

// The findings spine. Guardrail/eval checks run as hooks (pre/post) and produce normalized
// results stamped onto the audit record — the Portkey `hook_results` / Bifrost PostHook pattern.
// Each tool (Presidio, an injection scanner, a grounding/eval scorer) is a CheckAdapter.
export type CheckVerdict = 'pass' | 'warn' | 'redacted' | 'blocked' | 'fail';

export interface CheckResult {
  name: string;
  verdict: CheckVerdict;
  score?: number;
  ms?: number;
  detail?: string;
  /**
   * The engine's sanitized form of the screened text, present ONLY on a 'redacted' output verdict
   * when the pipeline required PII masking. The run surface substitutes this for the raw answer
   * before signing/release — the substitution the output fail-closed block was waiting for.
   */
  redactedText?: string;
}

export interface CheckContext {
  phase: 'pre' | 'post';
  input?: string;
  output?: string;
  model?: string;
  // Explicit org for tenant-scoped checks (PII deep config). Supplied on the durable/worker path
  // where there is no request scope for `headers()`-based org resolution (gap #121); omitted on the
  // request path, where the PII adapter resolves the org from the session. Optional = back-compat.
  orgId?: string;
  /**
   * true ⇒ the pipeline REQUIRES PII masking for this run (org floor OR pipeline overlay). On the
   * 'post' phase this lets the output PII check RELEASE the engine's sanitized output as 'redacted'
   * (the run surface substitutes it) instead of fail-closing to 'blocked'. Default/undefined keeps
   * the fail-closed block — a caller that will not substitute the sanitized answer must NOT set it.
   */
  requirePiiMasking?: boolean;
}

// Internal adapter context. Callers cannot inject a fabricated clean scan through CheckContext;
// only runChecks may populate this after the real guardrail engine answers.
interface CheckExecutionContext extends CheckContext {
  precomputedPii?: PiiResult;
  precomputedPiiMs?: number;
}

export interface CheckRunnerDeps {
  /** Injectable only at the I/O boundary so the one-scan invariant is directly testable. */
  scanPii?: (text: string, orgId?: string) => Promise<PiiResult>;
}

export interface CheckAdapter {
  name: string;
  phase: 'pre' | 'post' | 'both';
  run(ctx: CheckExecutionContext): Promise<CheckResult> | CheckResult;
}

const INJECTION = /\b(ignore (all |the )?previous|disregard (the )?instructions|system prompt)\b/i;

// The minimal PII-scan shape the verdict mapper reads (mirrors PiiResult without importing the
// adapter types into this decision helper).
export interface PiiCheckInput {
  hits: boolean;
  entities: string[];
  engine: string;
  /** Aggregate shards that returned a usable verdict for this scan. */
  answeredBy?: string[];
  /** Optional aggregate shards that did not answer; the surviving verdict remains enforceable. */
  degraded?: string[];
  /** true ⇒ the engine was configured but could not screen → FAIL CLOSED (block the run). */
  blocked?: boolean;
  /** false ⇒ no engine configured → the step did not screen (surfaced, never faked as clean). */
  configured?: boolean;
  /** The engine's sanitized form of the screened text (LLM Guard sanitized_output), when available. */
  redacted?: string;
}

function guardrailCoverageDetail(result: PiiCheckInput): string | undefined {
  if (!result.degraded?.length) return undefined;
  const answered = result.answeredBy?.length ? `; answered by ${result.answeredBy.join(', ')}` : '';
  return `coverage degraded: unavailable ${result.degraded.join(', ')}${answered}`;
}

function withCoverage(detail: string | undefined, result: PiiCheckInput): string | undefined {
  const coverage = guardrailCoverageDetail(result);
  if (!coverage) return detail;
  return detail ? `${detail}; ${coverage}` : coverage;
}

// PURE: map a guardrail scan onto a CheckResult. LLM Guard is THE engine; its fail-closed /
// not-configured states are honoured here so the guardrail can never be bypassed by killing it:
//   • blocked (configured + unreachable) → 'blocked': the run is denied with a clear reason.
//   • configured === false               → 'warn':   the step did NOT screen; surfaced honestly
//     (never 'pass', which would imply a clean screen that never happened).
//   • hits                                → 'redacted': PII/policy hit; the redacted text is used.
//   • otherwise                           → 'pass': the engine screened and found nothing.
export function piiVerdict(result: PiiCheckInput): CheckResult {
  if (result.blocked) {
    return {
      name: 'pii',
      verdict: 'blocked',
      detail: withCoverage(
        `guardrail engine unavailable (${result.engine}) — run blocked (fail-closed): ${result.entities.join(', ')}`,
        result,
      ),
    };
  }
  if (result.configured === false) {
    return {
      name: 'pii',
      verdict: 'warn',
      detail: withCoverage(
        `guardrails not configured (${result.engine}) — input was NOT screened`,
        result,
      ),
    };
  }
  const coverage = guardrailCoverageDetail(result);
  return {
    name: 'pii',
    verdict: result.hits ? 'redacted' : coverage ? 'warn' : 'pass',
    detail: withCoverage(
      result.hits ? `PII (${result.engine}): ${result.entities.join(', ')}` : undefined,
      result,
    ),
  };
}

/**
 * Generated-output policy is fail closed. A content hit cannot be reported as "redacted" while the
 * caller still holds and releases the ORIGINAL answer. There are exactly two safe outcomes for an
 * output PII hit:
 *
 *   • `requireMasking` AND the engine returned a usable sanitized_output ⇒ verdict 'redacted' carrying
 *     that sanitized text in `redactedText`. This is only safe because the run surface SUBSTITUTES
 *     `redactedText` for the raw answer before signing/release (see agentrun.ts post step). A caller
 *     that will not substitute MUST NOT pass requireMasking — then the block branch below applies.
 *   • otherwise ⇒ verdict 'blocked' (fail-closed): masking not required, or no sanitized form to
 *     release, so the raw answer with PII must never leave.
 *
 * A fail-closed / not-configured / no-hit result is returned by piiVerdict unchanged.
 */
export function piiOutputVerdict(result: PiiCheckInput, requireMasking = false): CheckResult {
  const verdict = piiVerdict(result);
  if (verdict.verdict !== 'redacted') return verdict;
  const sanitized = typeof result.redacted === 'string' ? result.redacted : null;
  if (requireMasking && sanitized !== null) {
    return {
      ...verdict,
      redactedText: sanitized,
      detail: withCoverage(
        `output PII masked for release (${result.engine}): ${result.entities.join(', ')}`,
        result,
      ),
    };
  }
  return {
    ...verdict,
    verdict: 'blocked',
    detail: withCoverage(
      `output guardrail blocked release (${result.engine}): ${result.entities.join(', ')}`,
      result,
    ),
  };
}

// PII runs through the guardrails port — LLM Guard is the sole engine. The verdict shape is
// identical regardless of the engine internals; fail-closed + not-configured are mapped by piiVerdict.
export const piiCheck: CheckAdapter = {
  name: 'pii',
  phase: 'both',
  async run(ctx) {
    const pii = getPii();
    // Stock LLM Guard has distinct input/output schemas. Never submit generated output to the
    // prompt endpoint: that silently skips the configured output scanners.
    const result =
      ctx.phase === 'post'
        ? pii.scanOutput
          ? await pii.scanOutput(ctx.input ?? '', ctx.output ?? '', ctx.orgId)
          : {
              hits: true,
              blocked: true,
              configured: true,
              entities: ['OUTPUT_GUARDRAIL_UNSUPPORTED'],
              engine: pii.meta.id,
            }
        : ctx.precomputedPii ?? (await pii.scan(ctx.input ?? '', ctx.orgId));
    return ctx.phase === 'post'
      ? piiOutputVerdict(result, ctx.requirePiiMasking ?? false)
      : piiVerdict(result);
  },
};

// Operator-authored guardrail RULES (the console CRUD table `guardrails_rules`) applied at runtime.
// This is the consumer that was missing: rules created in the UI (matcher = entity|regex, action =
// redact|mask|hash|allow|block|flag|log) actually FIRE here. A `regex` rule transforms every match
// in the input; an `entity` rule acts on a PII-detector hit of that type (so "redact all US_SSN"
// works alongside the base floor). A `block` rule denies the run (verdict 'blocked' → the run path's
// outcomeFromChecks hard-stops it, like injection); a `flag`/`log` rule records a warning (verdict
// 'warn') without blocking or transforming. The transformed text is carried on the result's `detail`
// prefix so the run path can substitute it into the outbound query (see agentrun.ts). Org-scoped:
// the rules loaded are the caller org's. Best-effort load — a missing table / no rules ⇒ 'pass'.
async function resolveCheckOrg(explicitOrgId: string | undefined): Promise<string | null> {
  if (explicitOrgId?.trim()) return explicitOrgId.trim();
  try {
    return await (await import('./tenancy')).currentOrgId();
  } catch {
    // No request scope (worker path without explicit org) — can't resolve; skip operator rules.
    return null;
  }
}

// The masked text a guardrail rule produced is threaded back to the run path via this sentinel
// prefix on the CheckResult.detail, so callers can recover the substituted input WITHOUT changing
// the CheckResult shape (which is persisted). `parseGuardrailMaskedText` reads it back.
const MASKED_PREFIX = 'masked:';
export function encodeMaskedDetail(maskedText: string, human: string): string {
  return `${MASKED_PREFIX}${encodeURIComponent(maskedText)}${human}`;
}
export function parseGuardrailMaskedText(detail: string | undefined): string | null {
  if (!detail?.startsWith(MASKED_PREFIX)) return null;
  const rest = detail.slice(MASKED_PREFIX.length);
  const end = rest.indexOf('');
  const enc = end >= 0 ? rest.slice(0, end) : rest;
  try {
    return decodeURIComponent(enc);
  } catch {
    return null;
  }
}
// Strip the machine sentinel for human display (the run trace / audit detail).
export function humanizeCheckDetail(detail: string | undefined): string | undefined {
  if (!detail) return detail;
  if (!detail.startsWith(MASKED_PREFIX)) return detail;
  const rest = detail.slice(MASKED_PREFIX.length);
  const end = rest.indexOf('');
  return end >= 0 ? rest.slice(end + 1) : undefined;
}

export const guardrailRulesCheck: CheckAdapter = {
  name: 'guardrail-rules',
  phase: 'pre',
  async run(ctx) {
    const input = ctx.input ?? '';
    const orgId = await resolveCheckOrg(ctx.orgId);
    if (!orgId) return { name: 'guardrail-rules', verdict: 'pass' };

    const { loadEnforcedGuardrailRules, applyGuardrailRules } = await import(
      './guardrail-rules-runtime'
    );
    const rules = await loadEnforcedGuardrailRules(orgId);
    if (rules.length === 0) return { name: 'guardrail-rules', verdict: 'pass' };

    // Entity-matcher rules need the PII detector's found types + its redacted text. Regex rules
    // don't — but running one scan is cheap and lets both matcher kinds fire from one place.
    const needsEntity = rules.some((r) => r.matcher === 'entity');
    let detected: string[] = [];
    let detectorRedacted: string | undefined;
    if (needsEntity) {
      const pii = ctx.precomputedPii ?? (await getPii().scan(input, orgId));
      detected = pii.entities;
      detectorRedacted = pii.redacted;
    }

    const outcome = applyGuardrailRules(input, rules, detected, detectorRedacted);
    if (outcome.verdict === 'pass') return { name: 'guardrail-rules', verdict: 'pass' };

    const human = `guardrail rules: ${outcome.fired
      .map((f) => `${f.label || f.pattern}→${f.action}`)
      .join(', ')}`;
    // Only a 'redacted' outcome carries a substituted text back to the run path. A 'blocked' run is
    // hard-stopped (no substitution), and a 'warn' (flag/log) leaves the text untouched — so both
    // report the human summary alone, without the masked-text sentinel that would imply a rewrite.
    return {
      name: 'guardrail-rules',
      verdict: outcome.verdict,
      detail: outcome.verdict === 'redacted' ? encodeMaskedDetail(outcome.text, human) : human,
    };
  },
};

export const injectionCheck: CheckAdapter = {
  name: 'injection',
  phase: 'pre',
  run(ctx) {
    const hit = INJECTION.test(ctx.input ?? '');
    return {
      name: 'injection',
      verdict: hit ? 'blocked' : 'pass',
      detail: hit ? 'injection pattern' : undefined,
    };
  },
};

export const groundingCheck: CheckAdapter = {
  name: 'grounding',
  phase: 'post',
  run(ctx) {
    const grounded = /\[\d+\]|source:|cite/i.test(ctx.output ?? '');
    return { name: 'grounding', verdict: grounded ? 'pass' : 'warn', score: grounded ? 0.9 : 0.4 };
  },
};

const REGISTRY: CheckAdapter[] = [piiCheck, guardrailRulesCheck, injectionCheck, groundingCheck];

// Drift guard: the wired REGISTRY must match the canonical CHECK_IDS list (check-ids.ts) exactly, so
// the pure id list the policy editor constrains against can never fall out of sync with what runs.
{
  const wired = REGISTRY.map((a) => a.name);
  const canonical = [...CHECK_IDS];
  if (wired.length !== canonical.length || wired.some((n, i) => n !== canonical[i])) {
    throw new Error(
      `checks REGISTRY (${wired.join(',')}) drifted from CHECK_IDS (${canonical.join(',')})`,
    );
  }
}

export async function runChecks(
  phase: 'pre' | 'post',
  ctx: CheckContext,
  deps: CheckRunnerDeps = {},
): Promise<CheckResult[]> {
  // The pre-screen always includes `piiCheck`, and entity-based operator rules consume the same
  // detector verdict. Resolve it once at the orchestration seam and reuse it across both adapters;
  // remote guardrail I/O must never be duplicated for the same text in one screen.
  let sharedCtx: CheckExecutionContext = ctx;
  if (phase === 'pre') {
    const scanStartedAt = Date.now();
    const scanPii = deps.scanPii ?? ((text: string, orgId?: string) => getPii().scan(text, orgId));
    sharedCtx = {
      ...ctx,
      precomputedPii: await scanPii(ctx.input ?? '', ctx.orgId),
      precomputedPiiMs: Date.now() - scanStartedAt,
    };
  }
  const out: CheckResult[] = [];
  for (const adapter of REGISTRY.filter((a) => a.phase === phase || a.phase === 'both')) {
    const start = Date.now();
    const r = await adapter.run({ ...sharedCtx, phase });
    const measuredMs = Date.now() - start;
    out.push({
      ...r,
      ms:
        r.ms ??
        (phase === 'pre' && adapter.name === 'pii'
          ? (sharedCtx.precomputedPiiMs ?? measuredMs)
          : measuredMs),
    });
  }
  return out;
}

// Derive the request outcome from the worst verdict across all checks.
export function outcomeFromChecks(checks: CheckResult[]): 'ok' | 'redacted' | 'blocked' {
  if (checks.some((c) => c.verdict === 'blocked' || c.verdict === 'fail')) return 'blocked';
  if (checks.some((c) => c.verdict === 'redacted')) return 'redacted';
  return 'ok';
}
