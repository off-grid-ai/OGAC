// ─── ETL model — PURE logic for the Airbyte adapter (zero I/O) ────────────────
// SOLID: everything here is a pure function — status normalization, verbose-shape → compact-console-
// shape summarizers, and request-body builders for Airbyte's POST config API. The adapter
// (src/lib/adapters/airbyte.ts) does ONLY fetch/IO and delegates all shaping here, so the mapping is
// unit-testable with no network, no mocks. Airbyte's API is POST-based under /api/v1/ with JSON
// bodies; response shapes verified empirically against the live 0.63.15 box at 192.168.1.60:8005.

// The console's compact, stable job status vocabulary. Airbyte reports many raw statuses
// (pending/running/incomplete/failed/succeeded/cancelled + job-config states); we fold them onto
// these five so the UI/API never has to know Airbyte's internal spelling.
export type EtlJobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'pending';

// Normalize any raw Airbyte job/attempt status onto the console vocabulary. Unknown / missing →
// 'pending' (the safe default: "we don't yet know it's done", never a false success/failure).
export function normalizeJobStatus(raw: unknown): EtlJobStatus {
  const s = String(raw ?? '').toLowerCase().trim();
  switch (s) {
    case 'running':
    case 'incomplete': // an attempt still in flight
      return 'running';
    case 'succeeded':
    case 'success':
    case 'completed':
      return 'succeeded';
    case 'failed':
    case 'error':
    case 'errored':
      return 'failed';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'pending':
    case 'queued':
    case '': // missing
      return 'pending';
    default:
      return 'pending';
  }
}

// ─── Compact console shapes ───────────────────────────────────────────────────
export interface EtlConnection {
  connectionId: string;
  name: string;
  status: string; // Airbyte connection lifecycle: active | inactive | deprecated
  sourceId?: string;
  destinationId?: string;
  schedule?: string; // human-ish schedule label, best-effort
}

export interface EtlJob {
  jobId: number | null;
  connectionId?: string;
  status: EtlJobStatus;
  jobType?: string; // sync | reset_connection | ...
  createdAt?: number; // epoch seconds (Airbyte's unit)
  updatedAt?: number;
  recordsSynced?: number;
  bytesSynced?: number;
}

// ─── Summarizers — verbose Airbyte shapes → compact console shapes ────────────
// Airbyte's connections/list returns { connections: [{ connectionId, name, status, sourceId,
// destinationId, schedule?, scheduleType?, ... }] }. We keep only what the console renders.
export function summarizeConnection(raw: unknown): EtlConnection {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    connectionId: str(r.connectionId),
    name: str(r.name) || str(r.connectionId) || 'connection',
    status: str(r.status) || 'unknown',
    sourceId: optStr(r.sourceId),
    destinationId: optStr(r.destinationId),
    schedule: scheduleLabel(r),
  };
}

// jobs/list returns { jobs: [{ job: {id, configType, configId, createdAt, updatedAt, status},
// attempts: [{ status, recordsSynced, bytesSynced, ... }] }] }. jobs/get returns a single such
// { job, attempts } under the top-level. Accept either the wrapper or a bare job object.
export function summarizeJob(raw: unknown): EtlJob {
  const wrapper = (raw ?? {}) as Record<string, unknown>;
  // jobs/get nests under { job: {...}, attempts: [...] }; jobs/list items are the same wrapper.
  const jobObj = (isObj(wrapper.job) ? wrapper.job : wrapper) as Record<string, unknown>;
  const attempts = Array.isArray(wrapper.attempts) ? (wrapper.attempts as unknown[]) : [];
  const last = attempts.length ? (attempts.at(-1) as Record<string, unknown>) : undefined;

  // Job-level status wins; fall back to the latest attempt's status.
  const rawStatus = jobObj.status ?? last?.status;

  return {
    jobId: numOrNull(jobObj.id),
    connectionId: optStr(jobObj.configId),
    status: normalizeJobStatus(rawStatus),
    jobType: optStr(jobObj.configType),
    createdAt: optNum(jobObj.createdAt),
    updatedAt: optNum(jobObj.updatedAt),
    recordsSynced: sumAttempts(attempts, 'recordsSynced'),
    bytesSynced: sumAttempts(attempts, 'bytesSynced'),
  };
}

// ─── Request-body builders — the JSON bodies Airbyte's POST config API expects ─
// Verified against the live box: /workspaces/list {} ; /connections/list {workspaceId} ;
// /jobs/list {configTypes,[configId]} ; /connections/sync {connectionId} ; /jobs/get {id}.
export function buildConnectionsListBody(workspaceId: string): { workspaceId: string } {
  return { workspaceId };
}

export function buildJobsListBody(connectionId?: string): {
  configTypes: string[];
  configId?: string;
} {
  const body: { configTypes: string[]; configId?: string } = { configTypes: ['sync'] };
  if (connectionId) body.configId = connectionId;
  return body;
}

export function buildSyncBody(connectionId: string): { connectionId: string } {
  return { connectionId };
}

export function buildJobGetBody(jobId: number): { id: number } {
  return { id: jobId };
}

// ─── small pure helpers ───────────────────────────────────────────────────────
function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function optStr(v: unknown): string | undefined {
  const s = str(v);
  return s ? s : undefined;
}
function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function optNum(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && v != null && v !== '' ? n : undefined;
}
function sumAttempts(attempts: unknown[], key: string): number | undefined {
  if (!attempts.length) return undefined;
  let total = 0;
  let saw = false;
  for (const a of attempts) {
    if (isObj(a)) {
      const n = Number((a as Record<string, unknown>)[key]);
      if (Number.isFinite(n)) {
        total += n;
        saw = true;
      }
    }
  }
  return saw ? total : undefined;
}
// Best-effort human label for a connection's schedule. Airbyte carries either a legacy `schedule`
// {units, timeUnit} or a `scheduleType` (manual | basic | cron) + `scheduleData`. Never throws.
function scheduleLabel(r: Record<string, unknown>): string | undefined {
  const type = optStr(r.scheduleType);
  if (type === 'manual') return 'manual';
  if (type === 'cron') {
    const data = isObj(r.scheduleData) ? r.scheduleData : undefined;
    const cron = data && isObj(data.cron) ? optStr((data.cron as Record<string, unknown>).cronExpression) : undefined;
    return cron ? `cron: ${cron}` : 'cron';
  }
  const sched = isObj(r.schedule) ? r.schedule : undefined;
  if (sched) {
    const units = optNum(sched.units);
    const timeUnit = optStr(sched.timeUnit);
    if (units != null && timeUnit) return `every ${units} ${timeUnit}`;
  }
  if (type) return type;
  return undefined;
}
