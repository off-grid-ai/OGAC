// PURE evals display-model normalizer — the top of this file has ZERO imports and ZERO I/O, so it
// is unit-testable in isolation (node --test, type-stripped) without pulling in `@/db` or Next.
// Given raw eval-run + golden-case records it computes the read-back display model the Evals page
// renders: aggregate pass/fail counts, an overall pass-rate %, a per-suite (engine) rollup, and the
// recent runs newest-first. The thin store reader (readEvalsView, at the bottom) is kept separate
// and imports the DB-backed store lazily so it never contaminates the pure module for tests.

// ── Raw shapes (only the fields we read; everything optional/defensive) ────────────────────────
export interface RawEvalRun {
  id?: string;
  // Engine/suite that produced the run. Older golden runs (from `listEvalRuns`) omit it; those
  // roll up under the default suite name below.
  engine?: string;
  score?: number; // 0..100 aggregate metric / pass-rate
  total?: number;
  passed?: number;
  startedAt?: string;
}

export interface RawGoldenCase {
  id?: string;
  query?: string;
  expected?: string;
}

// ── Clean display model ────────────────────────────────────────────────────────────────────────
export interface EvalRunView {
  id: string;
  engine: string;
  score: number; // 0..100, clamped
  total: number;
  passed: number;
  failed: number;
  startedAt: string | null;
}

export interface SuiteRollup {
  engine: string;
  runs: number;
  total: number; // cases evaluated across this suite's runs
  passed: number;
  failed: number;
  passRate: number; // 0..100, cases passed / cases evaluated
  lastRun: string | null; // newest startedAt seen in this suite
}

export interface EvalsTotals {
  runs: number;
  cases: number; // total cases evaluated across all runs
  passed: number;
  failed: number;
  passRate: number; // 0..100 across all cases
}

export interface EvalsView {
  totals: EvalsTotals;
  suites: SuiteRollup[]; // one per engine, most-recently-run first
  recentRuns: EvalRunView[]; // newest-first
  goldenCases: number; // size of the golden set the suites run against
}

const DEFAULT_SUITE = 'golden';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// A finite, non-negative integer or 0 — raw records can carry nulls, NaN, or floats.
function nonNegInt(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
  return n > 0 ? n : 0;
}

// Clamp a score into 0..100 (rounded). Undefined/garbage → 0.
function clampScore(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function rate(passed: number, total: number): number {
  return total > 0 ? Math.round((passed / total) * 100) : 0;
}

// Passed is capped at total so a malformed record (passed > total) can't produce a negative failed
// count or a pass-rate over 100%.
function normalizeRun(raw: RawEvalRun): EvalRunView {
  const total = nonNegInt(raw?.total);
  const passed = Math.min(nonNegInt(raw?.passed), total);
  return {
    id: str(raw?.id) ?? '(unknown)',
    engine: str(raw?.engine) ?? DEFAULT_SUITE,
    score: clampScore(raw?.score),
    total,
    passed,
    failed: total - passed,
    startedAt: str(raw?.startedAt),
  };
}

// Sort helper — newest startedAt first; runs without a timestamp sink to the bottom, ties stable.
function byStartedDesc(a: EvalRunView, b: EvalRunView): number {
  if (a.startedAt === b.startedAt) return 0;
  if (a.startedAt === null) return 1;
  if (b.startedAt === null) return -1;
  return a.startedAt < b.startedAt ? 1 : -1;
}

export interface NormalizeEvalsInput {
  runs?: RawEvalRun[] | null;
  goldenCases?: RawGoldenCase[] | null;
}

// Normalize raw eval-run + golden-case records into the clean display model. Never throws — any
// missing or malformed field degrades to a safe default rather than crashing the read-back page.
export function normalizeEvals(input: NormalizeEvalsInput | null | undefined): EvalsView {
  const src = input ?? {};
  const runs = (Array.isArray(src.runs) ? src.runs : []).map(normalizeRun).sort(byStartedDesc);

  // Per-suite rollup, keyed by engine. Insertion order follows recentRuns (already newest-first),
  // so the resulting suites list is most-recently-run first.
  const suiteMap = new Map<string, SuiteRollup>();
  for (const r of runs) {
    let s = suiteMap.get(r.engine);
    if (!s) {
      s = {
        engine: r.engine,
        runs: 0,
        total: 0,
        passed: 0,
        failed: 0,
        passRate: 0,
        lastRun: null,
      };
      suiteMap.set(r.engine, s);
    }
    s.runs += 1;
    s.total += r.total;
    s.passed += r.passed;
    s.failed += r.failed;
    if (r.startedAt && (s.lastRun === null || r.startedAt > s.lastRun)) s.lastRun = r.startedAt;
  }
  const suites = [...suiteMap.values()];
  for (const s of suites) s.passRate = rate(s.passed, s.total);

  const cases = runs.reduce((n, r) => n + r.total, 0);
  const passed = runs.reduce((n, r) => n + r.passed, 0);
  const failed = cases - passed;

  const goldenCases = (Array.isArray(src.goldenCases) ? src.goldenCases : []).length;

  return {
    totals: {
      runs: runs.length,
      cases,
      passed,
      failed,
      passRate: rate(passed, cases),
    },
    suites,
    recentRuns: runs,
    goldenCases,
  };
}

// ── Thin reader (I/O) ────────────────────────────────────────────────────────────────────────
// Pulls from the existing evals store and hands the raw records to the pure normalizer above.
// The store (`@/lib/evals` → `@/db`) is imported lazily so the top of this module stays import-free
// and the pure normalizer can be unit-tested without a DB. Best-effort: never throws.
export async function readEvalsView(limit = 25, orgId?: string): Promise<EvalsView> {
  const { listEvalRuns, listGoldenCases } = await import('@/lib/evals');
  // Scope the runs to the caller's org (undefined → DEFAULT_ORG in the store) so one tenant's
  // pass-rate rollup never surfaces another org's runs.
  const [runs, goldenCases] = await Promise.all([listEvalRuns(limit, orgId), listGoldenCases()]);
  return normalizeEvals({ runs, goldenCases });
}
