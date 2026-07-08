// ─── ETL jobs store + run engine (I/O seam) ─────────────────────────────────────
// Thin I/O over two self-migrating tables (etl_jobs, etl_runs) plus the governed run engine. The
// PURE model (spec/validation/mappers/SQL builders) lives in etl-job.ts — this module only persists
// rows and drives the live path. Self-migrate (CREATE TABLE IF NOT EXISTS) so it works on a DB that
// hasn't run a migration (deploy is rsync-only, no migration step) — same pattern as pipelines.ts /
// publish-jobs-store.ts, and it deliberately does NOT touch src/db/schema.ts.
//
// RUN PATH (honest): the Airbyte adapter exposes health/list/triggerSync but NOT connection
// CREATION, so a freshly-authored job has no Airbyte connection to sync. The engine therefore runs a
// GOVERNED DIRECT-COPY: pull rows from the source connector (connector-exec, credential from vault) →
// redact on the movement path (data-redaction, reusing the org PII port) → project onto the dest
// shape → land in ClickHouse (etl-job SQL builders). Redaction + the run record give governance +
// lineage. If/when Airbyte connection-creation is wired, compileToAirbyteConfig is the ready mapper.

import { randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';
import { execConnectorQuery } from '@/lib/connector-exec';
import { listConnectors } from '@/lib/store';
import { redactBatch, activePiiPort } from '@/lib/data-redaction';
import {
  buildCountSql,
  buildCreateDatabaseSql,
  buildCreateTableSql,
  buildInsertSql,
  buildTruncateSql,
  clampRowLimit,
  destColumns,
  normalizeRunStatus,
  projectRow,
  redactionPolicyFromMappings,
  validateJobDraft,
  type ColumnMapping,
  type EtlJobDraft,
  type EtlJobSpec,
  type EtlRunView,
} from '@/lib/etl-job';
import type { EtlJobStatus } from '@/lib/etl-model';

// ── self-migrate ────────────────────────────────────────────────────────────────
let ensurePromise: Promise<void> | null = null;
export async function ensureEtlJobsSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS etl_jobs (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        name text NOT NULL,
        source_connector_id text NOT NULL,
        source_resource text NOT NULL,
        dest_database text NOT NULL,
        dest_table text NOT NULL,
        mappings jsonb NOT NULL DEFAULT '[]',
        trigger text NOT NULL DEFAULT 'manual',
        cron text,
        row_limit integer,
        last_run_status text,
        last_run_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS etl_runs (
        id text PRIMARY KEY,
        job_id text NOT NULL,
        org_id text NOT NULL DEFAULT 'default',
        status text NOT NULL DEFAULT 'pending',
        path text NOT NULL DEFAULT 'direct-copy',
        rows_read integer NOT NULL DEFAULT 0,
        rows_written integer NOT NULL DEFAULT 0,
        redacted integer NOT NULL DEFAULT 0,
        message text,
        started_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz);
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS etl_jobs_org_idx ON etl_jobs (org_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS etl_runs_job_idx ON etl_runs (job_id);`);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

// ── row → view mappers ────────────────────────────────────────────────────────
function iso(v: unknown): string | undefined {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && v) return v;
  return undefined;
}

function rowToSpec(r: Record<string, unknown>): EtlJobSpec {
  return {
    id: String(r.id),
    orgId: String(r.org_id ?? DEFAULT_ORG),
    name: String(r.name ?? ''),
    sourceConnectorId: String(r.source_connector_id ?? ''),
    sourceResource: String(r.source_resource ?? ''),
    destDatabase: String(r.dest_database ?? ''),
    destTable: String(r.dest_table ?? ''),
    mappings: Array.isArray(r.mappings) ? (r.mappings as ColumnMapping[]) : [],
    trigger: r.trigger === 'schedule' ? 'schedule' : 'manual',
    cron: r.cron != null ? String(r.cron) : undefined,
    rowLimit: r.row_limit != null ? Number(r.row_limit) : undefined,
    lastRunStatus: r.last_run_status ? (String(r.last_run_status) as EtlJobStatus) : undefined,
    lastRunAt: iso(r.last_run_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function rowToRun(r: Record<string, unknown>): EtlRunView {
  return {
    runId: String(r.id),
    jobId: String(r.job_id),
    status: String(r.status ?? 'pending') as EtlJobStatus,
    path: r.path === 'airbyte' ? 'airbyte' : 'direct-copy',
    rowsRead: Number(r.rows_read ?? 0),
    rowsWritten: Number(r.rows_written ?? 0),
    redacted: Number(r.redacted ?? 0),
    message: r.message != null ? String(r.message) : undefined,
    startedAt: iso(r.started_at) ?? new Date().toISOString(),
    finishedAt: iso(r.finished_at),
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
export async function listEtlJobs(orgId: string = DEFAULT_ORG): Promise<EtlJobSpec[]> {
  await ensureEtlJobsSchema();
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(
    sql`SELECT * FROM etl_jobs WHERE org_id = ${orgId} ORDER BY created_at DESC`,
  );
  return (res.rows as Record<string, unknown>[]).map(rowToSpec);
}

export async function getEtlJob(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<EtlJobSpec | null> {
  await ensureEtlJobsSchema();
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(
    sql`SELECT * FROM etl_jobs WHERE id = ${id} AND org_id = ${orgId} LIMIT 1`,
  );
  const row = (res.rows as Record<string, unknown>[])[0];
  return row ? rowToSpec(row) : null;
}

export async function createEtlJob(
  draft: EtlJobDraft,
  orgId: string = DEFAULT_ORG,
): Promise<{ ok: true; job: EtlJobSpec } | { ok: false; errors: string[] }> {
  const v = validateJobDraft(draft);
  if (!v.ok) return { ok: false, errors: v.errors };
  await ensureEtlJobsSchema();
  const { sql } = await import('drizzle-orm');
  const id = `etl_${randomUUID().slice(0, 12)}`;
  const mappingsJson = JSON.stringify(draft.mappings ?? []);
  const rowLimit = draft.rowLimit != null ? clampRowLimit(draft.rowLimit) : null;
  const res = await db.execute(sql`
    INSERT INTO etl_jobs
      (id, org_id, name, source_connector_id, source_resource, dest_database, dest_table,
       mappings, trigger, cron, row_limit)
    VALUES
      (${id}, ${orgId}, ${draft.name}, ${draft.sourceConnectorId}, ${draft.sourceResource},
       ${draft.destDatabase}, ${draft.destTable}, ${mappingsJson}::jsonb, ${draft.trigger},
       ${draft.cron ?? null}, ${rowLimit})
    RETURNING *`);
  return { ok: true, job: rowToSpec((res.rows as Record<string, unknown>[])[0]) };
}

export async function updateEtlJob(
  id: string,
  draft: EtlJobDraft,
  orgId: string = DEFAULT_ORG,
): Promise<{ ok: true; job: EtlJobSpec } | { ok: false; errors: string[] } | null> {
  const existing = await getEtlJob(id, orgId);
  if (!existing) return null;
  const v = validateJobDraft(draft);
  if (!v.ok) return { ok: false, errors: v.errors };
  const { sql } = await import('drizzle-orm');
  const mappingsJson = JSON.stringify(draft.mappings ?? []);
  const rowLimit = draft.rowLimit != null ? clampRowLimit(draft.rowLimit) : null;
  const res = await db.execute(sql`
    UPDATE etl_jobs SET
      name = ${draft.name},
      source_connector_id = ${draft.sourceConnectorId},
      source_resource = ${draft.sourceResource},
      dest_database = ${draft.destDatabase},
      dest_table = ${draft.destTable},
      mappings = ${mappingsJson}::jsonb,
      trigger = ${draft.trigger},
      cron = ${draft.cron ?? null},
      row_limit = ${rowLimit},
      updated_at = now()
    WHERE id = ${id} AND org_id = ${orgId}
    RETURNING *`);
  const row = (res.rows as Record<string, unknown>[])[0];
  return row ? { ok: true, job: rowToSpec(row) } : null;
}

export async function deleteEtlJob(id: string, orgId: string = DEFAULT_ORG): Promise<boolean> {
  await ensureEtlJobsSchema();
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`DELETE FROM etl_runs WHERE job_id = ${id} AND org_id = ${orgId}`);
  const res = await db.execute(
    sql`DELETE FROM etl_jobs WHERE id = ${id} AND org_id = ${orgId} RETURNING id`,
  );
  return (res.rows as unknown[]).length > 0;
}

export async function listEtlRuns(
  jobId: string,
  orgId: string = DEFAULT_ORG,
): Promise<EtlRunView[]> {
  await ensureEtlJobsSchema();
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(
    sql`SELECT * FROM etl_runs WHERE job_id = ${jobId} AND org_id = ${orgId}
        ORDER BY started_at DESC LIMIT 100`,
  );
  return (res.rows as Record<string, unknown>[]).map(rowToRun);
}

// ── warehouse write (I/O) — POST a statement to the ClickHouse HTTP interface ────
// Kept local (not on the read-only WarehousePort) because ETL is the ONLY write path into the
// warehouse and it's governed. Throws on transport/HTTP error so runJob records an honest failure.
async function warehouseExec(statement: string): Promise<string> {
  const env = process.env;
  const url = (env.OFFGRID_WAREHOUSE_URL || 'http://127.0.0.1:8941').replace(/\/$/, '');
  const user = env.OFFGRID_WAREHOUSE_USER || 'warehouse';
  const password = env.OFFGRID_WAREHOUSE_PASSWORD || 'warehouse';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'X-ClickHouse-User': user, 'X-ClickHouse-Key': password },
    body: statement,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`clickhouse ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
  return res.text();
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { code?: unknown } }).cause;
    const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
    return code ? `${err.message} (cause: ${String(code)})` : err.message;
  }
  return String(err);
}

// ── the governed direct-copy run engine ─────────────────────────────────────────
// Records a run row (started → finished) and performs source→(redact)→warehouse. Returns the run
// view. Never throws — a failure lands as a failed run with a message (honest, auditable).
export async function runJob(job: EtlJobSpec, orgId: string = DEFAULT_ORG): Promise<EtlRunView> {
  await ensureEtlJobsSchema();
  const { sql } = await import('drizzle-orm');
  const runId = `run_${randomUUID().slice(0, 12)}`;
  await db.execute(
    sql`INSERT INTO etl_runs (id, job_id, org_id, status, path) VALUES (${runId}, ${job.id}, ${orgId}, 'running', 'direct-copy')`,
  );

  let status: EtlJobStatus = 'failed';
  let rowsRead = 0;
  let rowsWritten = 0;
  let redacted = 0;
  let message = '';

  try {
    // 1. Resolve the source connector (credential-free row; exec resolves the vault secret by id).
    const connectors = await listConnectors(orgId);
    const conn = connectors.find((c) => c.id === job.sourceConnectorId);
    if (!conn) throw new Error('source connector not found');

    // 2. Pull rows from the bound resource.
    const limit = clampRowLimit(job.rowLimit);
    const result = await execConnectorQuery(
      { type: conn.type, endpoint: conn.endpoint, id: conn.id },
      { resource: job.sourceResource, op: 'read', limit },
    );
    if (!result) throw new Error('could not read from the source (unreachable or unsupported)');
    rowsRead = result.rows.length;

    // 3. Redact on the movement path (governance) — reuse the org PII port.
    const policy = redactionPolicyFromMappings(job.mappings);
    const pii = await activePiiPort();
    const redactResult = await redactBatch(result.rows, policy, pii, orgId);
    redacted = redactResult.totalRedacted;

    // 4. Project onto the destination shape.
    const projected = redactResult.rows.map((r) => projectRow(r, job.mappings));
    const cols = destColumns(job.mappings, projected);

    // 5. Land in ClickHouse: ensure db + table, truncate (full-refresh), insert.
    await warehouseExec(buildCreateDatabaseSql(job.destDatabase));
    await warehouseExec(buildCreateTableSql(job.destDatabase, job.destTable, cols));
    await warehouseExec(buildTruncateSql(job.destDatabase, job.destTable));
    const insert = buildInsertSql(job.destDatabase, job.destTable, cols, projected);
    if (insert) await warehouseExec(insert);

    // 6. Verify what actually landed (honest rowsWritten).
    const countText = await warehouseExec(buildCountSql(job.destDatabase, job.destTable));
    try {
      const parsed = JSON.parse(countText) as { data?: { n?: string | number }[] };
      rowsWritten = Number(parsed.data?.[0]?.n ?? projected.length) || 0;
    } catch {
      rowsWritten = projected.length;
    }

    status = normalizeRunStatus('ok');
    message = `Moved ${rowsRead} rows → ${job.destDatabase}.${job.destTable} (${redacted} values redacted).`;
  } catch (err) {
    status = 'failed';
    message = describeError(err);
  }

  // Finalize the run + stamp the job's last-run summary.
  await db.execute(sql`
    UPDATE etl_runs SET status = ${status}, rows_read = ${rowsRead}, rows_written = ${rowsWritten},
      redacted = ${redacted}, message = ${message}, finished_at = now()
    WHERE id = ${runId}`);
  await db.execute(sql`
    UPDATE etl_jobs SET last_run_status = ${status}, last_run_at = now() WHERE id = ${job.id}`);

  const res = await db.execute(sql`SELECT * FROM etl_runs WHERE id = ${runId} LIMIT 1`);
  return rowToRun((res.rows as Record<string, unknown>[])[0]);
}
