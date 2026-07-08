// ─── ETL adapter — Airbyte behind the EtlPort (I/O only) ──────────────────────
// The console reaches Airbyte ONLY through this port. All shaping/normalization lives in the pure
// src/lib/etl-model.ts; this file does fetch/timeout/IO and delegates. Graceful by design: a
// freshly-provisioned Airbyte may have no workspace, be mid-boot, or be unreachable — every list
// returns [] and health() returns false rather than throwing, so the /admin/etl surface renders an
// honest empty state instead of a 500. Airbyte's config API is POST-based under /api/v1/ with JSON
// bodies (verified against the live 0.63.15 box).

import type { AdapterMeta } from './types';
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
};
