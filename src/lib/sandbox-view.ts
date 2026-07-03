// Pure sandbox display normalizer — ZERO imports (no @/db, no path aliases, no adapter modules),
// so it's unit-testable in isolation like tenancy-policy.ts. This is the single source of truth
// for turning raw sandbox status + exec-run records into the shape the /sandbox page renders.
// The thin best-effort reader at the bottom is the ONLY part that touches I/O (the adapter); it
// is separated from the rule so the display logic can be exercised without any live backend.
//
// Design model (see src/lib/adapters/sandbox.ts + types.ts):
//   - backend id: 'none' | 'docker' | 'firecracker' | 'e2b' | 'falco' | ...
//   - reachable: did the adapter's health() succeed
//   - exec runs: recent SandboxResult-shaped records; we derive a status per run and sort them
//     newest-first, then tally counts by status.

// ─── Raw input shapes (what the reader/DB hand in) ──────────────────────────────
export interface RawSandboxStatus {
  // Active adapter metadata (from AdapterMeta).
  id?: unknown;
  vendor?: unknown;
  license?: unknown;
  description?: unknown;
  // health() result — true when the backend responded.
  reachable?: unknown;
}

export interface RawExecRun {
  id?: unknown;
  engine?: unknown;
  language?: unknown;
  ok?: unknown;
  exitCode?: unknown;
  timedOut?: unknown;
  refused?: unknown; // non-empty when the no-exec default declined the run
  durationMs?: unknown;
  createdAt?: unknown; // ISO timestamp
}

// ─── Display model ──────────────────────────────────────────────────────────────
export type ExecStatus = 'ok' | 'failed' | 'timeout' | 'refused';

export interface ExecRunView {
  id: string;
  engine: string;
  language: string;
  status: ExecStatus;
  exitCode: number | null;
  durationMs: number | null;
  createdAt: string; // ISO, or '' when unknown
}

export interface SandboxView {
  backend: string; // adapter id, e.g. 'docker'; 'unknown' when absent
  vendor: string;
  license: string;
  description: string;
  reachable: boolean;
  // True when the active backend refuses arbitrary execution (the safe no-exec default).
  execDisabled: boolean;
  runs: ExecRunView[]; // newest-first
  counts: Record<ExecStatus, number>;
  total: number;
}

// ─── Helpers (pure) ─────────────────────────────────────────────────────────────
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v : fallback;
}

function intOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// Classify one exec record. Precedence: refused (declined, never attempted) → timeout →
// failed (any non-ok) → ok. Mirrors the SandboxResult contract in adapters/types.ts.
export function classifyRun(run: RawExecRun): ExecStatus {
  if (typeof run.refused === 'string' && run.refused.trim()) return 'refused';
  if (run.timedOut === true) return 'timeout';
  if (run.ok === true) return 'ok';
  return 'failed';
}

function normalizeRun(run: RawExecRun, idx: number): ExecRunView {
  return {
    id: str(run.id, `run-${idx}`),
    engine: str(run.engine, 'unknown'),
    language: str(run.language, 'unknown'),
    status: classifyRun(run),
    exitCode: intOrNull(run.exitCode),
    durationMs: intOrNull(run.durationMs),
    createdAt: str(run.createdAt),
  };
}

const EMPTY_COUNTS = (): Record<ExecStatus, number> => ({ ok: 0, failed: 0, timeout: 0, refused: 0 });

/**
 * Normalize raw sandbox status + exec-run records into the page display model. Pure and total —
 * NEVER throws, tolerates missing/garbage fields, and always returns a fully-formed SandboxView.
 * Runs are sorted newest-first by createdAt (records without a timestamp sort to the end, stably).
 */
export function normalizeSandbox(
  status: RawSandboxStatus | null | undefined,
  execRuns: readonly RawExecRun[] | null | undefined,
): SandboxView {
  const s = status ?? {};
  const backend = str(s.id, 'unknown');

  const rawRuns = Array.isArray(execRuns) ? execRuns : [];
  const runs = rawRuns
    .map((r, i) => normalizeRun(r ?? {}, i))
    .sort((a, b) => {
      // Newest-first; blank timestamps sink to the bottom.
      if (a.createdAt && b.createdAt) return b.createdAt.localeCompare(a.createdAt);
      if (a.createdAt) return -1;
      if (b.createdAt) return 1;
      return 0;
    });

  const counts = EMPTY_COUNTS();
  for (const r of runs) counts[r.status] += 1;

  return {
    backend,
    vendor: str(s.vendor, 'unknown'),
    license: str(s.license, 'unknown'),
    description: str(s.description),
    reachable: s.reachable === true,
    execDisabled: backend === 'none',
    runs,
    counts,
    total: runs.length,
  };
}

// ─── Run-Code request + result (pure) ───────────────────────────────────────────
// The Run Code panel POSTs to /api/v1/admin/sandbox/run. buildRunRequest validates+normalizes the
// user's input into the exact body that route accepts (language: 'python'|'node', code, timeoutMs);
// normalizeRunResult maps a raw SandboxResult into the display model the panel renders. Both are
// pure and import-free so they're unit-testable without any live backend.

export type RunLanguage = 'python' | 'node';

// Hard cap enforced by the run route (Math.min(timeoutMs, 30_000)); we mirror it as the default so
// the client sends the max allowed window.
export const RUN_TIMEOUT_MS = 30_000;

export interface RunRequest {
  language: RunLanguage;
  code: string;
  timeoutMs: number;
}

export type BuildRunResult =
  | { ok: true; request: RunRequest }
  | { ok: false; error: string };

/**
 * Validate + normalize a run request. Rejects unknown languages and empty/whitespace-only code
 * (mirroring the route's 400s) so the UI can surface the error without a round-trip. Pure — no I/O.
 */
export function buildRunRequest(language: unknown, code: unknown): BuildRunResult {
  if (language !== 'python' && language !== 'node') {
    return { ok: false, error: "language must be 'python' or 'node'" };
  }
  if (typeof code !== 'string' || !code.trim()) {
    return { ok: false, error: 'code is required' };
  }
  return { ok: true, request: { language, code, timeoutMs: RUN_TIMEOUT_MS } };
}

export type RunOutcome = 'ok' | 'failed' | 'timeout' | 'refused';

export interface RunResultView {
  outcome: RunOutcome;
  engine: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  refused: string; // human message when the run was declined (no-exec default); '' otherwise
}

/**
 * Map a raw run result (a SandboxResult, possibly with an { error } from a non-2xx response) into
 * the panel display model. Pure and total — tolerates missing/garbage fields, never throws.
 * Outcome precedence mirrors classifyRun: refused → timeout → failed → ok.
 */
export function normalizeRunResult(raw: unknown): RunResultView {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const refused = typeof r.refused === 'string' && r.refused.trim() ? r.refused : '';
  // A non-2xx JSON body from the route carries { error }; surface it as stderr so it's visible.
  const errText = typeof r.error === 'string' ? r.error : '';
  const timedOut = r.timedOut === true;
  const ok = r.ok === true;

  let outcome: RunOutcome;
  if (refused) outcome = 'refused';
  else if (timedOut) outcome = 'timeout';
  else if (ok) outcome = 'ok';
  else outcome = 'failed';

  return {
    outcome,
    engine: str(r.engine, 'unknown'),
    stdout: str(r.stdout),
    stderr: str(r.stderr) || errText,
    exitCode: intOrNull(r.exitCode),
    timedOut,
    refused,
  };
}

// ─── Thin best-effort reader (the ONLY I/O seam) ────────────────────────────────
// Minimal structural contract for the sandbox adapter — just what the reader needs, so this file
// stays import-free and the reader can be handed any conforming port (real or a test double).
export interface SandboxHealthSource {
  meta: { id: string; vendor: string; license: string; description: string };
  health(): Promise<boolean>;
}

export interface SandboxStatusRead {
  data: RawSandboxStatus | null;
  error: string | null;
}

// Read the active adapter's status/health without ever throwing — failures are captured as
// `error` and a null-status fallback, so the route/page can render a degraded state cleanly.
export async function readSandboxStatus(
  adapter: SandboxHealthSource | null | undefined,
): Promise<SandboxStatusRead> {
  if (!adapter || typeof adapter.health !== 'function') {
    return { data: null, error: 'sandbox adapter unavailable' };
  }
  try {
    const reachable = await adapter.health();
    return {
      data: {
        id: adapter.meta.id,
        vendor: adapter.meta.vendor,
        license: adapter.meta.license,
        description: adapter.meta.description,
        reachable,
      },
      error: null,
    };
  } catch (err) {
    return {
      data: {
        id: adapter.meta?.id,
        vendor: adapter.meta?.vendor,
        license: adapter.meta?.license,
        description: adapter.meta?.description,
        reachable: false,
      },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
