import type { AdapterMeta } from './types';
import {
  type AgentRunWorkflowInput,
  type AgentRunWorkflowResult,
  type DurableConfig,
  durableConfigFromEnv,
  durableEnabled,
  statusFromWorkflow,
  type WorkflowExecutionStatus,
  workflowIdFor,
} from '@/lib/agent-run-durable';

// Agent-runtime adapters — the seam that decides HOW an agent run executes. The default is
// synchronous, in-process (runAgent in src/lib/agentrun.ts). The Temporal adapter is a durable
// swap-in: long-running / retryable / resumable agent workflows submitted to a Temporal cluster.
//
// The Temporal client speaks gRPC (:7233). We bind @temporalio/client here via a DYNAMIC import so
// the dep never enters the default Next build/bundle (next.config aliases @temporalio/worker to
// false for webpack; the client is a serverExternalPackage, required at runtime only when durable
// mode is actually selected). If the connection fails, submit() reports submitted:false and the
// caller falls through to the synchronous in-process path — selecting Temporal NEVER breaks a run.
//
// Config (all optional; fleet defaults applied in agent-run-durable.ts):
//   OFFGRID_QUEUE_ENABLED=1 | OFFGRID_ADAPTER_AGENTRUNTIME=temporal — opt into durable dispatch
//   OFFGRID_TEMPORAL_ADDRESS (host:7233, default offgrid-s1.local:7233)
//   OFFGRID_TEMPORAL_NAMESPACE (default 'default'), OFFGRID_AGENT_TASK_QUEUE (default offgrid-agents)

export interface DurableRunHandle {
  runId: string;
  workflowId: string;
  mode: 'sync' | 'durable';
  submitted: boolean;
  /** Terminal/interim run status when known (durable submit that awaited or polled). */
  status?: string;
  note?: string;
}

export interface AgentRuntimePort {
  meta: AdapterMeta;
  // True when durable dispatch is CONFIGURED (opted in). Whether the cluster is actually reachable
  // is discovered at submit-time — a submit that can't reach Temporal reports submitted:false.
  available(): boolean;
  // Submit an agent run for durable execution and await its result. Returns a handle; MUST NOT
  // throw — a runtime that can't accept/complete the run reports submitted:false and the caller
  // runs it synchronously instead.
  submit(input: AgentRunWorkflowInput): Promise<DurableRunHandle>;
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

// A cached Temporal Client keyed by address/namespace so repeated submits reuse one gRPC channel.
let cachedClient: { key: string; client: import('@temporalio/client').Client } | null = null;

async function temporalClient(cfg: DurableConfig): Promise<import('@temporalio/client').Client> {
  const key = `${cfg.temporalAddress}/${cfg.namespace}`;
  if (cachedClient?.key === key) return cachedClient.client;
  // Dynamic import: keeps @temporalio/client out of the default Next bundle.
  const { Connection, Client } = await import('@temporalio/client');
  const connection = await Connection.connect({ address: cfg.temporalAddress });
  const client = new Client({ connection, namespace: cfg.namespace });
  cachedClient = { key, client };
  return client;
}

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
  available: () => durableEnabled(process.env),
  async submit(input) {
    const cfg = durableConfigFromEnv(process.env);
    const workflowId = workflowIdFor(input.agentId, input.runId);
    try {
      const client = await temporalClient(cfg);
      // Idempotent start: reusing the same workflowId for a given runId won't spawn a duplicate.
      await client.workflow.start('AgentRunWorkflow', {
        taskQueue: cfg.taskQueue,
        workflowId,
        args: [input, cfg.maxAttempts],
      });
      const handle = client.workflow.getHandle(workflowId);
      // Await the durable result. The workflow runs the real pipeline in the worker and persists;
      // its result carries the persisted run's terminal status. If the worker is slow/down the
      // workflow simply sits in the queue durably — but the console request would block, so we
      // bound the await and, on timeout, return a 'running' handle the UI/poller can follow.
      const result = await withTimeout(handle.result() as Promise<AgentRunWorkflowResult>, awaitBudgetMs());
      if (result === TIMED_OUT) {
        const wfStatus = await handle
          .describe()
          .then((d) => d.status.name as WorkflowExecutionStatus)
          .catch(() => 'RUNNING' as const);
        return {
          runId: input.runId,
          workflowId,
          mode: 'durable',
          submitted: true,
          status: statusFromWorkflow(wfStatus),
          note: 'workflow started; result pending',
        };
      }
      return {
        runId: result.runId,
        workflowId,
        mode: 'durable',
        submitted: true,
        status: result.found ? result.status : 'not_found',
      };
    } catch (e) {
      // Any failure to reach/submit to Temporal → fall back to the synchronous path.
      return { runId: input.runId, workflowId, mode: 'sync', submitted: false, note: (e as Error).message };
    }
  },
  async health() {
    if (!durableEnabled(process.env)) return false;
    const cfg = durableConfigFromEnv(process.env);
    try {
      const { Connection } = await import('@temporalio/client');
      const connection = await Connection.connect({ address: cfg.temporalAddress });
      await connection.workflowService.getSystemInfo({});
      return true;
    } catch {
      return false;
    }
  },
};

// ── await helpers ───────────────────────────────────────────────────────────────────────────
const TIMED_OUT = Symbol('timed-out');
function awaitBudgetMs(): number {
  const v = Number(process.env.OFFGRID_AGENT_AWAIT_MS ?? '25000');
  return Number.isFinite(v) && v > 0 ? v : 25000;
}
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return Promise.race([
    p,
    new Promise<typeof TIMED_OUT>((resolve) => {
      const t = setTimeout(() => resolve(TIMED_OUT), ms);
      t.unref?.();
    }),
  ]);
}

export const AGENT_RUNTIME_PORTS: AgentRuntimePort[] = [syncRuntime, temporalRuntime];

// Select the active runtime. Durable is chosen when it's configured/opted-in; otherwise sync. The
// caller still treats a submitted:false handle as "run synchronously", so this only reflects intent.
export function getAgentRuntime(): AgentRuntimePort {
  const wanted = process.env.OFFGRID_ADAPTER_AGENTRUNTIME;
  if (wanted && wanted !== 'temporal') {
    return AGENT_RUNTIME_PORTS.find((p) => p.meta.id === wanted) ?? syncRuntime;
  }
  return temporalRuntime.available() ? temporalRuntime : syncRuntime;
}
