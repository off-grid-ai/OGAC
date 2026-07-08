// ─── Data-quality model — PURE, zero-IO (SOLID: logic isolated from the adapter's fetch) ──────
//
// The console's data-quality feature ships a dataset window + an expectation suite to the Great
// Expectations sidecar (deploy/sidecars/great-expectations/app.py) and gets back a pass/fail
// verdict. This module owns everything that needs NO network:
//   - expectation constructors (the sidecar's supported vocabulary),
//   - buildCheckpoint(rows, expectations)   → the exact request body the sidecar accepts,
//   - parseCheckpointResult(raw)            → normalize the sidecar response into a stable verdict,
//   - summarize(result)                     → a one-line pass/fail rollup,
//   - failureVerdict(...)                   → a well-formed "engine unreachable" verdict (no throw).
//
// It is unit-testable with no mocks and NO imports. The adapter (adapters/data-quality.ts) does
// only fetch/timeout/IO and delegates build + parse here.
//
// Sidecar contract it matches EXACTLY (app.py):
//   Request  POST /checkpoint/{suite}
//     { rows: [ {col: value, ...}, ... ],
//       expectations: [ { type, column?, min?, max?, value_set? }, ... ] }
//   Response
//     { success: bool, evaluated: int,
//       failed: [ { type, column, unexpected_count, note? }, ... ] }
//
// Supported expectation `type`s in the sidecar (its fallback evaluator + the GE vocabulary):
//   expect_column_values_to_not_be_null  (column)
//   expect_column_values_to_be_between   (column, min?, max?)
//   expect_column_values_to_be_in_set    (column, value_set)
//   expect_column_to_exist               (column)
// A distinct/unique check isn't in the sidecar's fallback vocabulary; expectUnique maps to the GE
// name `expect_column_values_to_be_unique` so it rides the real engine path (and is honestly
// reported as unsupported by the fallback when the stub is active, never silently "passed").

// ─── Expectation shape (matches the sidecar's `Expectation` pydantic model) ────────────────────
export interface Expectation {
  type: string;
  column?: string;
  min?: number;
  max?: number;
  value_set?: unknown[];
}

export type Row = Record<string, unknown>;

// The request body for POST /checkpoint/{suite}.
export interface Checkpoint {
  rows: Row[];
  expectations: Expectation[];
}

// The raw sidecar response (before normalization).
export interface RawCheckpointResult {
  success?: boolean;
  evaluated?: number;
  failed?: RawFailure[];
}

export interface RawFailure {
  type?: string;
  column?: string | null;
  unexpected_count?: number;
  note?: string;
}

// ─── The normalized verdict every caller/route consumes ─────────────────────────────────────────
export interface ExpectationResult {
  expectation: string; // human-ish "type on column"
  type: string;
  column?: string;
  success: boolean;
  unexpectedCount: number; // -1 = unsupported by the running engine
  detail: string;
}

export interface CheckpointVerdict {
  success: boolean;
  total: number; // expectations evaluated
  passed: number;
  failed: number;
  results: ExpectationResult[];
  engineReachable: boolean; // false when we synthesized a failure verdict (sidecar down)
  note?: string;
}

// ─── Expectation constructors — the supported vocabulary ────────────────────────────────────────
export function expectNotNull(column: string): Expectation {
  return { type: 'expect_column_values_to_not_be_null', column };
}

export function expectInRange(
  column: string,
  min?: number,
  max?: number,
): Expectation {
  const exp: Expectation = { type: 'expect_column_values_to_be_between', column };
  if (min !== undefined) exp.min = min;
  if (max !== undefined) exp.max = max;
  return exp;
}

export function expectInSet(column: string, values: unknown[]): Expectation {
  return { type: 'expect_column_values_to_be_in_set', column, value_set: values };
}

export function expectColumnExists(column: string): Expectation {
  return { type: 'expect_column_to_exist', column };
}

// Uniqueness rides the real GE engine (the sidecar's fallback stub reports it unsupported honestly
// rather than passing it silently — see parseCheckpointResult, unexpected_count === -1).
export function expectUnique(column: string): Expectation {
  return { type: 'expect_column_values_to_be_unique', column };
}

// ─── buildCheckpoint — assemble the exact request body ──────────────────────────────────────────
// Defensively coerce inputs so a route handing us loose JSON can't produce a malformed body:
// rows must be plain objects, expectations must carry a string `type`.
export function buildCheckpoint(rows: unknown, expectations: unknown): Checkpoint {
  const safeRows: Row[] = Array.isArray(rows)
    ? rows.filter((r): r is Row => !!r && typeof r === 'object' && !Array.isArray(r))
    : [];
  const safeExps: Expectation[] = Array.isArray(expectations)
    ? expectations
        .filter((e): e is Expectation => !!e && typeof e === 'object' && typeof (e as Expectation).type === 'string')
        .map((e) => {
          const exp: Expectation = { type: e.type };
          if (typeof e.column === 'string') exp.column = e.column;
          if (typeof e.min === 'number') exp.min = e.min;
          if (typeof e.max === 'number') exp.max = e.max;
          if (Array.isArray(e.value_set)) exp.value_set = e.value_set;
          return exp;
        })
    : [];
  return { rows: safeRows, expectations: safeExps };
}

// A readable label for an expectation, used in the per-result detail line.
function label(type: string, column?: string): string {
  return column ? `${type} [${column}]` : type;
}

// ─── parseCheckpointResult — normalize the sidecar response into a stable verdict ───────────────
// The sidecar reports only the FAILED expectations (with unexpected_count) plus a total `evaluated`
// count. We reconstruct a per-expectation result list: any expectation named in `failed` is a fail
// (with its unexpected_count / note surfaced), and the remaining evaluated count are passes.
//
// We can't recover the passing expectations' identities from the response (it only names failures),
// so passes are represented as synthesized "passed" entries — the counts (total/passed/failed) are
// exact, which is what the rollup and UI need. `unexpected_count === -1` marks an expectation the
// running engine couldn't evaluate (the sidecar's honest "unsupported in fallback" signal); it is
// counted as a FAIL so nothing is silently green.
export function parseCheckpointResult(raw: RawCheckpointResult): CheckpointVerdict {
  const failedRaw = Array.isArray(raw.failed) ? raw.failed : [];
  const total = typeof raw.evaluated === 'number' ? raw.evaluated : failedRaw.length;

  const failedResults: ExpectationResult[] = failedRaw.map((f) => {
    const type = f.type ?? 'unknown';
    const column = f.column ?? undefined;
    const uc = typeof f.unexpected_count === 'number' ? f.unexpected_count : 0;
    const unsupported = uc === -1;
    return {
      expectation: label(type, column),
      type,
      column,
      success: false,
      unexpectedCount: uc,
      detail: f.note
        ? f.note
        : unsupported
          ? 'expectation not supported by the running engine'
          : `${uc} unexpected value${uc === 1 ? '' : 's'}`,
    };
  });

  const failed = failedResults.length;
  const passed = Math.max(0, total - failed);

  // Synthesize the passing entries (identities aren't in the response; counts are exact).
  const passedResults: ExpectationResult[] = Array.from({ length: passed }, (_, i) => ({
    expectation: `passed_expectation_${i + 1}`,
    type: 'passed',
    success: true,
    unexpectedCount: 0,
    detail: 'no unexpected values',
  }));

  // Success = the sidecar's own flag when present, else no failures.
  const success = typeof raw.success === 'boolean' ? raw.success : failed === 0;

  return {
    success,
    total,
    passed,
    failed,
    results: [...failedResults, ...passedResults],
    engineReachable: true,
  };
}

// ─── failureVerdict — the honest "sidecar unreachable" result (adapter returns this, never throws)
export function failureVerdict(expectations: Expectation[], reason: string): CheckpointVerdict {
  const total = expectations.length;
  return {
    success: false,
    total,
    passed: 0,
    failed: total,
    results: expectations.map((e) => ({
      expectation: label(e.type, e.column),
      type: e.type,
      column: e.column,
      success: false,
      unexpectedCount: -1,
      detail: `not evaluated — data-quality engine unreachable (${reason})`,
    })),
    engineReachable: false,
    note: `data-quality engine unreachable: ${reason}`,
  };
}

// ─── summarize — a one-line pass/fail rollup for the UI / logs ──────────────────────────────────
export function summarize(v: CheckpointVerdict): string {
  if (!v.engineReachable) return v.note ?? 'data-quality engine unreachable';
  if (v.total === 0) return 'no expectations evaluated';
  const verdict = v.success ? 'PASS' : 'FAIL';
  return `${verdict} — ${v.passed}/${v.total} expectations passed, ${v.failed} failed`;
}
