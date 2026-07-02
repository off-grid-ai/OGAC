# Off Grid Console

> The control plane for private AI infrastructure — what AWS is for cloud, Off Grid is for the AI age.

---

## The idea

Every org running AI in 2025 faces the same problem: a pile of OSS services they don't fully control, SaaS vendors who own their data, and no unified surface to govern any of it.

Off Grid is the answer. A **private, on-prem AI platform** built entirely on open-source primitives — local inference, governed routing, memory, observability, policy, lineage — with a single console that makes all of it composable without writing code.

The console is not a dashboard. It is the **control plane**: the thing that makes 14 independent services feel like one coherent platform. The analogy is AWS — not because we're a cloud, but because AWS made infrastructure composable for the internet age. Off Grid does the same for the AI age, on your hardware, under your governance.

---

## Philosophy

**Three hard principles that do not bend:**

1. **No duplication.** Every capability is defined once. The console references it; it does not reimplement it. If a capability changes, it changes in one place.

2. **No lock-in.** Every service is swappable via a single environment variable. Point the vector store at Qdrant instead of LanceDB: one line. Use Temporal instead of synchronous Postgres for agent runs: one line. The platform is a composition of open interfaces, not a walled garden.

3. **True OSS.** The gateway, the module SDK, and every interface-driven capability are AGPL-3.0. Run the entire stack — gateway, Brain, policy, observability, fleet — with no account, no console, no paywall. The Pro tier sells the hard, maintained work (connector libraries, ETL pipelines, fleet orchestration, managed hosting) — not locked capability.

**The OSS/Pro line is a principle, not a feature list.** Plug-and-play = open. Ongoing engineering maintenance = Pro. That line can move per-module. The architecture never encodes it.

---

## What is built today

### The platform spine — `@offgrid/gateway`

The local, OpenAI-compatible AI gateway. Runs on-prem at `:8800`. Everything routes through it.

- **Cluster router** — multinode routing with true inference health (not process liveness), in-process admission control, and backpressure.
- **Policy pipeline** — composable middleware: Keycloak JWT auth, client token auth, rate limits, budget enforcement, PII guardrails, response cache. Each policy is a drop-in module.
- **Observability sinks** — pluggable fan-out: OpenSearch (audit), Langfuse (LLM traces), stdout. Add a sink without touching the router.
- **Temporal queue** — durable async inference via `@temporalio/*`. Activated with `OFFGRID_QUEUE_ENABLED=1`.

What is not yet built: `defineOffgrid()` — the config-driven module registry that makes the gateway a true composition root. This is the next major architectural milestone (see Phase 2 below).

### The shared package layer — `@offgrid/*`

14 packages, all built, all tested. The console uses 4 today; the rest are ready and waiting.

| Package | What it does | Console uses it? |
|---|---|---|
| `@offgrid/analytics` | Traffic ring buffer, PostHog/Mixpanel/webhook sinks | Yes |
| `@offgrid/finops` | Pricing table, 30-day budget accumulator, gateway middleware | Yes |
| `@offgrid/policy` | Guardrails, rate-limit, budget, cache middleware chain | Yes |
| `@offgrid/vectordb` | Qdrant + LanceDB inspectors + PCA scatter-plot | Yes |
| `@offgrid/memory` | Cross-device memory store | Not yet wired |
| `@offgrid/sync` | EasyShare sync engine | Not yet wired |
| `@offgrid/rag` | RAG pipeline (shared package) | Not yet wired |
| `@offgrid/pipeline` | ETL pipeline primitives | Not yet wired |
| `@offgrid/design` | Design tokens, brutalist theme | Desktop only |
| `@offgrid/clipboard` | Clipboard engine | Desktop only |
| `@offgrid/capture` | Screen capture primitive | Desktop only |
| `@offgrid/ui` | Shared React components | Not yet wired |

### The console — 22 modules across 5 planes

The console is a Next.js app running on-prem. Every page is a module: independently adoptable, API-first, toggled via `NEXT_PUBLIC_OFFGRID_MODULES`. A disabled module's route returns 404.

**Productivity plane** — what end users touch
| Module | What it does | State |
|---|---|---|
| Chat | On-prem ChatGPT — local models, no per-seat cost | Live |
| Projects | Shared context + knowledge per topic | Live |
| Artifacts | Library of generated HTML/SVG/code from chats | Live |
| Prompts | Reusable prompt library + common-prompts view (cluster-deduped) | Live |

**Infrastructure plane** — the services layer
| Module | What it does | State |
|---|---|---|
| Gateway | Model routing, providers, OpenAI endpoint, cache, traffic, tokens, settings | Live |
| Fleet | Device inventory, enrollment, policy, kill-switch | Live (FleetDM needs one-time setup) |
| Integrations | Every adapter port — active backend, health, swap env var | Live |
| Services | Directory of all Off Grid surfaces with live health | Live |

**Intelligence plane** — the Brain + agents
| Module | What it does | State |
|---|---|---|
| Brain | Knowledge ingestion → RAG → retrieval with citations | Live (LanceDB default) |
| Knowledge | Org-wide shared KB, permission-aware retrieval in chat | Live |
| Agents | Pre-built AI agent use cases | Live |
| Studio | Build agents + workflows in plain language | Live (scaffold) |
| Data | Connectors, ingestion, PII masking, data catalog | Live |

**Observability plane** — the telemetry layer
| Module | What it does | State |
|---|---|---|
| Observability | Eval scores, LLM-as-judge, drift, trace waterfall (Langfuse-backed) | Live |
| Analytics | Usage, cost, latency across the fleet | Live |
| FinOps | Virtual keys, per-user budgets, cost tracking | Live |
| Lineage | Source→answer provenance (OpenLineage/Marquez-backed) | Live |

**Governance plane** — the compliance layer
| Module | What it does | State |
|---|---|---|
| Control | Guardrails, egress policy, audit log, secrets vault | Live |
| Regulatory | DPO view, framework mapping, DPIA exports | Live |
| Reports | Regulator-ready citation-backed exports | Live |
| Access | Users, roles, machine clients (Keycloak-backed) | Live |
| Admin | Tenants, provisioning, ABAC policy | Live |

### The infrastructure — what runs underneath

14 logical services (~29 containers) across two nodes. Every service is swappable.

| Service | Purpose | Swap? |
|---|---|---|
| Postgres + pgvector | System of record, audit, vector store | No (canonical) |
| Keycloak | Identity / SSO (OIDC) | No (canonical) |
| OPA | Policy-as-code decisions | Falls back to first-party ABAC |
| OpenBao | Secrets vault (KV v2) | — |
| Redis | Response cache | Falls back to in-process Map |
| Unleash | Feature flags | Falls back to Postgres flags |
| OpenSearch | SIEM — audit/log search + gateway analytics | — |
| Langfuse | LLM tracing + scores | Jaeger (if OTel Collector enabled) |
| Marquez | Data lineage (OpenLineage) | — |
| Presidio | PII detection | Falls back to regex detector |
| Superset | BI / embedded dashboards | Native charts (default) |
| FleetDM | MDM / device inventory | First-party device list |
| Qdrant | Vector store (server-scale) | `OFFGRID_ADAPTER_RETRIEVAL=qdrant` |
| LanceDB | Vector store (embedded, default) | `OFFGRID_ADAPTER_RETRIEVAL=lancedb` |
| Temporal | Durable workflow runtime | `OFFGRID_QUEUE_ENABLED=1` |
| Caddy | Edge proxy + LB | — |

---

## What is missing — the honest gap

**1. The module architecture (`defineOffgrid`) doesn't exist yet.**
The gateway CLAUDE.md describes it in detail. A config-driven composition root where each capability is a module with a manifest `{ id, nav, routes, settingsPanel, gatewayHooks }`. The console becomes the gateway with a fuller config. Today they are two separate apps. This is the architectural milestone that makes everything else compound.

**2. The intelligence layer (Brain → Soul) is passive.**
The Brain ingests and retrieves on demand. It never embeds events proactively. The audit log, Langfuse traces, Marquez lineage, and agent run history are rich with signal — none of it feeds back into a model that works on your behalf. The "Soul" (proactive context delivery to nodes) doesn't exist yet.

**3. Four shared packages are unconnected.**
`@offgrid/memory`, `@offgrid/sync`, `@offgrid/rag`, `@offgrid/pipeline` are complete and built. The console and desktop don't import them yet.

**4. The unified API gateway doesn't exist.**
`console-api.getoffgridai.co` is planned as the surface where all 14 service OpenAPI specs aggregate behind one Caddy vhost. 9 of 14 services already publish native OpenAPI specs. The console's own 140+ routes have no generated spec. Six things are missing before this URL works: tunnel ingress rule, Caddy site block, DNS record, routing decision, CORS headers, auth alignment.

**5. Prove It (Provit) is not yet a console module.**
Provit (`gungnir`, running at `:7799`) is a visual QA platform: it records user journeys, builds repo→feature→test maps, replays and judges them via the local LLM gateway. All of its data (repos, runs, sessions, screenshots, video frames) lives in flat JSON files on the Provit node. None of it is visible in the console. The integration (push API + SeaweedFS file storage + Prove It module) is Phase 2.

**6. No multi-tenancy.**
Every table is single-org. `org_id` doesn't exist on any table. Adding it later is a painful migration. Phase 3 adds `org_id` to all tables, Postgres RLS as a backstop, Keycloak org claims in the JWT, and SeaweedFS path namespacing. Multi-tenancy is the prerequisite for managed hosting.

**7. Known bugs to fix before scaling:**
- PII stateful regex bug — `/g` flag at module scope causes every other document to miss PII
- Gateway port split — defaults to `:8800` in config route, `:7878` everywhere else
- `/api/v1/gateway/tokens` — no admin auth check, any authenticated user can read/modify
- RAG in-process cosine similarity — loads entire corpus into Node.js memory, will OOM
- Two FinOps budget systems — neither enforces, no reconciliation between them
- No distributed tracing — every `emitSpan()` creates a fresh root span (no waterfall in Langfuse)

---

## The navigation (where we're going)

The current sidebar is a flat list. The target is **two-level AWS-style navigation**:

**Top level (home):** left nav shows all service names. Global search in the header finds services and sub-pages. This is the services directory — every Off Grid surface with live health.

**Inside a service:** left nav collapses to show only that service's sub-pages. The header retains global search + a breadcrumb back to home. This mirrors how AWS console works — you enter EC2 and the left nav becomes EC2-specific.

This change requires: a layout-level nav that reads the current module context, a two-state sidebar component (global mode vs. service mode), and a global search index built from the module registry + live health data.

---

## Phased plan

> Full detail in [`docs/ROADMAP.md`](docs/ROADMAP.md).

| Phase | Goal | Key milestone | Depends on |
|---|---|---|---|
| **0 — Foundation** | Fix 6 known bugs, freeze versions, kill dead containers | All bugs fixed, `npm ci` reproducible | — |
| **1 — Nav refactor** | Two-level AWS-style nav, global search | Service-scoped left nav, header search working | P0 |
| **2 — Prove It** | Provit integrated as a first-class module | Repos/runs/journeys/ledger visible in console | P1 |
| **3 — Multi-tenancy** | N orgs, fully isolated, from one deployment | Two orgs co-exist, RLS verified | P2 |
| **3A — Hardening & Scale** | HA, independent scaling, backup, DR | Single node failure < 5min RTO; nightly backup restorable | P3 (parallel w/ P4) |
| **4 — OSS parity** | Close every read-back gap — no service is a write-only sink | All 10 services two-way in the UI | P3 |
| **5 — Unified API** | `console-api.getoffgridai.co` — all specs behind one catalog | Swagger UI live, console spec generated | P3 (parallel w/ P4) |
| **6 — Module spine** | `defineOffgrid()` — gateway is the composition root | Add a module = add one config line | P4 |
| **7 — SDK + flywheel** | Third parties build modules; managed hosting ships | `@offgrid/sdk` on npm | P6 |
| **8 — Soul** | Intelligence layer — platform works for you, not just at you | `context_hints` in node policy-pull | desktop/mobile capture built |

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000

# Run only specific modules
NEXT_PUBLIC_OFFGRID_MODULES=fleet,gateway,control npm run dev
```

**Required env vars:** see `.env.example`. Minimum to run: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_KEYCLOAK_*`.

**Infrastructure:** see `deploy/docker-compose.yml` for the full service stack. Caddy edge config in `deploy/docker-compose.edge.yml`. Cloudflare tunnel config in `deploy/onprem/cloudflared-tunnel.yml`.

**Design system:** Off Grid brutalist — Menlo mono, single emerald accent (`#34D399` dark / `#059669` light), black/white, flat, no gradients. Tokens in `@offgrid/design`. Full guide: `mobile/docs/design/DESIGN_PHILOSOPHY_SYSTEM.md`.

---

## Layout

```
src/
  app/
    (console)/              # authed shell — all 22 module pages
      gateway/              # Gateway: overview, traffic, logs, control, tokens, settings
      fleet/                # Fleet: device list + detail
      brain/                # Brain: KB, prompts, docs
      control/              # Control: guardrails, audit, secrets
      observability/        # Observability: evals, traces
      analytics|finops|lineage|regulatory|reports|...
    api/v1/                 # Headless API — the "just the API" contract
      gateway/              # config/, tokens/
      admin/                # users, connectors, access
      devices/              # fleet API
      ...
  components/               # per-module UI components
  lib/                      # adapters, brain, rag, otel, siem, policy, finops...
  modules/registry.ts       # the module registry — 22 modules, 5 planes
  db/schema.ts              # Drizzle schema — all tables
```

---

*AGPL-3.0-only. © Off Grid AI / Wednesday Solutions, Inc.*
*Monorepo guide: `../CLAUDE.md`. Full roadmap: `../shared/ROADMAP.md`.*
