// ─────────────────────────────────────────────────────────────────────────────────────────────
// Org context assembler (Builder Epic Phase 1C, task #102 — org inheritance foundation).
//
// THE IDEA: everything a user builds (an app / agent) must INHERIT the organization's context
// automatically — connectors, data domains, tools + their action policy, guardrails, policy,
// model-routing rules + allowed models, and the Brain knowledge base. It must NOT feel like
// starting from zero.
//
// This module assembles that context ONCE by CALLING EXISTING store getters (read-only consumer —
// it never mutates or re-implements them). The builder catalog and the multi-step executor both
// read the returned OrgContext, so the shape here is the stable inheritance contract.
//
// SOLID split:
//   • getOrgContext()      — thin I/O aggregation over the existing getters (integration-tested).
//   • summarizeOrgContext() — PURE, zero-IO fold to counts + names (no secrets) (unit-tested).
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { type BrainDoc, listDocuments } from '@/lib/brain';
import { listDomains } from '@/lib/data-domains-store';
import { type GuardrailRule, listGuardrailRules } from '@/lib/guardrails-rules';
import {
  type Connector,
  type Dataset,
  type PolicyBundle,
  type RoutingRule,
  type Tool,
  getOrgPolicy,
  listConnectors,
  listDatasets,
  listRoutingRules,
  listTools,
} from '@/lib/store';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// ─── Data domains (Phase 1B — statically imported) ───────────────────────────────────────────────
// `lib/data-domains-store.ts` (`listDomains`) is long since merged, so we import it statically (top
// of file). It was previously loaded via a computed-specifier dynamic import as "merge-race"
// defensiveness — but that specifier can't be bundled by the Next production build, so it threw at
// runtime and silently degraded org data-domain inheritance to [] in prod. Static import is correct.
//
// Shape mirrors the plan (§3.2): DataDomain{ id, label, aliases[], connectorId, resource, ... }.
// Kept intentionally loose so 1B's richer type is assignable without a hard compile-time coupling.
export interface OrgDataDomain {
  id: string;
  label: string;
  aliases?: string[];
  connectorId?: string | null;
  resource?: string | null;
}

// Feature-detect + load the data-domains store at runtime. Returns [] if 1B hasn't landed, if the
// module has no `listDomains` export yet, or if the query fails (e.g. table not yet migrated).
async function loadDataDomains(orgId: string): Promise<OrgDataDomain[]> {
  try {
    // Phase 1B has long since landed, so we STATICALLY import listDomains (top of file). The old
    // computed-specifier `import(spec)` could not be bundled by the Next production build → it threw
    // at runtime → caught → [] → the builder ALWAYS showed "no data domains declared" in prod even
    // though domains were declared. Static import fixes the inheritance for real. (2026-07-07)
    const rows = (await listDomains(orgId)) as unknown;
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => {
      const d = r as Record<string, unknown>;
      return {
        id: String(d.id ?? ''),
        label: String(d.label ?? d.name ?? d.id ?? ''),
        aliases: Array.isArray(d.aliases) ? d.aliases.map(String) : undefined,
        connectorId: (d.connectorId as string | null | undefined) ?? null,
        resource: (d.resource as string | null | undefined) ?? null,
      };
    });
  } catch {
    // Module/table not present yet, or a transient read error — inheritance degrades gracefully to
    // "no data domains" rather than failing the whole context assembly.
    return [];
  }
}

// ─── The inheritance contract ────────────────────────────────────────────────────────────────────
// Everything a newly-built app/agent inherits from its org. Field → source getter is documented
// per-line so consumers (builder catalog, executor) know exactly where each slice originates.
export interface OrgContext {
  orgId: string;
  /** Live data connectors (Postgres/MySQL/MSSQL/REST). Source: store.listConnectors. */
  connectors: Connector[];
  /** Data-domain → connector bindings for the rule engine. Source: data-domains-store.listDomains
   *  (Phase 1B — [] if not yet available; see `dataDomainsAvailable`). */
  dataDomains: OrgDataDomain[];
  /** Whether the data-domains subsystem (1B) was resolvable at assembly time. When false,
   *  `dataDomains` is [] because the module/table isn't present yet — not because there are none. */
  dataDomainsAvailable: boolean;
  /** Datasets / collections registered for the org. Source: store.listDatasets. */
  datasets: Dataset[];
  /** Callable tools WITH their action policy (allow|approval|blocked). Source: store.listTools. */
  tools: Tool[];
  /** Data-masking / PII guardrail rules. Source: guardrails-rules.listGuardrailRules. */
  guardrailRules: GuardrailRule[];
  /** Org policy bundle: egress leash, guardrail names, allowed models, version. Source:
   *  store.getOrgPolicy. */
  policy: PolicyBundle;
  /** Model-routing rules (priority-ordered). Source: store.listRoutingRules. */
  routingRules: RoutingRule[];
  /** Models the org is allowed to run (from the active policy bundle). Source: policy.allowedModels. */
  allowedModels: string[];
  /** Brain knowledge-base documents (org KB for grounded retrieval). Source: brain.listDocuments. */
  brainDocuments: BrainDoc[];
}

// Aggregate the full org context by calling the existing getters concurrently. Pure aggregation
// over I/O — it adds no business rules; it only fans out and shapes the result.
//
// NOTE on scoping: `listConnectors`, `listDatasets`, `listTools`, `listRoutingRules`,
// `listGuardrailRules` are org-scoped and take `orgId`. `getOrgPolicy` and `listDocuments` are
// currently global (single active policy / single Brain) — we pass `orgId` through for the scoped
// getters and record it on the context; the global getters are called as-is and will inherit
// org-scoping for free if/when they gain it.
export async function getOrgContext(orgId: string = DEFAULT_ORG): Promise<OrgContext> {
  const [
    connectors,
    datasets,
    tools,
    routingRules,
    guardrailRules,
    policy,
    brainDocuments,
    dataDomains,
  ] = await Promise.all([
    listConnectors(orgId),
    listDatasets(orgId),
    listTools(orgId),
    listRoutingRules(orgId),
    listGuardrailRules(orgId),
    getOrgPolicy(),
    listDocuments(orgId),
    loadDataDomains(orgId),
  ]);

  return {
    orgId,
    connectors,
    dataDomains,
    dataDomainsAvailable: dataDomains.length > 0,
    datasets,
    tools,
    guardrailRules,
    policy,
    routingRules,
    allowedModels: policy.allowedModels ?? [],
    brainDocuments,
  };
}

// ─── Pure summary (zero-IO, unit-testable) ───────────────────────────────────────────────────────
// A secret-free digest for rendering "this app inherits: N connectors, N tools, N data domains,
// guardrails on, …" in the builder. Counts + NAMES only — no endpoints, no auth, no rule bodies,
// no document text. This is what the builder shows the user to prove nothing starts from zero.
export interface OrgContextSummary {
  orgId: string;
  connectors: { count: number; names: string[] };
  dataDomains: { count: number; names: string[]; available: boolean };
  datasets: { count: number; names: string[] };
  tools: { count: number; names: string[]; policies: Record<string, number> };
  guardrails: { count: number; enabled: number; on: boolean };
  policy: { version: number; egressAllowed: boolean; guardrailCount: number };
  routing: { count: number; enabled: number };
  models: { count: number; names: string[] };
  brain: { documentCount: number };
}

export function summarizeOrgContext(ctx: OrgContext): OrgContextSummary {
  // Tally tool action-policies (allow|approval|blocked) without leaking endpoints/auth.
  const toolPolicies: Record<string, number> = {};
  for (const t of ctx.tools) {
    toolPolicies[t.policy] = (toolPolicies[t.policy] ?? 0) + 1;
  }

  const enabledGuardrails = ctx.guardrailRules.filter((r) => r.enabled).length;

  return {
    orgId: ctx.orgId,
    connectors: { count: ctx.connectors.length, names: ctx.connectors.map((c) => c.name) },
    dataDomains: {
      count: ctx.dataDomains.length,
      names: ctx.dataDomains.map((d) => d.label),
      available: ctx.dataDomainsAvailable,
    },
    datasets: { count: ctx.datasets.length, names: ctx.datasets.map((d) => d.name) },
    tools: {
      count: ctx.tools.length,
      names: ctx.tools.map((t) => t.name),
      policies: toolPolicies,
    },
    guardrails: {
      count: ctx.guardrailRules.length,
      enabled: enabledGuardrails,
      // "guardrails on" = the org has at least one active masking/PII rule OR a policy-level guardrail.
      on: enabledGuardrails > 0 || (ctx.policy.guardrails?.length ?? 0) > 0,
    },
    policy: {
      version: ctx.policy.version,
      egressAllowed: ctx.policy.egressAllowed,
      guardrailCount: ctx.policy.guardrails?.length ?? 0,
    },
    routing: {
      count: ctx.routingRules.length,
      enabled: ctx.routingRules.filter((r) => r.enabled).length,
    },
    models: { count: ctx.allowedModels.length, names: ctx.allowedModels },
    brain: { documentCount: ctx.brainDocuments.length },
  };
}
