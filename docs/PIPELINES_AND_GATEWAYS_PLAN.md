# OGAC architecture — Gateways × Pipelines × Consumers (reasoned plan)

> **CORRECTED MODEL (2026-07-08) — THREE tiers, read this first.** An earlier draft conflated
> "pipeline == app"; the founder corrected it. The three tiers are DISTINCT:
> ```
> GATEWAYS   reusable model backends (on-prem · OpenAI · Anthropic · OpenRouter)
>    ▲ consumed by
> PIPELINES  reusable GOVERNED MODEL-ACCESS = gateway binding + routing/rule-engine + policies
>            + guardrails + evals + golden set + drift. "A safe, evaluated, policy-wrapped way to
>            call models," reused across apps. (A NEW entity — NOT the current `apps` row.)
>    ▲ consumed by
> APPS & AGENTS  the business use-cases = pipeline binding(s) + connectors/REAL DATA SOURCES +
>            knowledge + HITL + reports + triggers + interaction (the current `apps` entity).
>            Also consumed by EXTERNAL 3rd-parties via a provisioned API.
> ```
> **What moved:** connectors/data, HITL, reports, interaction live on the APP/AGENT tier;
> policy/guardrails/evals/drift/routing live on the PIPELINE tier.
>
> **Telemetry lives on the PIPELINE too** (the pipeline is the governed chokepoint every model call
> passes through, so it already sees every request): **observability** (traces/latency/tokens),
> **auditability** (every call + policy/guardrail decision + egress + invoker), **FinOps/cost** (spend
> attributed to this pipeline → its gateway/model), **drift + eval history**, **provenance**. These are
> LENSES over the pipeline's own request stream (filtered by pipeline id). Roll-up: a GATEWAY = sum of
> all pipelines on it; an APP/AGENT = the pipeline telemetry for the calls IT made + its own HITL/
> reports; GLOBAL pages = cross-pipeline roll-up + library. Pipeline-detail tabs: Overview · Gateway/
> Routing · Policy · Guardrails · Evals+Golden · Drift · Observability · Audit · Cost · API. Gateways unchanged (reusable
> backends). The evals→app association already shipped this session should re-point to the PIPELINE
> entity once it exists (apps then reference pipelines). The sections BELOW predate this correction —
> treat this box as authoritative where they differ.


**Thesis (founder):** OGAC lets you create **reusable, composable pipelines that keep your data
safe.** A pipeline is the governed unit; it runs on a gateway; it's consumed by apps, agents, and
external third parties.

**One-sentence model:** *Org owns the substrate (gateways, data, identity); a Pipeline is a reusable
governance contract over that substrate (data-allowlist + policy + guardrails + evals + routing);
Apps/Agents/Chat are consumers that bind a pipeline and add real data + humans; a RUN is the join key
every lens (cost, traces, audit, drift) reads from.*

## Hardened model — resolved decisions (2026-07-08, founder-confirmed)

**(A) Chat/project/workspace bind a pipeline like any consumer.** Chat is NOT special — it holds a
`pipeline_id`, so every message is a governed run (policy + guardrails + observability + audit + cost,
free). Binding scopes, most-specific wins: **org default** ("Workspace Chat" pipeline, seeded per org)
→ **per-project override** (a project pins a pipeline; its knowledge/policy/guardrails apply to chats
in it — the main lever) → **per-message model pick** (only among the bound pipeline's gateway models —
you never escape the pipeline). **Who may change it: admin sets the org-default + the set "available
for chat"; users pick among those per-project.** No user can invent an ungoverned binding.

**(B) The data layer is org-owned; permission is pipeline-owned; usage is app-owned.**
- ORG owns the substrate: connector registry, data-domains, knowledge collections, live creds (vault).
- PIPELINE owns the **allowlist** — which data-domains/classes it may touch. A governance contract.
  **This allowlist is a HARD CEILING:** an app/agent can only ever touch data inside it. To use more
  data you EDIT THE PIPELINE (or bind a different one) — there is no per-app widening. One contract.
- APP/AGENT owns **usage** — the live connections + which allowed sources it actually queries (⊆ ceiling).
- Integrates at TWO governed choke points at run time: **read-authorization** (request checked vs the
  pipeline allowlist + ABAC BEFORE the connector is hit) and **masking** (retrieved rows pass through
  guardrails/PII-masking BEFORE reaching the model). Lineage records source→run.

**(C) FinOps/analytics = one fact table, many lenses; the RUN is the unit of accrual.** Every run is
stamped: `pipeline_id → gateway_id/model`, `caller (app/agent/chat)`, `user/team/dept`, `org/tenant`,
`tokens/cost/latency/egress-class`. Every view is a `group by`: per-pipeline (`pipeline_id`),
per-gateway (roll-up of its pipelines), per-app/agent (`caller`), per-user/team (chargeback), org-wide
(global FinOps = grouped by any dimension), cross-tenant (`org_id`, platform-admin only). Budgets/alerts
attach at ANY level. **Commitment: instrument at the run, attribute by dimension, NEVER store
pre-aggregated per-scope totals** — that's what keeps per-pipeline and org-wide consistent.

**(D) RBAC and ABAC are two planes that compose in sequence.**
- **RBAC = management plane (the console).** Who may DO what: create a pipeline, edit policy, mint an
  API key, view audit, cross tenants. Roles (owner/admin/operator/analyst/viewer) per org/tenant, from
  Keycloak roles → `requireModuleForUser`/`requireAdmin`. Mostly in place.
- **ABAC = data plane (the runs).** Whether a SPECIFIC request may touch this data / reach this model.
  OPA-evaluated inside the pipeline at run time on attributes: subject (role/dept/clearance/tenant) ×
  resource (data-domain classification, PII level) × action (read/generate/export) × context (egress
  class, purpose, time).
- **Sequence per invocation:** RBAC (can you invoke this pipeline at all?) → ABAC (for this request +
  this data, allowed? what's masked?). Chat closes the loop — even a chat message runs RBAC then ABAC.

## The layered model
```
GATEWAYS      on-prem cluster · OpenAI · Anthropic · OpenRouter …     (the model substrate)
   ▲ a pipeline RUNS ON a chosen gateway, with routing (model, fallback, egress leash)
PIPELINES     the reusable, composable, GOVERNED unit  ← the heart of OGAC
   • connectors / integrations   which data it may touch
   • policies + guardrails        what's allowed / masked (scoped to THIS pipeline; inherits org)
   • evals + golden set + drift   its quality bar (owned by it)
   • routing                      which gateway/model + fallback
   ▲ consumed by
APPS · AGENTS · EXTERNAL 3rd-PARTIES     via the pipeline's own provisioned API key/endpoint
```

## Reasoning — where we are vs. what's missing (from recon)
- **A pipeline == an `apps` row today.** Decision: do NOT do a disruptive rename. Treat app ≡ pipeline; surface the word "pipeline" in the IA and make the layering legible. An agent is a 1-step pipeline; pipelines compose pipelines (app-as-tool, #117) — that's the "composable" already.
- **Gateways are NOT entities yet** — only the aggregator (on-prem, `POOL` in gateway-aggregator.mjs) + cloud-provider env surfaced by `/api/v1/gateway/providers`. Need a first-class `gateways` registry so a pipeline can *pick* one.
- **Peripheries are ORG-GLOBAL, not per-pipeline:** `routing_rules.orgId`, `policies` (org), guardrail rules (org). evals + golden now carry `app_id` (done this session). Need `app_id` (nullable, null = org default/inherited) on the rest so a pipeline owns its overrides.
- Per-pipeline **provisioned API** doesn't exist — only a single shared `OFFGRID_WEBHOOK_TOKEN` on `/api/v1/app/[slug]/run`.

## Schema (serialized by the orchestrator to avoid conflicts)
- NEW `gateways` {id, orgId, name, kind: onprem|openai|anthropic|compat, baseUrl, defaultModel, enabled, createdAt} — the registry. Health derives from the aggregator + providers probe.
- `apps.gateway_id` (nullable → org default) — the pipeline↔gateway binding.
- `guardrail_rules.app_id` + a per-app routing/policy overlay (nullable app_id; null = inherited org default).
- `eval_runs.app_id` — so drift is computed over THIS pipeline's history.
- NEW `app_api_keys` {id, appId, name, hashedKey, prefix, createdAt, revokedAt} — per-pipeline provisioned keys.

## Build phases (dependency-ordered; each gated + deployed + verified)
- **P1 — Gateways first-class** (#159): `gateways` registry + lib + a Gateways surface (list/health/add) + seed sample GWs (on-prem, OpenAI, Anthropic, OpenRouter). Health via aggregator + providers probe.
- **P2 — Pipeline↔gateway binding** (#160): `apps.gateway_id`; "Runs on: <gateway>" in Build; the run path honors the bound gateway/model (+ existing routing leash).
- **P3 — Pipeline-scoped policy + guardrails** (#156): `app_id` overlay (inherit org default); a **Governance** tab on the pipeline showing effective governance = org defaults + this pipeline's overrides.
- **P4 — Drift per pipeline** (#155): `eval_runs.app_id`; drift over that pipeline's history, on the Quality tab.
- **P5 — Per-pipeline provisioned API** (#157): `app_api_keys` + mint/revoke + an **API / Integrate** tab (endpoint, key, curl/SDK) + the public run route accepts the per-pipeline key; governance applies on every call.
- **P6 — IA legibility** (#158): app-detail tabs Build · Input · Runs · Review · Reports · **Quality · Governance · API**; global catalogs (evals/policy/guardrails/gateways) relabel as "the library you attach FROM," never where scope lives.
- **P7 — Seed + verify**: sample gateways live; sample BFSI pipelines (Bharat seed) tagged as templates; walk it end-to-end on the tenant.

## Done already (this session)
Evals + golden set are pipeline-owned (`app_id`) with a per-pipeline **Quality** tab + run-in-context (#154, partial #158). Cloud gateways (OpenAI/Anthropic/OpenRouter) wired + OpenRouter live-verified. Sample BFSI pipelines seeded on the Bharat tenant.

---

## Component & linkage model (canonical)

### Gateway components
Identity (name + kind: on-prem|openai|anthropic|compat) · base URL + auth · model catalog (context
window, modality, family) · node pool (on-prem, round-robin) · health/reachability probe · **egress
class** (on-prem = data stays; cloud = data leaves — the routing leash keys off this) · cost/pricing
(→ FinOps) · rate/concurrency limits. A gateway is SHARED: many pipelines run on one gateway.

### Pipeline components (the peripheries that DEFINE it)
- **Does:** flow/steps (agent·connector-query·guardrail·human·output) + edges · trigger
  (on-demand/webhook/schedule/email) · input form.
- **Runs on (→gateway):** gateway+model binding · routing (fallback + egress leash, data_class→local/cloud/block).
- **Data it may touch:** connectors/integrations/data-domains · knowledge collections (RAG).
- **Governed by:** policy (ABAC/OPA) · guardrails (PII/injection/grounding) — scoped to it, inherit org.
- **Quality bar:** evals + golden set (run in its context, gate releases) · drift (its history).
- **Telemetry (per-pipeline lenses):** observability (traces/latency) · audit (its events) · finops
  (its cost) · provenance (signed run manifests).
- **Consumed as:** provisioned API key/endpoint · composable (pipeline-as-tool) · owner/org/visibility.

### Linkages
- ORG/TENANT defines defaults (policy, guardrails, available gateways) that pipelines INHERIT.
- GATEWAY : PIPELINE = 1 : many (a pipeline picks a gateway; routing can span gateways w/ fallback).
- Connectors/knowledge/policy/guardrails/evals/drift attach TO a pipeline (org = inherited default).
- **A RUN is the join key:** every run is tagged with pipeline + gateway, and emits an observability
  trace + audit events + finops cost + provenance. So those "systems" are just that run-data filtered
  by pipeline → the per-pipeline lenses. GLOBAL pages = cross-pipeline roll-up + attach-from library.
