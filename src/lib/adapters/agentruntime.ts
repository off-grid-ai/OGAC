import type { AdapterMeta } from './types';

// Agent-runtime adapters — the seam that decides HOW an agent run executes. The default is
// synchronous, in-process (runAgent in src/lib/agentrun.ts). The Temporal adapter is a durable
// swap-in: long-running / retryable / resumable agent workflows submitted to a Temporal cluster.
//
// This is a best-effort scaffold. Temporal's real client speaks gRPC (:7233) and is heavy to bind
// server-side in Next.js; the durable adapter here exposes the port + a submission path against a
// Temporal HTTP-facing endpoint if configured, and otherwise reports itself unavailable so the
// caller keeps the synchronous default. Selecting it never breaks agent runs.
//
// Config: OFFGRID_ADAPTER_AGENTRUNTIME=temporal, OFFGRID_TEMPORAL_ADDRESS (host:7233),
//   OFFGRID_TEMPORAL_NAMESPACE (default 'default'), OFFGRID_TEMPORAL_TASK_QUEUE,
//   OFFGRID_TEMPORAL_HTTP_URL (optional: a Temporal HTTP API / bridge for submission).

export interface DurableRunHandle {
  runId: string;
  workflowId: string;
  mode: 'sync' | 'durable';
  submitted: boolean;
  note?: string;
}

export interface AgentRuntimePort {
  meta: AdapterMeta;
  // True when this runtime can actually accept a durable submission right now. When false the
  // caller must fall through to the synchronous in-process path.
  available(): boolean;
  // Submit an agent run for durable execution. Returns a handle; MUST NOT throw — a runtime that
  // can't accept the run reports submitted:false and the caller runs it synchronously instead.
  submit(input: { agentId: string; query: string; runId: string }): Promise<DurableRunHandle>;
  health(): Promise<boolean>;
}

// Default: no durable runtime. runAgent executes in-process and this simply acknowledges sync mode.
export const syncRuntime: AgentRuntimePort = {
  meta: {
    id: 'sync',
    capability: 'sandbox',
    vendor: 'First-party',
    license: 'first-party',
    render: 'headless',
    description: 'Synchronous in-process agent execution (default). No external runtime.',
  },
  available: () => true,
  submit: ({ agentId, query, runId }) =>
    Promise.resolve({
      runId,
      workflowId: `${agentId}:${runId}`,
      mode: 'sync',
      submitted: false,
      note: 'synchronous in-process execution',
    }),
  health: () => Promise.resolve(true),
};

const TEMPORAL_ADDRESS = process.env.OFFGRID_TEMPORAL_ADDRESS;
const TEMPORAL_HTTP = process.env.OFFGRID_TEMPORAL_HTTP_URL;
const TEMPORAL_NS = process.env.OFFGRID_TEMPORAL_NAMESPACE ?? 'default';
const TASK_QUEUE = process.env.OFFGRID_TEMPORAL_TASK_QUEUE ?? 'offgrid-agents';

export const temporalRuntime: AgentRuntimePort = {
  meta: {
    id: 'temporal',
    capability: 'sandbox',
    vendor: 'Temporal',
    license: 'MIT',
    render: 'headless',
    embedUrl: process.env.OFFGRID_TEMPORAL_UI_URL,
    description:
      'Durable agent workflows submitted to a Temporal cluster (:7233). Retryable/resumable runs.',
  },
  // Only advertise availability when an HTTP submission bridge is configured — a raw gRPC :7233
  // address alone can't be reached from this fetch-only seam, so we stay honest and fall back.
  available: () => Boolean(TEMPORAL_HTTP),
  async submit({ agentId, query, runId }) {
    const workflowId = `${agentId}:${runId}`;
    if (!TEMPORAL_HTTP) {
      // TODO(temporal): bind @temporalio/client (gRPC) in a Node runtime to submit against
      // OFFGRID_TEMPORAL_ADDRESS directly. Until then, without an HTTP bridge we cannot submit.
      return {
        runId,
        workflowId,
        mode: 'sync',
        submitted: false,
        note: TEMPORAL_ADDRESS
          ? 'Temporal gRPC configured but no HTTP bridge (OFFGRID_TEMPORAL_HTTP_URL); running sync'
          : 'Temporal not configured; running sync',
      };
    }
    try {
      const res = await fetch(
        `${TEMPORAL_HTTP}/api/v1/namespaces/${TEMPORAL_NS}/workflows/${encodeURIComponent(workflowId)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workflowType: { name: 'AgentRunWorkflow' },
            taskQueue: { name: TASK_QUEUE },
            input: [{ agentId, query, runId }],
          }),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!res.ok) {
        return { runId, workflowId, mode: 'sync', submitted: false, note: `Temporal ${res.status}` };
      }
      return { runId, workflowId, mode: 'durable', submitted: true };
    } catch (e) {
      return { runId, workflowId, mode: 'sync', submitted: false, note: (e as Error).message };
    }
  },
  async health() {
    if (!TEMPORAL_HTTP) return false;
    try {
      const res = await fetch(`${TEMPORAL_HTTP}/api/v1/namespaces/${TEMPORAL_NS}`, {
        signal: AbortSignal.timeout(2500),
      });
      return res.ok;
    } catch {
      return false;
    }
  },
};

export const AGENT_RUNTIME_PORTS: AgentRuntimePort[] = [syncRuntime, temporalRuntime];

// Select the active runtime (defaults to sync). Kept local to avoid touching the shared registry's
// Capability union — this is a best-effort scaffold, not yet a first-class capability row.
export function getAgentRuntime(): AgentRuntimePort {
  const wanted = process.env.OFFGRID_ADAPTER_AGENTRUNTIME;
  const chosen = AGENT_RUNTIME_PORTS.find((p) => p.meta.id === wanted) ?? syncRuntime;
  return chosen.available() ? chosen : syncRuntime;
}
