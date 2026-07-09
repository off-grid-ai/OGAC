// Production wiring for the public-pipeline executor's injected boundaries (PA-11). Kept OUT of
// pipeline-execute.ts so the pure executor + its tests never load the gateway/DB/PII modules — this
// module is the only place the real subsystems are imported, and it's imported ONLY by the route.
//
// Each boundary reuses an EXISTING governed seam (DRY — no new gateway/guardrail/PII logic):
//   • gatewayComplete → the same POST /v1/chat/completions the agent-run path uses (gateway.ts),
//     with x-offgrid-user attribution for FinOps. `forceLocal` is passed to the gateway as a
//     data-class hint so a leashed call routes on-prem.
//   • runGuardrail   → runChecks + outcomeFromChecks (checks.ts), org-scoped (worker-safe).
//   • scanPii        → the guardrails PII port (registry.ts), org-scoped.
//   • audit          → recordAudit (store.ts), tagged with the pipeline resource.

import type { ExecuteDeps, GatewayCompletion } from '@/lib/pipeline-execute';
import { pipelineTag } from '@/lib/pipeline-api-key-format';

const DEFAULT_MODEL = process.env.OFFGRID_GROUNDING_MODEL ?? 'gemma-local';

function extractText(data: unknown): string | null {
  const text = (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message
    ?.content;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

function extractUsage(data: unknown): { prompt: number; completion: number; total: number } {
  const u = (data as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } })
    ?.usage;
  return {
    prompt: Number(u?.prompt_tokens ?? 0) || 0,
    completion: Number(u?.completion_tokens ?? 0) || 0,
    total: Number(u?.total_tokens ?? 0) || 0,
  };
}

/**
 * Wire the executor's boundaries to the real platform. `pipelineId`/`orgId`/`runId` are baked in so
 * the audit events are pipeline-tagged, tenant-scoped, and correlated by the route's runId. The
 * gateway call reuses the exact governed path (gatewayHeaders + /v1/chat/completions) as agentrun.ts.
 */
export function defaultExecuteDeps(pipelineId: string, orgId: string, runId: string): ExecuteDeps {
  return {
    defaultModel: DEFAULT_MODEL,

    async gatewayComplete({ model, prompt, forceLocal, caller, params }): Promise<GatewayCompletion> {
      const { GATEWAY_URL, gatewayHeaders } = await import('@/lib/gateway');
      // Forward ONLY the known sampling params the request-policy layer governs (already clamped by
      // the pure pre-check). Anything else the caller sent is ignored — the gateway body stays clean.
      const p = params ?? {};
      const sampling: Record<string, unknown> = {};
      for (const key of ['max_tokens', 'temperature', 'top_p'] as const) {
        if (typeof p[key] === 'number' && Number.isFinite(p[key] as number)) sampling[key] = p[key];
      }
      const body = {
        model,
        temperature: 0,
        ...sampling,
        messages: [{ role: 'user', content: prompt }],
        chat_template_kwargs: { enable_thinking: false },
        // A leashed call carries a data-class hint the gateway routes on-prem; a cloud-permitted call
        // omits it so the gateway's own routing rules decide. This never RELAXES the leash (the pure
        // verdict already blocked a cloud reach if egress was off) — it only signals the intent.
        ...(forceLocal ? { metadata: { data_class: 'pii', egress: 'local' } } : {}),
      };
      const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: gatewayHeaders({
          'content-type': 'application/json',
          ...(caller ? { 'x-offgrid-user': caller } : {}),
        }),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return { model, text: null };
      const data = await res.json();
      return { model, text: extractText(data), usage: extractUsage(data) };
    },

    async runGuardrail(phase, text, orgId, model) {
      const { runChecks, outcomeFromChecks } = await import('@/lib/checks');
      const checks = await runChecks(
        phase,
        phase === 'pre'
          ? { phase, input: text, model, orgId }
          : { phase, output: text, model, orgId },
      );
      return { checks, outcome: outcomeFromChecks(checks) };
    },

    async scanPii(text, orgId) {
      const { getPii } = await import('@/lib/adapters/registry');
      const scan = await getPii().scan(text, orgId);
      return { hits: scan.hits, redacted: scan.redacted, entities: scan.entities, engine: scan.engine };
    },

    audit(action, outcome, detail, model, tokens) {
      // Fire-and-forget; a lazy import keeps store.ts off the pure path. Tagged with the pipeline so
      // the per-pipeline audit/FinOps lens lights up, correlated by the route's runId.
      void (async () => {
        try {
          const { recordAudit } = await import('@/lib/store');
          recordAudit({
            actor: { type: 'machine', id: 'pipeline-key', label: 'Provisioned API key' },
            org: orgId,
            project: pipelineTag(pipelineId),
            action,
            resource: `${pipelineTag(pipelineId)} — ${detail}`,
            model: model ?? null,
            tokens: tokens ? { prompt: 0, completion: 0, total: tokens } : null,
            outcome,
            runId,
          });
        } catch {
          /* audit is best-effort */
        }
      })();
    },
  };
}
