// The demo TELEMETRY generator — the highest-leverage part of the seed. PURE, zero I/O, fully
// deterministic (seeded PRNG). Given a tenant profile + its governed apps, it produces a realistic
// body of RUN records — tokens, latency, cost, outcome (ok/blocked), guardrail verdict, eval score,
// and a timestamp spread over the trailing ~30 days — so every read surface lights up with believable
// numbers that AGREE with each other:
//   • Overview tiles / Runs / Audit / ROI  ← agent_runs + app_runs rows (Postgres)
//   • Evals / Drift                          ← eval_runs rows (Postgres)
//   • Analytics / FinOps / Observability     ← the SAME shape, emitted to the gateway telemetry sink
//                                              (OpenSearch offgrid-gateway) by the runner IF reachable;
//                                              otherwise FLAGGED for the operator (infra, not code).
//
// Bank vs insurer DIFFER by design: the bank runs higher volume at a lower per-run cost (retail
// scale), the insurer runs fewer, heavier assessments — so the tiles read as two different books.
//
// SOLID/DRY: the run COUNTS and per-app persona already live in tour-demo-seed (runStatuses/appsFor);
// this module reuses them and only adds the per-run METRICS the existing planners don't carry. The
// runner maps these records onto the store rows.
import { hash12, type TenantProfile, appsFor, runStatuses, type AppSpecSeed } from '@/lib/tour-demo-seed';
import { makePrng, type Prng } from '@/lib/demo/prng';

/** One synthetic run's metrics — engine-agnostic, maps onto agent_runs/app_runs + the gateway sink. */
export interface RunMetric {
  /** Deterministic run id (stable across re-runs). */
  id: string;
  /** The app/use-case key this run belongs to (for pipeline attribution). */
  appKey: string;
  /** Human title of the use case (denormalized for the gateway sink `project` tag). */
  appTitle: string;
  /** done | awaiting_human — the run lifecycle state (from the app's run counts). */
  status: 'done' | 'awaiting_human';
  /** ok | blocked — the governance outcome (a small share are guardrail-blocked). */
  outcome: 'ok' | 'blocked';
  /** The model that served the run. */
  model: string;
  promptTokens: number;
  completionTokens: number;
  get totalTokens(): number;
  /** End-to-end latency in milliseconds. */
  latencyMs: number;
  /** Cost of the run in USD (the FinOps unit; INR shown in-product via fx). */
  costUsd: number;
  /** The guardrail verdict for the run (pass = clean, redacted = PII masked, blocked = refused). */
  guardrailVerdict: 'pass' | 'redacted' | 'blocked';
  /** Eval score 0..100 for the run (drives Evals pass-rate + Drift). */
  evalScore: number;
  /** ISO timestamp, spread over the trailing window. */
  ts: string;
}

/** Per-flavour volume + cost profile, so the bank and insurer read as different books. */
export interface FlavourProfile {
  /** On-prem model most runs use. */
  primaryModel: string;
  /** A cloud model a minority of runs spill to (shows egress on the leash). */
  cloudModel: string;
  /** Share of runs that spill to the cloud model (0..1). */
  cloudShare: number;
  /** Prompt-token range per run [min, max]. */
  promptTokens: [number, number];
  /** Completion-token range per run [min, max]. */
  completionTokens: [number, number];
  /** Latency range in ms [min, max]. */
  latencyMs: [number, number];
  /** USD per 1K tokens (blended) — the bank runs cheaper at scale. */
  usdPer1k: number;
  /** Share of runs the guardrails REDACT (PII masked) vs let pass clean (0..1). */
  redactShare: number;
  /** Share of runs the guardrails BLOCK outright (0..1). */
  blockShare: number;
  /** Eval score range [min, max] — the insurer's heavier judgement scores marginally lower. */
  evalScore: [number, number];
}

export const BANK_FLAVOUR: FlavourProfile = {
  primaryModel: 'qwen2.5:14b',
  cloudModel: 'gpt-4o-mini',
  cloudShare: 0.12,
  promptTokens: [420, 1600],
  completionTokens: [180, 700],
  latencyMs: [380, 2600],
  usdPer1k: 0.0008,
  redactShare: 0.22,
  blockShare: 0.04,
  evalScore: [82, 99],
};

export const INSURER_FLAVOUR: FlavourProfile = {
  primaryModel: 'llama3.1:70b',
  cloudModel: 'claude-3-5-haiku-latest',
  cloudShare: 0.18,
  promptTokens: [900, 3200],
  completionTokens: [320, 1200],
  latencyMs: [700, 4200],
  usdPer1k: 0.0022,
  redactShare: 0.28,
  blockShare: 0.06,
  evalScore: [78, 97],
};

/** The flavour profile for a tenant. */
export function flavourProfile(profile: TenantProfile): FlavourProfile {
  return profile.flavour === 'bank' ? BANK_FLAVOUR : INSURER_FLAVOUR;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Build one run's metrics deterministically from the app + run index, seeded so a re-run reproduces
 * the exact same numbers. `now` is injected (never Date.now() inside) so tests are stable and the
 * timestamps sit relative to a known reference. Runs are spread across the trailing `windowDays`.
 */
export function buildRunMetric(
  profile: TenantProfile,
  fp: FlavourProfile,
  app: AppSpecSeed,
  index: number,
  status: 'done' | 'awaiting_human',
  now: number,
  windowDays: number,
): RunMetric {
  const rng: Prng = makePrng(`${profile.orgId}:metric:${app.key}:${index}`);
  const cloud = rng.chance(fp.cloudShare);
  const model = cloud ? fp.cloudModel : fp.primaryModel;
  const promptTokens = rng.int(fp.promptTokens[0], fp.promptTokens[1]);
  const completionTokens = rng.int(fp.completionTokens[0], fp.completionTokens[1]);
  const total = promptTokens + completionTokens;
  // Cloud runs cost ~4x the on-prem blended rate — makes the egress leash visible in FinOps.
  const rate = cloud ? fp.usdPer1k * 4 : fp.usdPer1k;
  const costUsd = Number(((total / 1000) * rate).toFixed(4));
  const latencyMs = rng.int(fp.latencyMs[0], fp.latencyMs[1]);

  // Guardrail verdict: a small share blocked, a larger share redacted, the rest clean.
  const r = rng.next();
  const guardrailVerdict: RunMetric['guardrailVerdict'] =
    r < fp.blockShare ? 'blocked' : r < fp.blockShare + fp.redactShare ? 'redacted' : 'pass';
  const outcome: RunMetric['outcome'] = guardrailVerdict === 'blocked' ? 'blocked' : 'ok';
  const evalScore = rng.int(fp.evalScore[0], fp.evalScore[1]);

  // Spread across the window: index-driven so runs march back in time, with per-run jitter.
  const dayOffset = rng.float(0, windowDays);
  const ts = new Date(now - dayOffset * DAY_MS - rng.int(0, DAY_MS)).toISOString();

  return {
    id: `run_${hash12(`${profile.orgId}:metric:${app.key}:${index}`)}`,
    appKey: app.key,
    appTitle: app.title,
    status,
    outcome,
    model,
    promptTokens,
    completionTokens,
    get totalTokens() {
      return this.promptTokens + this.completionTokens;
    },
    latencyMs,
    costUsd,
    guardrailVerdict,
    evalScore,
    ts,
  };
}

/**
 * The full run corpus for a tenant — one RunMetric per (app, run) across every governed app, using
 * the app's own run counts (done + awaiting_human) from tour-demo-seed. Deterministic + idempotent.
 */
export function buildRunCorpus(
  profile: TenantProfile,
  now: number,
  windowDays = 30,
): RunMetric[] {
  const fp = flavourProfile(profile);
  const out: RunMetric[] = [];
  for (const app of appsFor(profile)) {
    const statuses = runStatuses(app);
    statuses.forEach((status, i) => {
      out.push(
        buildRunMetric(profile, fp, app, i, status as 'done' | 'awaiting_human', now, windowDays),
      );
    });
  }
  return out;
}

/** Rollup used by the report + tests — totals a tenant's corpus so the numbers can be asserted. */
export interface CorpusRollup {
  runs: number;
  blocked: number;
  redacted: number;
  totalTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  avgEvalScore: number;
}

export function rollupCorpus(corpus: readonly RunMetric[]): CorpusRollup {
  if (corpus.length === 0) {
    return { runs: 0, blocked: 0, redacted: 0, totalTokens: 0, totalCostUsd: 0, avgLatencyMs: 0, avgEvalScore: 0 };
  }
  let blocked = 0;
  let redacted = 0;
  let tokens = 0;
  let cost = 0;
  let latency = 0;
  let evalSum = 0;
  for (const m of corpus) {
    if (m.outcome === 'blocked') blocked++;
    if (m.guardrailVerdict === 'redacted') redacted++;
    tokens += m.totalTokens;
    cost += m.costUsd;
    latency += m.latencyMs;
    evalSum += m.evalScore;
  }
  return {
    runs: corpus.length,
    blocked,
    redacted,
    totalTokens: tokens,
    totalCostUsd: Number(cost.toFixed(4)),
    avgLatencyMs: Math.round(latency / corpus.length),
    avgEvalScore: Math.round(evalSum / corpus.length),
  };
}
