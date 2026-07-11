// ─── Orchestration adapter — Kestra behind the OrchestrationPort (I/O only) ─────────────────────
// The console reaches the ETL/orchestration engine ONLY through this port. All shaping is pure (the
// compiler in etl-kestra-compile.ts produces the flow YAML); this file does fetch/timeout/IO against
// the engine's REST API and normalizes the responses. Graceful by design: an unreachable or
// not-yet-provisioned engine makes health() return false and every op return a "not configured"
// result rather than throwing — the /data/etl surface then renders an HONEST unconfigured state and
// never fakes a success. Mirrors src/lib/adapters/airbyte.ts.
//
// REST API (verified against Kestra OSS docs — kestra.io/docs/how-to-guides/api):
//   health          GET  /health                                   → 200 when up
//   create flow     POST /api/v1/{tenant}/flows       body: flow YAML, Content-Type application/x-yaml
//   update flow     PUT  /api/v1/{tenant}/flows/{namespace}/{id}    body: flow YAML, application/x-yaml
//   get flow        GET  /api/v1/{tenant}/flows/{namespace}/{id}
//   trigger exec    POST /api/v1/{tenant}/executions/{namespace}/{id}   (multipart for inputs)
//   get execution   GET  /api/v1/{tenant}/executions/{executionId}
//   execution logs  GET  /api/v1/{tenant}/logs/{executionId}
// The OSS default tenant is `main` (override via OFFGRID_KESTRA_TENANT). Optional basic auth via
// OFFGRID_KESTRA_USER/OFFGRID_KESTRA_PASSWORD (Kestra OSS Basic Auth) — omitted when unset.

import { KESTRA_NAMESPACE as KESTRA_NS } from '../etl-kestra-compile';
import type { AdapterMeta } from './types';

const env = process.env;

// Production default is the on-box loopback the edge-Caddy fronts (8945 → offgrid-s2:8090).
const DEFAULT_URL = 'http://127.0.0.1:8945';
const TIMEOUT_MS = 8000;

function baseUrl(): string {
  return (env.OFFGRID_KESTRA_URL || DEFAULT_URL).replace(/\/$/, '');
}
function tenant(): string {
  return env.OFFGRID_KESTRA_TENANT || 'main';
}
// "Configured" = an explicit engine URL is set. Unset means we're falling back to the default
// loopback, which is only live once the edge-Caddy proxy + S2 box are provisioned — so health()
// is what actually decides reachability. This flag lets the UI distinguish "not wired yet" from
// "wired but the box is down".
function isConfigured(): boolean {
  return Boolean(env.OFFGRID_KESTRA_URL);
}

function authHeaders(): Record<string, string> {
  const u = env.OFFGRID_KESTRA_USER;
  const p = env.OFFGRID_KESTRA_PASSWORD;
  if (u && p) {
    const token = Buffer.from(`${u}:${p}`).toString('base64');
    return { authorization: `Basic ${token}` };
  }
  return {};
}

// fetch() hides the useful errno (ECONNREFUSED/ETIMEDOUT) on err.cause.code, not err.message.
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { code?: unknown } }).cause;
    const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
    return code ? `${err.message} (cause: ${String(code)})` : err.message;
  }
  return String(err);
}

// ── normalized shapes the routes/UI consume (product language, engine-agnostic) ─────────────────
export interface OrchFlow {
  id: string;
  namespace: string;
  revision?: number;
}

// Execution state → the console's coarse run status vocabulary.
export type OrchRunStatus = 'succeeded' | 'running' | 'failed' | 'pending' | 'cancelled';

export interface OrchExecution {
  executionId: string;
  flowId: string;
  namespace: string;
  status: OrchRunStatus;
  startedAt?: string;
  duration?: number;
}

export interface OrchLogLine {
  ts?: string;
  level?: string;
  message: string;
  taskId?: string;
}

// The result envelope every write returns, so callers can render an honest state.
export type OrchResult<T> =
  | { ok: true; value: T }
  | { ok: false; configured: boolean; error: string };

// Map a Kestra state.current (CREATED/RUNNING/SUCCESS/FAILED/…) → our vocabulary.
export function normalizeExecutionStatus(raw: unknown): OrchRunStatus {
  const s = String(raw ?? '').toUpperCase().trim();
  switch (s) {
    case 'SUCCESS':
      return 'succeeded';
    case 'RUNNING':
    case 'RESTARTED':
    case 'PAUSED':
    case 'RETRYING':
      return 'running';
    case 'FAILED':
    case 'KILLED':
    case 'WARNING':
      return 'failed';
    case 'CANCELLED':
      return 'cancelled';
    case 'CREATED':
    case 'QUEUED':
    default:
      return 'pending';
  }
}

function summarizeExecution(raw: unknown): OrchExecution | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = r.id != null ? String(r.id) : '';
  if (!id) return null;
  const state = (r.state ?? {}) as Record<string, unknown>;
  return {
    executionId: id,
    flowId: String(r.flowId ?? ''),
    namespace: String(r.namespace ?? ''),
    status: normalizeExecutionStatus(state.current),
    startedAt: state.startDate != null ? String(state.startDate) : undefined,
    duration: typeof state.duration === 'number' ? state.duration : undefined,
  };
}

export interface OrchestrationPort {
  meta: AdapterMeta;
  health(): Promise<boolean>;
  configured(): boolean;
  listFlows(): Promise<OrchFlow[]>;
  getFlow(namespace: string, id: string): Promise<OrchFlow | null>;
  upsertFlow(yaml: string, namespace: string, id: string): Promise<OrchResult<OrchFlow>>;
  execute(namespace: string, id: string, inputs?: Record<string, string>): Promise<OrchResult<OrchExecution>>;
  executionStatus(executionId: string): Promise<OrchExecution | null>;
  executionLogs(executionId: string): Promise<OrchLogLine[]>;
}

async function req(
  method: string,
  path: string,
  init: { body?: BodyInit; contentType?: string; accept?: string } = {},
): Promise<{ ok: boolean; status: number; text: string }> {
  const url = `${baseUrl()}${path}`;
  const headers: Record<string, string> = { ...authHeaders() };
  if (init.contentType) headers['content-type'] = init.contentType;
  headers['accept'] = init.accept ?? 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: init.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, text };
}

export const kestraOrchestration: OrchestrationPort = {
  meta: {
    id: 'kestra',
    capability: 'lineage',
    vendor: 'Kestra',
    license: 'Apache-2.0',
    render: 'embed',
    embedUrl: env.OFFGRID_KESTRA_URL,
    description: 'Workflow orchestration: runs the compiled data-movement jobs (extract → transform → load) on a schedule or on demand.',
  },

  configured() {
    return isConfigured();
  },

  async health() {
    try {
      const res = await fetch(`${baseUrl()}/health`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async listFlows() {
    try {
      const r = await req('GET', `/api/v1/${tenant()}/flows/${encodeURIComponent(KESTRA_NS)}`);
      if (!r.ok) return [];
      const body = JSON.parse(r.text) as unknown;
      let arr: unknown[] = [];
      if (Array.isArray(body)) arr = body;
      else if (Array.isArray((body as { results?: unknown[] })?.results)) {
        arr = (body as { results: unknown[] }).results;
      }
      return arr
        .map((f) => {
          const r2 = (f ?? {}) as Record<string, unknown>;
          return {
            id: String(r2.id ?? ''),
            namespace: String(r2.namespace ?? ''),
            revision: typeof r2.revision === 'number' ? r2.revision : undefined,
          };
        })
        .filter((f) => f.id);
    } catch (err) {
      console.warn('[etl] kestra listFlows failed:', describeError(err));
      return [];
    }
  },

  async getFlow(namespace: string, id: string) {
    try {
      const r = await req(
        'GET',
        `/api/v1/${tenant()}/flows/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`,
      );
      if (!r.ok) return null;
      const b = JSON.parse(r.text) as Record<string, unknown>;
      if (!b.id) return null;
      return {
        id: String(b.id),
        namespace: String(b.namespace ?? namespace),
        revision: typeof b.revision === 'number' ? b.revision : undefined,
      };
    } catch (err) {
      console.warn('[etl] kestra getFlow failed:', describeError(err));
      return null;
    }
  },

  // Create or update the flow: try PUT (update existing) first; if it 404s, POST (create). Kestra's
  // create is POST /flows (id/namespace read from the YAML body); update is PUT /flows/{ns}/{id}.
  async upsertFlow(yaml: string, namespace: string, id: string) {
    try {
      const existing = await this.getFlow(namespace, id);
      const r = existing
        ? await req(
            'PUT',
            `/api/v1/${tenant()}/flows/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`,
            { body: yaml, contentType: 'application/x-yaml' },
          )
        : await req('POST', `/api/v1/${tenant()}/flows`, {
            body: yaml,
            contentType: 'application/x-yaml',
          });
      if (!r.ok) {
        return {
          ok: false as const,
          configured: true,
          error: `engine ${r.status}${r.text ? `: ${r.text.slice(0, 200)}` : ''}`,
        };
      }
      const b = JSON.parse(r.text) as Record<string, unknown>;
      return {
        ok: true as const,
        value: {
          id: String(b.id ?? id),
          namespace: String(b.namespace ?? namespace),
          revision: typeof b.revision === 'number' ? b.revision : undefined,
        },
      };
    } catch (err) {
      return { ok: false as const, configured: false, error: describeError(err) };
    }
  },

  async execute(namespace: string, id: string, inputs?: Record<string, string>) {
    try {
      let body: BodyInit | undefined;
      let contentType: string | undefined;
      if (inputs && Object.keys(inputs).length) {
        const form = new FormData();
        for (const [k, v] of Object.entries(inputs)) form.append(k, v);
        body = form; // fetch sets the multipart boundary content-type
      } else {
        contentType = undefined;
      }
      const r = await req(
        'POST',
        `/api/v1/${tenant()}/executions/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`,
        { body, contentType },
      );
      if (!r.ok) {
        return {
          ok: false as const,
          configured: true,
          error: `engine ${r.status}${r.text ? `: ${r.text.slice(0, 200)}` : ''}`,
        };
      }
      const exec = summarizeExecution(JSON.parse(r.text));
      if (!exec) return { ok: false as const, configured: true, error: 'engine returned no execution id' };
      return { ok: true as const, value: exec };
    } catch (err) {
      return { ok: false as const, configured: false, error: describeError(err) };
    }
  },

  async executionStatus(executionId: string) {
    try {
      const r = await req(
        'GET',
        `/api/v1/${tenant()}/executions/${encodeURIComponent(executionId)}`,
      );
      if (!r.ok) return null;
      return summarizeExecution(JSON.parse(r.text));
    } catch (err) {
      console.warn('[etl] kestra executionStatus failed:', describeError(err));
      return null;
    }
  },

  async executionLogs(executionId: string) {
    try {
      const r = await req(
        'GET',
        `/api/v1/${tenant()}/logs/${encodeURIComponent(executionId)}`,
      );
      if (!r.ok) return [];
      const body = JSON.parse(r.text) as unknown;
      let arr: unknown[] = [];
      if (Array.isArray(body)) arr = body;
      else if (Array.isArray((body as { results?: unknown[] })?.results)) {
        arr = (body as { results: unknown[] }).results;
      }
      return arr.map((l) => {
        const r2 = (l ?? {}) as Record<string, unknown>;
        return {
          ts: r2.timestamp != null ? String(r2.timestamp) : undefined,
          level: r2.level != null ? String(r2.level) : undefined,
          message: String(r2.message ?? ''),
          taskId: r2.taskId != null ? String(r2.taskId) : undefined,
        };
      });
    } catch (err) {
      console.warn('[etl] kestra executionLogs failed:', describeError(err));
      return [];
    }
  },
};
