// ─── ETL adapter — Airbyte behind the EtlPort (I/O only) ──────────────────────
// The console reaches Airbyte ONLY through this port. All shaping/normalization lives in the pure
// src/lib/etl-model.ts; this file does fetch/timeout/IO and delegates. Graceful by design: a
// freshly-provisioned Airbyte may have no workspace, be mid-boot, or be unreachable — every list
// returns [] and health() returns false rather than throwing, so the /admin/etl surface renders an
// honest empty state instead of a 500. Airbyte's config API is POST-based under /api/v1/ with JSON
// bodies (verified against the live 0.63.15 box).

import {
  type EtlConnection,
  type EtlJob,
  buildConnectionsListBody,
  buildJobsListBody,
  buildJobGetBody,
  buildSyncBody,
  summarizeConnection,
  summarizeJob,
} from '../etl-model';
import type { AdapterMeta } from './types';

const env = process.env;

// Production default is the on-box loopback; tests point OFFGRID_AIRBYTE_URL at the LAN box.
const DEFAULT_URL = 'http://127.0.0.1:8942';
const TIMEOUT_MS = 6000;

export interface EtlWorkspace {
  workspaceId: string;
  name: string;
  slug?: string;
  initialSetupComplete?: boolean;
}

export interface EtlPort {
  meta: AdapterMeta;
  health(): Promise<boolean>;
  listWorkspaces(): Promise<EtlWorkspace[]>;
  listConnections(workspaceId?: string): Promise<EtlConnection[]>;
  listJobs(connectionId?: string): Promise<EtlJob[]>;
  triggerSync(connectionId: string): Promise<EtlJob | null>;
  jobStatus(jobId: number): Promise<EtlJob | null>;
  // Raw ConnectionRead for a single connection (the schedule/sync-mode management surface reads it,
  // reshapes it via the pure airbyte-schedule-model, and posts it back). null when unreachable /
  // not found.
  getConnectionRaw(connectionId: string): Promise<Record<string, unknown> | null>;
  // Post a ConnectionUpdate (built by the pure model) to /connections/update. Returns true on 2xx.
  updateConnection(update: Record<string, unknown>): Promise<boolean>;
  // Submit an update then CONFIRM it landed by re-reading the connection — Airbyte's /connections/
  // update HTTP can block far longer than our timeout while applying the change server-side, so the
  // slow write's return is not trustworthy; the terminal state is. Returns true once `confirm(raw)`
  // holds on a read-back, false if it never does.
  updateConnectionConfirmed(
    update: Record<string, unknown>,
    connectionId: string,
    confirm: (raw: Record<string, unknown>) => boolean,
  ): Promise<boolean>;
  // Reset (clear) a connection's replication state so the next sync re-reads from scratch. Returns
  // the reset job, or null on failure.
  resetConnection(connectionId: string): Promise<EtlJob | null>;
}

function baseUrl(): string {
  return (env.OFFGRID_AIRBYTE_URL || DEFAULT_URL).replace(/\/$/, '');
}

// POST a JSON body to an Airbyte config-API path. Returns the parsed body on 2xx, or null on any
// failure (unreachable / non-2xx / bad JSON / timeout) so callers degrade to empty rather than throw.
// Surfaces the socket errno / status in a warn so "why empty?" is answerable from the logs.
async function post<T>(path: string, body: unknown): Promise<T | null> {
  const url = `${baseUrl()}/api/v1/${path.replace(/^\//, '')}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn(`[etl] airbyte ${path} ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[etl] airbyte ${path} failed:`, describeError(err));
    return null;
  }
}

// fetch() hides the useful bit (ECONNREFUSED/ETIMEDOUT) on err.cause.code, not err.message.
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const code =
      cause && typeof cause === 'object' && 'code' in cause
        ? (cause as { code?: unknown }).code
        : undefined;
    return code ? `${err.message} (cause: ${String(code)})` : err.message;
  }
  return String(err);
}

async function fetchWorkspaces(): Promise<EtlWorkspace[]> {
  const data = await post<{ workspaces?: unknown[] }>('workspaces/list', {});
  const raw = Array.isArray(data?.workspaces) ? data!.workspaces : [];
  return raw.map((w) => {
    const r = (w ?? {}) as Record<string, unknown>;
    return {
      workspaceId: String(r.workspaceId ?? ''),
      name: String(r.name ?? r.workspaceId ?? 'workspace'),
      slug: r.slug != null ? String(r.slug) : undefined,
      initialSetupComplete: typeof r.initialSetupComplete === 'boolean' ? r.initialSetupComplete : undefined,
    };
  }).filter((w) => w.workspaceId);
}

// Resolve a workspace id: use the caller's if given, else the first workspace Airbyte reports.
// Returns undefined when Airbyte has no workspace yet (fresh install) — callers then return [].
async function resolveWorkspaceId(workspaceId?: string): Promise<string | undefined> {
  if (workspaceId) return workspaceId;
  const ws = await fetchWorkspaces();
  return ws[0]?.workspaceId;
}

export const airbyteEtl: EtlPort = {
  meta: {
    id: 'airbyte',
    capability: 'lineage',
    vendor: 'Airbyte',
    license: 'ELv2 / MIT (connectors)',
    render: 'embed',
    embedUrl: env.OFFGRID_AIRBYTE_URL,
    description: 'ELT ingestion: 300+ source/destination connectors, scheduled syncs into the lake.',
  },

  async health() {
    try {
      const res = await fetch(`${baseUrl()}/api/v1/health`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) return false;
      const body = (await res.json().catch(() => ({}))) as { available?: boolean };
      // Airbyte reports {"available":true}; treat a 2xx with a truthy available flag as healthy.
      return body.available === true;
    } catch {
      return false;
    }
  },

  async listWorkspaces() {
    return fetchWorkspaces();
  },

  async listConnections(workspaceId?: string) {
    const wsId = await resolveWorkspaceId(workspaceId);
    if (!wsId) return []; // no workspace configured yet — graceful empty
    const data = await post<{ connections?: unknown[] }>(
      'connections/list',
      buildConnectionsListBody(wsId),
    );
    const raw = Array.isArray(data?.connections) ? data!.connections : [];
    return raw.map(summarizeConnection);
  },

  async listJobs(connectionId?: string) {
    const data = await post<{ jobs?: unknown[] }>('jobs/list', buildJobsListBody(connectionId));
    const raw = Array.isArray(data?.jobs) ? data!.jobs : [];
    return raw.map(summarizeJob);
  },

  async triggerSync(connectionId: string) {
    // /connections/sync → { job: {...}, attempts: [...] } (the JobInfoRead wrapper).
    const data = await post<unknown>('connections/sync', buildSyncBody(connectionId));
    if (!data) return null;
    return summarizeJob(data);
  },

  async jobStatus(jobId: number) {
    const data = await post<unknown>('jobs/get', buildJobGetBody(jobId));
    if (!data) return null;
    return summarizeJob(data);
  },

  async getConnectionRaw(connectionId: string) {
    // /connections/get → the full ConnectionRead (schedule, syncCatalog, status, …). The pure model
    // reshapes it; this adapter only fetches. null on any failure so the route returns an honest 404.
    if (!connectionId) return null;
    return post<Record<string, unknown>>('connections/get', { connectionId });
  },

  async updateConnection(update: Record<string, unknown>) {
    // /connections/update takes a ConnectionUpdate (pre-shaped by pickConnectionUpdateFields so it
    // carries no read-only field). A 2xx means the change landed.
    const data = await post<unknown>('connections/update', update);
    return data !== null;
  },

  async updateConnectionConfirmed(update, connectionId, confirm) {
    // Fire the update (bounded timeout; may return null when Airbyte's slow /connections/update HTTP
    // outlasts it) then CONFIRM by polling the connection — the change applies server-side within a
    // few seconds even when the write call never returns, so we trust the read-back, not the write.
    const direct = await this.updateConnection(update);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const raw = await this.getConnectionRaw(connectionId);
      if (raw && confirm(raw)) return true;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    // Last-chance read after the final wait, so a change that lands right at the deadline still counts.
    const raw = await this.getConnectionRaw(connectionId);
    return (raw != null && confirm(raw)) || direct;
  },

  async resetConnection(connectionId: string) {
    // /connections/reset clears the connection's saved state (full re-read on next sync) and returns
    // a JobInfoRead wrapper, exactly like /connections/sync.
    if (!connectionId) return null;
    const data = await post<unknown>('connections/reset', { connectionId });
    if (!data) return null;
    return summarizeJob(data);
  },
};
