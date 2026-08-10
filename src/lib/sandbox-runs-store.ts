// I/O adapter for `sandbox_runs` — the retained history of agent-code-exec runs. The /build/sandbox
// (and /solutions/test) page used to pass an empty array here forever ("Exec-run history is not yet
// persisted; pass an empty set until a store lands" — the GET route's old comment), so the Recent
// runs table always showed 5 zeroed figures even when the docker backend genuinely executed code.
// This closes that gap: every run POSTed through /api/v1/admin/sandbox/run is now recorded here
// (best-effort — a persistence failure must never break the run response), org-scoped, and read back
// by the status route + the page.
//
// Self-migrating (CREATE TABLE IF NOT EXISTS via raw SQL, no drizzle table needed) — same pattern as
// drift-runs.ts / eval_runs, so it deploys over SSH with no separate migration step.
//
// All display shaping (classify/sort/tally) stays in the pure, zero-IO sandbox-view.ts; this module
// only does the DB round-trip and the raw-row -> RawExecRun mapping.

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type { RawExecRun } from '@/lib/sandbox-view';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

let ensurePromise: Promise<void> | null = null;
export async function ensureSandboxRunsSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sandbox_runs (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        engine text NOT NULL DEFAULT 'unknown',
        language text NOT NULL DEFAULT 'unknown',
        ok boolean NOT NULL DEFAULT false,
        exit_code integer,
        timed_out boolean NOT NULL DEFAULT false,
        refused text NOT NULL DEFAULT '',
        duration_ms integer,
        created_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS sandbox_runs_org_idx ON sandbox_runs (org_id, created_at DESC);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

export interface SandboxRunRecord {
  engine: string;
  language: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  refused: string;
  durationMs: number | null;
}

// Best-effort insert. Never throws into the caller — recording history must not risk the run
// response itself (mirrors readSandboxStatus's never-throw contract).
export async function recordSandboxRun(
  input: SandboxRunRecord,
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  try {
    await ensureSandboxRunsSchema();
    await db.execute(
      sql`INSERT INTO sandbox_runs (id, org_id, engine, language, ok, exit_code, timed_out, refused, duration_ms)
          VALUES (${randomUUID()}, ${orgId || DEFAULT_ORG}, ${input.engine}, ${input.language}, ${input.ok},
                  ${input.exitCode}, ${input.timedOut}, ${input.refused}, ${input.durationMs});`,
    );
  } catch {
    // History is a courtesy, not a dependency — a DB hiccup must not fail a code run.
  }
}

interface SandboxRunRow {
  id: string;
  org_id: string;
  engine: string;
  language: string;
  ok: boolean;
  exit_code: number | null;
  timed_out: boolean;
  refused: string;
  duration_ms: number | null;
  created_at: Date | string;
  [k: string]: unknown;
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

// Raw DB row -> the pure normalizer's input shape. Kept here (not in sandbox-view.ts) so that file
// stays genuinely zero-import; this is the one place that knows the DB row shape.
function toRawExecRun(row: SandboxRunRow): RawExecRun {
  return {
    id: row.id,
    engine: row.engine,
    language: row.language,
    ok: row.ok,
    exitCode: row.exit_code === null ? null : Number(row.exit_code),
    timedOut: row.timed_out,
    refused: row.refused || undefined,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    createdAt: iso(row.created_at),
  };
}

const RUN_WINDOW = 50;

// Most recent runs for the org, newest-first (best-effort: a read failure degrades to an empty
// history rather than a broken page — the page already renders "No runs recorded." for that case).
export async function listSandboxRuns(
  orgId: string = DEFAULT_ORG,
  limit: number = RUN_WINDOW,
): Promise<RawExecRun[]> {
  try {
    await ensureSandboxRunsSchema();
    const { rows } = await db.execute<SandboxRunRow>(
      sql`SELECT id, org_id, engine, language, ok, exit_code, timed_out, refused, duration_ms, created_at
          FROM sandbox_runs WHERE org_id = ${orgId || DEFAULT_ORG}
          ORDER BY created_at DESC LIMIT ${limit};`,
    );
    return rows.map(toRawExecRun);
  } catch {
    return [];
  }
}
