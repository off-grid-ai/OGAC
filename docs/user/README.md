# Off Grid Console — operator guide

How to *use* the console to run your on-prem AI platform. One page per surface. Audience: the
operator running the platform — not a developer. Each page answers the same four questions:
**What it is · Why use it · When to use it · How to use it.**

The console groups its surfaces into sections (mirrors the sidebar):

## Workspace — the everyday-create plane
- [Chat](chat.md) — your on-prem ChatGPT
- [Projects](projects.md) — grouped chats + shared instructions + a knowledgebase
- [Prompts](prompts.md) — reusable prompt library
- [Artifacts](artifacts.md) — saved generated outputs (HTML/SVG/React/code)
- [Knowledge](knowledge.md) — the org-wide curated knowledge base
- [Storage](storage.md) — on-prem file storage & sharing

## Intelligence — build and run
- [Agents & Studio](agents-studio.md) — pre-built agents + build-your-own in plain language
- [Agent Runs & Jobs](agent-runs-jobs.md) — run history **and durable (Temporal) jobs: rerun / cancel** ✅ fully documented
- [Evals](evals.md) — golden sets & quality gates
- [Brain](brain.md) — ingestion → retrieval (RAG)

## Gateway & Fleet
- [AI Gateway & Model Routing](model-routing.md) — the LLM edge, providers, routing rules
- [Services](services.md) — the service directory + **honest health** ✅ fully documented
- [Fleet](fleet.md) — devices, enrollment, kill switch

## Data
- [Data & Retrieval](retrieval-knowledge.md) — connectors, ingestion, PII masking, vector store, lineage

## Governance
- [Policy](policy.md) — policy-as-code (OPA)
- [Guardrails](guardrails.md) — PII / injection / grounding
- [Secrets](secrets.md) — OpenBao secret lifecycle
- [Access & API keys](access-api-keys.md) — users, roles, machine clients, virtual keys

## Insights
- [Observability](observability.md) — eval scores, LLM-as-judge, drift, traces
- [Audit Log](audit-logs.md) — the accountability trail

## Operations
- [Configuration](config-settings.md) — every environment setting, **secrets masked, mDNS hosts** ✅ fully documented

---

**Fully documented (this sweep):** Agent Runs & Jobs, Configuration, Services (the 3 just-merged
surfaces). **Skeleton (how/what/why/when, to be deepened):** all others — marked at the top of each
file. See `docs/HOWTO.md` for cross-surface step-by-step recipes and the OpenAPI spec at `/docs/api`
for the API contract.
