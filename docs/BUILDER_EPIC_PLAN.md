# Off Grid Console — Unified Builder Epic: Implementation Plan

## North star — WHO this is for (the acceptance bar for ALL builder work)

The user is a **non-technical department person — taxation, accounting, HR, ops** — who has never
written code. They describe a chunk of their job in plain language ("reimbursement approval: read the
invoice, check the employee's quota, decide eligibility, have a manager approve") and get back a
**real, governed, running workflow** that makes them better at their job or frees their time. That's
the entire point of this product.

Consequences that are NON-NEGOTIABLE for every builder change:
- **Usability is the acceptance test.** If that non-technical person can't build AND run the app
  without help, the work is not done — no matter how powerful the internals. "Powerful but baffling"
  (e.g. a raw node canvas as the front door) is a FAILURE. The default flow must *walk* them:
  describe → see the steps → unresolved bits become obvious "wire this" buttons → name inputs → run.
  The visual canvas is an advanced escape hatch, never the front door.
- **An app is the one unit.** An agent is the simplest app (one step). Apps are **composable** — a
  built app can be a *tool* inside another app, alongside primitives (web_search, read_url, http).
- **Every app inherits the same lifecycle as its OWN structure:** Build → Input → Run (live
  monitoring) → Review (human-in-the-loop) → Reports. Opening an app gives it its own tabbed surface
  scoped to that app — not global console areas.
- **One surface: Studio.** No Agents-vs-Studio split.
- Everything the app does is governed automatically (policy, guardrails, routing, grounding,
  provenance) and inherits the org's connectors/data-domains/tools/Brain — the builder never starts
  from zero.



Architecture + phased, worktree-isolated decomposition for tasks #101–#108. Execute phase by phase;
each parallel agent owns a DISJOINT file-set. Read before launching any epic agent.

## 0. Executive summary

Two disconnected "build" surfaces exist today:
1. **Studio wizard** (`StudioBuilder.tsx` + `lib/studio-builder.ts`) — 4-step wizard; on publish POSTs to
   `/admin/agents` (a `customAgent` row) + `/studio/templates` (a `studioTemplate` whose `workflow` is a
   single `agent:<id>` node). Works end-to-end today.
2. **StudioCanvas** (React-Flow) + `/admin/compose` — NL→graph "advanced builder." The graph is
   **decorative**: `runApp` (`StudioCanvas.tsx:303`) extracts the ONE agent node → `/admin/run` →
   `runAgent`. Connector/Data/Guardrail/Tool nodes + edges are never executed. Multi-step is an illusion.

Both feed the governed single-agent pipeline `runAgent()` (`agentrun.ts:298`):
`policy → plan → guardrails(pre) → budget → retrieve(router) → answer → ground → guardrails(post) → sign
→ persist → fan-out`. Single-shot. The Brain router (`retrieval/router.ts`) fans to fixed sources
(`kb`,`database`,`tool` — `sources.ts`); the DB source token-matches dataset METADATA, never queries a
live connector by rule.

**Gap concentrates in four places:** no multi-step run (no graph orchestrator); no connector rule engine
(canvas connector nodes inert); triggers stubbed (only cron, single-agent); HITL shallow (a boolean
`requireReview` holds the FINAL answer `pending_review` — cannot pause mid-workflow).

**Reusable substrate already in place:** Temporal durable exec (`worker/agent-run.workflow.ts`), the
governed pipeline, signed provenance, `/app/[slug]`, tool action-policy (`allow|approval|blocked`),
pure-policy-module + I/O-adapter convention. The epic is mostly composition on existing seams + one new
subsystem (connector rule engine) + one new runtime (multi-step executor).

## 1. What exists today (cited)
- **`AgentDef`** (`agents.ts:9-28`,`resolveAgent` :131): built-ins + `customAgents`; fields tools/grounded/trigger/systemPrompt/model.
- **`studioTemplates`** (`schema.ts:652`): `{ownerId,title,prompt,workflow:jsonb,visibility,slug,published}`; `Workflow`=`{title,summary,nodeIds[],edges[]}` — closest to a unified "app" but inert.
- A Studio assistant today = a `customAgent` + a `studioTemplate` pointing at it (`studio-builder.ts:259-291`).
- **`runAgent`** (`agentrun.ts:298`) canonical pipeline; every branch persists `agentRuns` (`schema.ts:195`) + fans to lineage/audit/trace (:478-509).
- **Durable**: `durableEnabled()` (`agent-run-durable.ts:61`) → `AgentRunWorkflow` (`worker/agent-run.workflow.ts:34`) → activity reuses `runAgent`.
- **Schedules**: `temporal-schedules.ts` — cron fires the same workflow (the one live non-on-demand trigger).
- **HITL**: `requireReview` → `pending_review` (`agentrun.ts:472`); released via review routes; pure state in `agent-run-actions.ts`.
- **Router**: `route()` (`router.ts:52`); `databaseSource` (`sources.ts:38`) searches dataset metadata only; `toolSource` (:62) token-matches tools.
- **Connectors**: `Connector` (`store.ts:542`); `syncConnector` (:721) + `realRecordCount` (:581) = LIVE Postgres/MySQL/MSSQL/REST connectivity ALREADY EXISTS. `data-sources.yml` seeds real corebank/policyadmin/erp/crm/minio.
- **Tools**: `{type:http|mcp|sandbox, endpoint, enabled, policy}` (`store.ts:1216`).
- **Builders**: `introspect()` (`studio.ts:56`) → `Catalog`; `/admin/compose` → `Workflow`; `StudioCanvas.runApp` runs only the one agent node.

## 2. Gap per workstream

| # | Workstream | Today | Gap |
|---|---|---|---|
| #108 | Unify agents+Studio | separate rows; graph inert | ONE "app" entity spanning simple-agent→multi-step |
| #106 | NL→governed multi-step | compose emits inert graph; 1 agent runs | NL→executable step graph + multi-step executor |
| #107 | Connectors as rule engine | metadata match; nodes inert | data-domain→source binding + resolver |
| #102 | Org inheritance | wizard resolves org tools/models | extend to connectors/guardrails/policy/routing/Brain automatically |
| #105 | Canvas works | read-only tint | editable nodes, per-node config, save→executable, run→executor |
| #103 | Triggers | only cron (single agent) | trigger registry + on-prem adapters; real webhook |
| #104 | HITL/reports/forms | final-answer hold only | mid-workflow pause/resume, input forms, report sink |
| #101 | Full-screen guided | wizard → single agent | describe a PROCESS full-screen |

## 3. Target architecture

### 3.1 Unified "App" entity (#108)
New `lib/app-model.ts` (pure) + `apps` table. `AppSpec { id,orgId,ownerId,title,summary,visibility,slug,
published, trigger:TriggerSpec, inputForm?:FormField[], steps:AppStep[], edges:{from,to,when?}[] }`.
`AppStep` = agent | connector-query(binding:DataDomain) | guardrail | human(formSchema?) | output(sink).
**An "agent" = an AppSpec with one agent step.** Additive migration: keep customAgents+studioTemplates; new
`apps` table; a shim maps existing `studioTemplate.workflow` → 1-step AppSpec so `/app/[slug]` keeps working.

### 3.2 Connector rule engine (#107)
`lib/data-domains.ts` (pure): `DataDomain{id,label,aliases[],connectorId,resource,op-hints}` +
`resolveDomain(phrase)`. New `data_domains` table + `lib/data-domains-store.ts` (SEPARATE from store.ts).
`lib/adapters/connector-query.ts` runs a READ against the bound connector — reuse the live-query code from
`store.ts:581` (extract to shared `lib/connector-exec.ts` first). New 4th router source `connectorSource`.
The connector-query STEP calls the resolver directly (rule, not guess).

### 3.3 Multi-step executor (#106 runtime, #105 surface)
`lib/app-run-plan.ts` (pure topo/step-validity) + `lib/app-run.ts` orchestrator: agent step → `runAgent`
verbatim (each step independently governed); connector-query → connector-exec; human → PAUSE (durable,
Temporal signals/`condition()`); output → console/report(reuse `pdf.ts`+`reports.ts`)/email/whatsapp.
Each step persists a child run; app-run aggregates + signs like a single agent. **Durable required** for
multi-step+HITL: new `worker/app-run.workflow.ts` + activities, `lib/app-run-durable.ts`, `adapters/apprun.ts`.

### 3.4 Triggers (#103) — on-prem-safe
`lib/triggers.ts` (pure) + `lib/adapters/triggers/*`. Each trigger submits an app-run (same governed entry
point). webhook: real `POST /api/v1/app/<slug>/run`. schedule: generalize to fire `AppRunWorkflow`. email:
on-prem IMAP/SMTP poller (no cloud). whatsapp: interface + on-prem gateway only, disabled without config.

### 3.5 Org inheritance (#102)
`lib/org-context.ts` assembles connectors/data-domains/tools/guardrails/policy/routing/models/Brain once;
builder + executor read it. Agent-step inheritance is already free (runAgent pulls from adapters); new work
is connector-query steps + builder catalog defaulting to org bindings.

## 4. Phased plan (disjoint file-sets)

**Rule:** new subsystems = new files (never edit `store.ts`/`schema.ts` in parallel). All schema edits in
Phase 0 (solo). `retrieval/sources.ts` (one shared append) owned solely by 1B.

### Phase 0 — Schema + shared extraction (SOLO, blocks all)
Owns `src/db/schema.ts` (add `apps`,`appRuns`,`dataDomains`), migration, extract `store.ts:581` live-query
→ new `src/lib/connector-exec.ts` (thin re-export left in store.ts). Verify: drizzle generate + typecheck +
`connectors-crud.integration.test.ts` green.

### Phase 1 — Foundation (3 parallel, depend on Phase 0)
- **1A Unified App model** — owns `lib/app-model.ts`, `lib/apps-store.ts`, `test/app-model.test.ts`.
- **1B Connector rule engine** — owns `lib/data-domains.ts`, `lib/data-domains-store.ts`,
  `lib/adapters/connector-query.ts`, `lib/retrieval/connector-source.ts`, `lib/retrieval/sources.ts`,
  `test/data-domains.test.ts`.
- **1C Org context assembler** — owns `lib/org-context.ts`, `test/org-context.test.ts`.

### Phase 2 — Executor + compile (2–3 parallel, depend on P1)
- **2A Multi-step executor** — `lib/app-run-plan.ts`, `lib/app-run.ts`, `lib/app-run-durable.ts`, test.
- **2B Durable workflow + trigger substrate** — `worker/app-run.workflow.ts`+`.activities.ts`,
  `adapters/apprun.ts`, `lib/triggers.ts`, new `lib/app-schedules.ts` (wrap, don't edit temporal-schedules).
- **2C NL→AppSpec compiler** — `lib/app-compile.ts`, new `api/v1/admin/apps/compile/route.ts` (leave legacy
  `/admin/compose` intact until P3).

### Phase 3 — Builder + canvas (2 parallel, depend on P2)
- **3A Full-screen guided builder** — new `(build)/studio/new/*` `AppBuilder.tsx`, `api/v1/admin/apps` routes.
- **3B Working canvas** — `StudioCanvas.tsx`, `StudioBuilder.tsx`, `lib/studio.ts`, migrate `/admin/compose`.

### Phase 4 — HITL/forms/reports/triggers (2–3 parallel)
- **4A HITL + forms** — mid-workflow review UI, `lib/app-forms.ts`, new step-review route.
- **4B Report output** — `lib/adapters/sinks/report.ts` (wrap pdf.ts+reports.ts).
- **4C On-prem trigger adapters** — `adapters/triggers/{webhook,email-imap,whatsapp-onprem}.ts` + real
  `api/v1/app/[slug]/run/route.ts`.

## 5. Risks / on-prem constraints
1. **Mid-workflow HITL on Temporal** (highest risk) — new wait-state via signals/`condition()`; prototype in 2B first.
2. **Connector rule engine correctness** — deterministic + audited; a wrong binding silently reads the wrong system.
3. **store.ts/schema.ts collision** — mitigated: Phase 0 solo owns them; everything else is new files.
4. **Air-gap triggers** — email = on-prem IMAP poller (no cloud); whatsapp = on-prem gateway only, disabled
   without config; webhook (inbound) safest first. All payloads enter the same governed app-run path.
5. **Compiler honesty** — never fabricate a connector/domain; unbindable steps surfaced as gaps, not faked.

## 6. Phase 1 recommendation
Phase 0 solo (schema + connector-exec). Then **Phase 1 = 1A + 1B + 1C in parallel** — fully disjoint, none
touch store.ts/schema.ts, together landing the unified entity + connector rule engine the vision hinges on.

## 7. Canonical builder UX flow (founder spec) — the 5 screens

The builder-to-operate lifecycle. The AppSpec (§3.1) is the state carried across all five; the multi-step
executor (§3.3) + durable workflow (§3.3) power screens 3–4; triggers (§3.4) can start at screen 2.

1. **BUILD** — you describe the app in plain language → the NL compiler (`app-compile.ts`, §3.3/2C) carves a
   **skeleton node graph** (AppSpec.steps) → you refine it **dual-mode: visually on the canvas AND via text**
   (both edit the same AppSpec — the canvas nodes ARE the steps, no more decorative graph) → you OK it → it
   "wires up" (validates the graph, resolves data-domain bindings, confirms org inheritance). Screen 3B (canvas)
   + 3A (guided builder) are two entries into this same edit surface.
2. **INPUT** — a generated screen to enter run inputs (from `AppSpec.inputForm`, §3.1/4A forms) / pick the
   trigger. Hitting Run submits a governed app-run (same entry point as any trigger).
3. **RUNNING** — a live monitoring/status screen: each step's state streams (queued→running→done/failed),
   shows retrieval hits, connector-query results, guardrail verdicts — driven by the app-run's per-step status
   in the `appRuns` row + durable workflow events. This is the "watch it work" screen.
4. **REVIEW (human-in-the-loop)** — when a `human` step pauses the run (§3.3, durable signal), this screen
   surfaces the pending decision with context (the step output + sources) → approve / reject / edit → resumes
   the workflow. Reuses + extends the existing review-route pattern (per-step, not just final-answer).
5. **REPORTS / ANALYTICS** — outcomes over time: runs, approvals, exceptions, throughput, cost/tokens (reuse
   the FinOps/audit/lineage surfaces) + the `output:report` sink (§3.3, 4B) for generated reports.

**Sequencing impact:** screens 1–2 are Phase 3 (builder + canvas + input form). Screen 3 (live status) rides on
Phase 2's executor/durable events — build a status-stream view as part of Phase 3B or an early Phase 4 item.
Screens 4–5 are Phase 4 (HITL surface + reports). The AppSpec + appRuns schema (Phase 0) must carry everything
these screens render (per-step status, awaiting-human, inputs, outputs) — already reflected in the Phase 0 brief.
