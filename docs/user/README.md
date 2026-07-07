# Off Grid AI Console — operator guide

How to *use* the console to run your on-prem AI platform. One page per surface. Audience: the
operator running the platform — not a developer. Each page answers the same questions:
**What it is · Why use it · When to use it · How to use it · How to check it's working.**

> **New here, or asking "is this actually working?"** Start with
> **[How it all works together — and how to know it's working](VERIFY.md)** — the outcomes the
> platform delivers and the one in-product signal that proves each one is real (not just deployed).

The console groups its surfaces into sections (mirrors the sidebar):

## Workspace — the everyday-create plane
- [Chat](chat.md) — your on-prem private AI (citations, thinking, @-mentions, artifacts, voice) ✅ fully documented
- [Projects](projects.md) — grouped chats + shared instructions + a knowledgebase
- [Prompts](prompts.md) — reusable prompt library
- [Artifacts](artifacts.md) — saved generated outputs, editable + versioned ✅ fully documented
- [Knowledge](knowledge.md) — the org-wide curated knowledge base
- [Storage](storage.md) — on-prem file storage & sharing

## Intelligence — build and run
- [Agents & Studio](agents-studio.md) — pre-built agents + build-your-own in plain language
- [Build an app (plain language)](app-builder.md) — the unified builder + the 5 screens (build → input → running → review → reports) ✅ fully documented
- [Data domains](data-domains.md) — declare where your data lives (the no-guess connector rule engine) ✅ fully documented
- [Triggers](triggers.md) — how an app starts: on-demand / webhook / schedule / email / whatsapp ✅ fully documented
- [App reports](app-reports.md) — run rollups + the signed per-run PDF ✅ fully documented
- [Agent Runs & Jobs](agent-runs-jobs.md) — run history **and durable (Temporal) jobs: rerun / cancel** ✅ fully documented
- [Evals](evals.md) — golden sets, 12 templates & honest quality gates ✅ fully documented
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

**Fully documented (post-chat-epic sweep, 2026-07-06):** Chat, Artifacts, plus node control in
AI Gateway and sessions/federation in Access & API keys. **Earlier sweep:** Agent Runs & Jobs,
Configuration, Services. **Skeleton (how/what/why/when, to be deepened):** all others — marked at
the top of each file. See `docs/HOWTO.md` for cross-surface step-by-step recipes and the OpenAPI spec at `/docs/api`
for the API contract.
