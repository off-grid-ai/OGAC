# Console information architecture ownership

Status: accepted and implemented on `codex/ia-restructure` (2026-07-17).

This is the durable contract for console navigation, canonical entity ownership, and compatibility
URLs. The executable sources of truth are:

- `src/modules/ownership.ts` — sections, canonical owners, routes, and commercial capability gates.
- `src/modules/groups.ts` — sidebar projection and active-route resolution.
- `src/modules/route-migrations.mjs` — old-to-canonical URL migration consumed by Next.js.

Do not add navigation directly in a page. Add or change the canonical owner once, then let the
sidebar and scoped section navigation derive from the registry.

## Top-level jobs

| Section | Job | Ownership rule |
| --- | --- | --- |
| Home | See attention, value, active work, and platform posture | Owns lenses and shortcuts only |
| Work | Use AI without platform knowledge | Owns conversations and human work objects |
| Solutions | Build and operate business use cases | App is the product center; Agent is an App kind |
| Data | Turn enterprise systems into governed context | Owns enterprise data resources, not vendor products |
| AI Runtime | Control available AI and governed access | Owns logical models and access contracts |
| Governance | Define, enforce, and prove controls | Owns global rules and evidence |
| Insights | Measure effectiveness, reliability, adoption, and economics | Owns measured results |
| Operations | Run the execution plane, fleet, services, and recovery | Owns runtime and infrastructure instances |

## Canonical owners

| Entity/result | Canonical route | Notes |
| --- | --- | --- |
| Conversation | `/work/chat` | Project context and knowledge references are lenses |
| Project | `/work/projects` | Owns its instructions, members, chats, and activity |
| Prompt | `/work/prompts` | Versions, partials, and assignments stay here |
| Artifact | `/work/artifacts` | Generated output and its provenance/share state |
| File | `/work/files` | Files and folders; not enterprise Knowledge |
| App / solution | `/solutions/apps` | Agents are filtered/specialized Apps, not a second registry |
| Review task | `/solutions/reviews` | App detail shows a scoped lens |
| Tool | `/solutions/tools` | HTTP, MCP, and built-ins have one catalog |
| Quality definition | `/solutions/quality` | Evaluators, golden sets, and gates |
| Source | `/data/sources` | Systems, connectors, credentials, and tests |
| Data domain | `/data/domains` | Business mappings, owners, policies, and SLAs |
| Data flow | `/data/flows` | Replication (Airbyte) and orchestration (Kestra) are explicit flow types |
| Warehouse resource | `/data/warehouse` | Tables, columns, queries, profiles, freshness |
| Catalog asset | `/data/catalog` | Ownership, classification, freshness, and impact |
| Knowledge collection | `/data/knowledge` | Collections, documents, indexes, permissions, bindings |
| Lineage edge/event | `/data/lineage` | Source-to-answer trace and impact |
| Logical model | `/runtime/models` | Physical machines never live here |
| Model gateway | `/runtime/gateways` | Endpoints, providers, egress class, availability |
| Model-access pipeline | `/runtime/pipelines` | Governed routing/access contract, not a data sync |
| API key/budget | `/runtime/api-budgets` | Spend results link to Insights Cost |
| Policy/control evidence | `/governance/*` | Global controls, assignments, and proof |
| Audit/security/provenance | `/governance/evidence` | Evidence is not general analytics |
| Outcome | `/insights/outcomes` | Business KPIs and ROI |
| AI behavior | `/insights/ai` | Traces, latency, errors, routing behavior |
| Usage | `/insights/usage` | Requests, tokens, users, apps, adoption |
| Quality result | `/insights/quality` | Eval runs, drift, scorecards, trends |
| Cost result | `/insights/cost` | Spend, attribution, unit cost, savings |
| Execution run | `/operations/runs` | Canonical for app, agent, and chat runs |
| Physical node | `/operations/nodes/[nodeId]` | Instance comes from the fleet registry |
| Compute cluster | `/operations/clusters/[clusterId]` | Derived from fleet registry relationships |
| Service | `/operations/services/[serviceId]` | Instance comes from the deployment registry |
| Platform telemetry | `/operations/health` | Infrastructure metrics, logs, traces, alerts |
| Managed employee device | `/operations/devices/[id]` | Separate from physical serving nodes; currently marked Soon |
| Configuration | `/operations/configuration` | Adapters, flags, auth, and environment references |

## Collision decisions

- “Fleet” is not a canonical entity name. Physical compute is **Nodes/Clusters**; employee endpoints
  are **Managed devices**.
- “Pipeline” means a governed model-access contract under AI Runtime. Data movement is **Flows**.
- Agent execution does not own a second run store or run navigation home. All execution details use
  Operations Runs; app and agent views link/filter it.
- App/pipeline tabs may summarize assigned policy, guardrails, audit, cost, or quality, but the global
  entity stays under Governance or Insights.
- Platform telemetry is operational health. LLM/application behavior and business outcomes remain
  Insights.
- Vendor engines and OSS service names are implementation metadata. Product navigation names the
  capability; Operations Services exposes service health and placement.

## Dynamic-resource rule

Routes identify a resource type, never a known deployment instance. Node and cluster lists fetch
the existing fleet registry; cluster membership is derived by `deriveClusters`. Service pages use
the deployment service registry. Adding/removing a deployment instance must not require a route or
navigation change.

Required resource routes:

- `/operations/nodes` and `/operations/nodes/[nodeId]`
- `/operations/clusters` and `/operations/clusters/[clusterId]`
- `/operations/services` and `/operations/services/[serviceId]`

## Migration behavior

Old flat paths and the previous `/workspace`, `/build`, `/gateway`, and `/insights` hierarchy receive
permanent redirects to canonical owners. Wildcard rules preserve resource ids and child tabs. The
mapping intentionally resolves directly to the latest route to avoid redirect chains. Query strings
are retained by Next.js.

Representative migrations:

| Old | Canonical |
| --- | --- |
| `/workspace/chat/:path*` | `/work/chat/:path*` |
| `/build/apps/:path*` | `/solutions/apps/:path*` |
| `/build/agents/:path*` | `/solutions/apps/:path*` |
| `/build/agent-runs/:path*` | `/operations/runs/:path*` |
| `/build/pipelines/:path*` | `/runtime/pipelines/:path*` |
| `/data/pipelines/:path*` | `/data/flows/replication/:path*` |
| `/data/etl/:path*` | `/data/flows/orchestration/:path*` |
| `/gateway/services/:path*` | `/operations/services/:path*` |
| `/gateway/fleet/:path*` | `/operations/devices/:path*` |
| `/insights/platform/:path*` | `/operations/health/:path*` |
| `/insights/audit/:path*` | `/governance/evidence/audit/:path*` |
| `/insights/siem/:path*` | `/governance/evidence/security/:path*` |
| `/insights/roi/:path*` | `/insights/outcomes/:path*` |

## Deliberate follow-up work

- Solution templates remain a proposed product entity and are not in navigation until a real
  template/spec lifecycle exists.
- The Data Flows landing groups the real Airbyte and Kestra lifecycles without pretending they share
  one persistence model. A unified facade can follow when the domain contract is defined.
- Page implementations are wrapped and reused to prevent parallel stores/business logic. Their
  headings, breadcrumbs, internal action links, and service-specific terminology can be migrated
  incrementally; compatibility redirects keep those links functional meanwhile.
- Managed Devices remains explicitly incomplete until its full CRUD/control lifecycle meets the
  console engineering standard.
