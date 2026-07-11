// Thin network shell for OpenSearch alerting (monitors/triggers) + ISM (index lifecycle/retention).
// All request/response SHAPING is pure and lives in `opensearch-alerting-shape.ts` (unit-tested with
// no network); this file only does I/O: it PUTs/GETs the shaped bodies against OpenSearch's native
// `_plugins/_alerting/monitors` and `_plugins/_ism/policies` APIs and hands raw responses to the pure
// parsers.
//
// GRACEFUL WHEN UNSUPPORTED: OpenSearch builds without the alerting/ISM plugins answer these paths
// with 404 / "no handler found for uri". We read the REAL response and return `{ supported:false, …,
// note }` — never faking success — exactly like the storage-lifecycle pattern in files.ts.
//
//   OFFGRID_OPENSEARCH_URL — e.g. http://127.0.0.1:9200 (defaults to localhost)
import {
  buildIsmPolicyBody,
  buildMonitorBody,
  isPluginUnsupported,
  type IsmPolicySpec,
  type IsmPolicySummary,
  type MonitorSpec,
  type MonitorSummary,
  parseIsmPolicy,
  parseMonitorGet,
  parseMonitorList,
} from '@/lib/opensearch-alerting-shape';

const DEFAULT_URL = 'http://127.0.0.1:9200';

function osUrl(): string {
  return process.env.OFFGRID_OPENSEARCH_URL ?? DEFAULT_URL;
}

export function alertingConfigured(): boolean {
  return Boolean(process.env.OFFGRID_OPENSEARCH_URL);
}

async function osFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${osUrl()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  });
}

// ── Monitors ─────────────────────────────────────────────────────────────────────────────────────

export interface MonitorsResult {
  configured: boolean;
  supported: boolean;
  monitors: MonitorSummary[];
  note?: string;
  error?: string;
}

/** List alerting monitors via `_plugins/_alerting/monitors/_search` (match_all). */
export async function listMonitors(): Promise<MonitorsResult> {
  const configured = alertingConfigured();
  try {
    const res = await osFetch('/_plugins/_alerting/monitors/_search', {
      method: 'POST',
      body: JSON.stringify({ size: 200, query: { match_all: {} } }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (isPluginUnsupported(res.status, body)) {
        return {
          configured,
          supported: false,
          monitors: [],
          note: `Alerting plugin not available (OpenSearch ${res.status} for _plugins/_alerting/monitors)`,
        };
      }
      return { configured, supported: true, monitors: [], error: `OpenSearch ${res.status}` };
    }
    const json = (await res.json()) as Parameters<typeof parseMonitorList>[0];
    return { configured, supported: true, monitors: parseMonitorList(json) };
  } catch (e) {
    return { configured, supported: true, monitors: [], error: (e as Error).message };
  }
}

export interface MonitorWriteResult {
  configured: boolean;
  supported: boolean;
  id?: string;
  monitor?: MonitorSummary | null;
  note?: string;
  error?: string;
}

/** Create a monitor: POST the shaped body to `_plugins/_alerting/monitors`. */
export async function createMonitor(spec: MonitorSpec): Promise<MonitorWriteResult> {
  const configured = alertingConfigured();
  try {
    const res = await osFetch('/_plugins/_alerting/monitors', {
      method: 'POST',
      body: JSON.stringify(buildMonitorBody(spec)),
    });
    const body = await res.text().catch(() => '');
    if (!res.ok) {
      if (isPluginUnsupported(res.status, body)) {
        return {
          configured,
          supported: false,
          note: `Alerting plugin not available (OpenSearch ${res.status})`,
        };
      }
      return { configured, supported: true, error: `OpenSearch ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = JSON.parse(body) as { _id?: string; monitor?: Record<string, unknown> };
    return { configured, supported: true, id: json._id, monitor: parseMonitorGet(json) };
  } catch (e) {
    return { configured, supported: true, error: (e as Error).message };
  }
}

/** Update a monitor: PUT the shaped body to `_plugins/_alerting/monitors/<id>`. */
export async function updateMonitor(id: string, spec: MonitorSpec): Promise<MonitorWriteResult> {
  const configured = alertingConfigured();
  try {
    const res = await osFetch(`/_plugins/_alerting/monitors/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(buildMonitorBody(spec)),
    });
    const body = await res.text().catch(() => '');
    if (!res.ok) {
      if (isPluginUnsupported(res.status, body)) {
        return {
          configured,
          supported: false,
          note: `Alerting plugin not available (OpenSearch ${res.status})`,
        };
      }
      return { configured, supported: true, error: `OpenSearch ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = JSON.parse(body) as { _id?: string; monitor?: Record<string, unknown> };
    return { configured, supported: true, id: json._id ?? id, monitor: parseMonitorGet(json) };
  } catch (e) {
    return { configured, supported: true, error: (e as Error).message };
  }
}

export interface DeleteResult {
  configured: boolean;
  supported: boolean;
  deleted: boolean;
  note?: string;
  error?: string;
}

/** Delete a monitor via `DELETE _plugins/_alerting/monitors/<id>`. */
export async function deleteMonitor(id: string): Promise<DeleteResult> {
  const configured = alertingConfigured();
  try {
    const res = await osFetch(`/_plugins/_alerting/monitors/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.ok) return { configured, supported: true, deleted: true };
    const body = await res.text().catch(() => '');
    if (res.status === 404 && /monitor/i.test(body)) {
      // A 404 that names the monitor = plugin present, id unknown (not "plugin missing").
      return { configured, supported: true, deleted: false, note: 'monitor not found' };
    }
    if (isPluginUnsupported(res.status, body)) {
      return {
        configured,
        supported: false,
        deleted: false,
        note: `Alerting plugin not available (OpenSearch ${res.status})`,
      };
    }
    return { configured, supported: true, deleted: false, error: `OpenSearch ${res.status}` };
  } catch (e) {
    return { configured, supported: true, deleted: false, error: (e as Error).message };
  }
}

// ── ISM retention policy ─────────────────────────────────────────────────────────────────────────

export interface IsmReadResult {
  configured: boolean;
  supported: boolean;
  policy: IsmPolicySummary | null;
  note?: string;
  error?: string;
}

/** Read an ISM policy via `GET _plugins/_ism/policies/<id>`. A 404 that names the policy = supported-but-absent. */
export async function getIsmPolicy(policyId: string): Promise<IsmReadResult> {
  const configured = alertingConfigured();
  try {
    const res = await osFetch(`/_plugins/_ism/policies/${encodeURIComponent(policyId)}`, {
      method: 'GET',
    });
    if (res.ok) {
      const json = (await res.json()) as Parameters<typeof parseIsmPolicy>[0];
      return { configured, supported: true, policy: parseIsmPolicy(json) };
    }
    const body = await res.text().catch(() => '');
    // ISM plugin present but this policy doesn't exist yet: OpenSearch answers 404 without the
    // "no handler found"/"not found for uri" wording that signals a missing plugin.
    if (res.status === 404 && !/no handler found|not found for uri/i.test(body)) {
      return { configured, supported: true, policy: null, note: 'no policy set yet' };
    }
    if (isPluginUnsupported(res.status, body)) {
      return {
        configured,
        supported: false,
        policy: null,
        note: `ISM plugin not available (OpenSearch ${res.status} for _plugins/_ism/policies)`,
      };
    }
    return { configured, supported: true, policy: null, error: `OpenSearch ${res.status}` };
  } catch (e) {
    return { configured, supported: true, policy: null, error: (e as Error).message };
  }
}

export interface IsmWriteResult {
  configured: boolean;
  supported: boolean;
  policy: IsmPolicySummary | null;
  note?: string;
  error?: string;
}

/**
 * Create or update an ISM policy via `PUT _plugins/_ism/policies/<id>`. OpenSearch requires
 * `?if_seq_no=&if_primary_term=` on an update; we read the current policy first to supply them (and
 * to distinguish create from update). Returns the resulting policy summary (re-read).
 */
export async function setIsmPolicy(spec: IsmPolicySpec): Promise<IsmWriteResult> {
  const configured = alertingConfigured();
  try {
    const current = await getIsmPolicy(spec.policyId);
    if (!current.supported) {
      return { configured, supported: false, policy: null, note: current.note };
    }
    let path = `/_plugins/_ism/policies/${encodeURIComponent(spec.policyId)}`;
    if (current.policy?.seqNo != null && current.policy?.primaryTerm != null) {
      path += `?if_seq_no=${current.policy.seqNo}&if_primary_term=${current.policy.primaryTerm}`;
    }
    const res = await osFetch(path, {
      method: 'PUT',
      body: JSON.stringify(buildIsmPolicyBody(spec)),
    });
    const body = await res.text().catch(() => '');
    if (!res.ok) {
      if (isPluginUnsupported(res.status, body)) {
        return {
          configured,
          supported: false,
          policy: null,
          note: `ISM plugin not available (OpenSearch ${res.status})`,
        };
      }
      return {
        configured,
        supported: true,
        policy: null,
        error: `OpenSearch ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    // Re-read so the caller gets the canonical stored shape + fresh seq numbers.
    const after = await getIsmPolicy(spec.policyId);
    return { configured, supported: true, policy: after.policy, note: after.note };
  } catch (e) {
    return { configured, supported: true, policy: null, error: (e as Error).message };
  }
}

/** Delete an ISM policy via `DELETE _plugins/_ism/policies/<id>`. */
export async function deleteIsmPolicy(policyId: string): Promise<DeleteResult> {
  const configured = alertingConfigured();
  try {
    const res = await osFetch(`/_plugins/_ism/policies/${encodeURIComponent(policyId)}`, {
      method: 'DELETE',
    });
    if (res.ok) return { configured, supported: true, deleted: true };
    const body = await res.text().catch(() => '');
    if (res.status === 404 && !/no handler found|not found for uri/i.test(body)) {
      return { configured, supported: true, deleted: false, note: 'policy not found' };
    }
    if (isPluginUnsupported(res.status, body)) {
      return {
        configured,
        supported: false,
        deleted: false,
        note: `ISM plugin not available (OpenSearch ${res.status})`,
      };
    }
    return { configured, supported: true, deleted: false, error: `OpenSearch ${res.status}` };
  } catch (e) {
    return { configured, supported: true, deleted: false, error: (e as Error).message };
  }
}
