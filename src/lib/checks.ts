import { getPii } from './adapters/registry';

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
}

export interface CheckContext {
  phase: 'pre' | 'post';
  input?: string;
  output?: string;
  model?: string;
}

export interface CheckAdapter {
  name: string;
  phase: 'pre' | 'post';
  run(ctx: CheckContext): Promise<CheckResult> | CheckResult;
}

const INJECTION = /\b(ignore (all |the )?previous|disregard (the )?instructions|system prompt)\b/i;

// PII runs through the guardrails port — regex by default, Presidio when OFFGRID_ADAPTER_GUARDRAILS
// =presidio. The verdict shape is identical regardless of which engine answered.
export const piiCheck: CheckAdapter = {
  name: 'pii',
  phase: 'pre',
  async run(ctx) {
    const result = await getPii().scan(ctx.input ?? '');
    return {
      name: 'pii',
      verdict: result.hits ? 'redacted' : 'pass',
      detail: result.hits ? `PII (${result.engine}): ${result.entities.join(', ')}` : undefined,
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

const REGISTRY: CheckAdapter[] = [piiCheck, injectionCheck, groundingCheck];

export async function runChecks(phase: 'pre' | 'post', ctx: CheckContext): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  for (const adapter of REGISTRY.filter((a) => a.phase === phase)) {
    const start = Date.now();
    const r = await adapter.run({ ...ctx, phase });
    out.push({ ...r, ms: r.ms ?? Date.now() - start });
  }
  return out;
}

// Derive the request outcome from the worst verdict across all checks.
export function outcomeFromChecks(checks: CheckResult[]): 'ok' | 'redacted' | 'blocked' {
  if (checks.some((c) => c.verdict === 'blocked' || c.verdict === 'fail')) return 'blocked';
  if (checks.some((c) => c.verdict === 'redacted')) return 'redacted';
  return 'ok';
}
