// PURE golden-case validation/normalization — ZERO imports, ZERO I/O, so it is unit-testable in
// isolation (node --test, type-stripped) without pulling in `@/db` or Next. Mirrors the
// tenancy-policy.ts pattern: the write routes/store call these to validate + shape a golden case
// before touching the DB, and the run route uses `resolveRunEngine` to gate which engine may run.

export interface GoldenCaseInput {
  name?: unknown;
  query?: unknown;
  expected?: unknown;
  suite?: unknown;
}

// A clean, DB-ready golden case draft: trimmed strings, a defaulted suite, and a name that falls
// back to the query when omitted so every row is labelled.
export interface GoldenCaseDraft {
  name: string;
  query: string;
  expected: string;
  suite: string;
}

export type GoldenCaseValidation =
  | { ok: true; value: GoldenCaseDraft }
  | { ok: false; error: string };

// The engines a run may target — mirrors the registered EVALS_PORTS ids. A golden case's `suite`
// is free-form (which suite it belongs to), but a RUN must name one of these evaluators.
export const RUNNABLE_ENGINES = ['golden', 'promptfoo', 'ragas'] as const;
export type RunnableEngine = (typeof RUNNABLE_ENGINES)[number];

export const DEFAULT_SUITE = 'golden';

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// Validate + normalize a golden-case create/update payload. Query and expected are required;
// name defaults to the query; suite defaults to `golden`. Never throws — returns a discriminated
// result the thin route maps to a 400 or a store write.
export function validateGoldenCase(input: GoldenCaseInput | null | undefined): GoldenCaseValidation {
  const src = input ?? {};
  const query = trimStr(src.query);
  const expected = trimStr(src.expected);
  if (!query) return { ok: false, error: 'query is required' };
  if (!expected) return { ok: false, error: 'expected is required' };
  const name = trimStr(src.name) || query;
  const suite = trimStr(src.suite) || DEFAULT_SUITE;
  return { ok: true, value: { name, query, expected, suite } };
}

// Is `engine` one the run route may execute? Case-insensitive, whitespace-tolerant. Undefined /
// unknown → not runnable.
export function isRunnableEngine(engine: unknown): engine is RunnableEngine {
  const e = trimStr(engine).toLowerCase();
  return (RUNNABLE_ENGINES as readonly string[]).includes(e);
}

// Coerce a requested engine to a runnable one, defaulting to golden when omitted (empty request =
// run the always-on default). Returns null when a non-empty but unknown engine was requested.
export function resolveRunEngine(engine: unknown): RunnableEngine | null {
  const e = trimStr(engine).toLowerCase();
  if (!e) return 'golden';
  return isRunnableEngine(e) ? (e as RunnableEngine) : null;
}
