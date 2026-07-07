# OGAC architecture — Gateways × Pipelines × Consumers (reasoned plan)

**Thesis (founder):** OGAC lets you create **reusable, composable pipelines that keep your data
safe.** A pipeline is the governed unit; it runs on a gateway; it's consumed by apps, agents, and
external third parties.

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
