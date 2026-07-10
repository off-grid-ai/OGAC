# Docs accuracy audit — reconciling user-facing docs with what is actually built

Purpose: make every customer-facing claim (in-app `/docs`, README, landing) TRUE to the product,
framed as an outcome per `mission_vision.md`. This file is the reality baseline: what genuinely
exists and works, what is coming-soon, and every doc claim corrected.

Source of truth for "what is built": `src/app/(console)/**` routes + `src/modules/registry.ts` +
`src/lib/**`. Source of truth for framing: `mission_vision.md`.

Where the in-app docs live: **not** in `docs/*.md`. The `/docs` route renders markdown-in-TypeScript
from `src/lib/docs/*.ts` (9 section files: `introduction`, `concepts`, `pipelines-gateways`,
`guides-build`, `guides-govern`, `guides-operate`, `integrations`, `api`, `self-hosting`). Screenshots
are referenced from `public/docs-shots/*.png`.

Ground-truth route sweep: **46 routes audited, 45 live with real CRUD/data, 1 coming-soon
(Fleet device commands), 1 partial (Lineage full graph).** No placeholders pretending to be live.

---

## A. Feature-truth baseline — what ACTUALLY exists

Every module in `src/modules/registry.ts` maps to a real route under `src/app/(console)/`. Each is a
management surface (create/read/update/delete + actions), not a read-only dashboard, unless noted.

### Workspace — where people use AI

| Capability | Route | What it genuinely does |
|---|---|---|
| Chat | `/workspace/chat` | Governed chat: model picker, streaming, stop/retry/edit-branch, rate/copy, image models, attachments (image + txt/md/csv/pdf extraction), `/` skills palette, grounding on/off. Every turn is a governed run, logged to audit. |
| Projects | `/workspace/projects` | Group chats under shared instructions + a per-project knowledgebase; per-project pipeline binding. Real CRUD. |
| Artifacts | `/workspace/artifacts` | Library of generated outputs (HTML/SVG/React/diagrams/code); reopen, live-edit, ask-AI-to-change, version + revert. |
| Prompts | `/workspace/prompts` | Reusable, tagged prompt library + a "common prompts" view mined from real org usage. Save/search/delete. |
| Knowledge | `/workspace/knowledge` | Upload/index documents; permission-aware retrieval with `[Source: ...]` citations; create/list collections, add/remove/reindex. |
| Storage | `/workspace/storage` | On-prem object store; browse by folder, previews, upload/delete/share, public/private per file with S3-compatible URL. |

### Build — where AI apps and agents are made

| Capability | Route | What it genuinely does |
|---|---|---|
| Studio | `/build/studio` | The one build front door. Describe an assistant in plain language; suggested setup; pick skills + knowledge; try in sandbox; publish (just me / org / shareable link). Publishes a real governed agent + a template. Lists apps + agent roster; full CRUD. |
| Agents | `/build/agents` | Agent-centric lens: managed agent roster + single-step apps. Create/run grounded agents with governed tools; watch the full pipeline execute; re-run/cancel/send-to-review. Detail page `/build/agents/[id]`. |
| Apps | `/build/apps/[id]` | Per-app lifecycle shell: Build / Input / Runs / Review / Reports / Access / Controls / Schedule / Quality. Reference master→detail IA. |
| Agent runs | `/build/agent-runs` | Durable-execution history; open a run stage-by-stage (policy, guardrails, retrieval, answer, grounding, provenance) with timing + verdicts; re-run/cancel/delete/review. |
| Pipelines | `/build/pipelines/[id]` | The governed model-access contract. Detail tabs: Overview, Routing, Policy, Guardrails, Quality, Drift, Observability, Audit, Cost, API, Versions. Create/publish/version/delete; hard data ceiling; org-locked controls tighten-only. |
| Evals | `/build/evals` | Golden sets + eval/red-team runs; pass-rates by suite; apply evaluator → run → per-metric results; golden-case CRUD. |
| Sandbox | `/build/sandbox` | Code-execution backend status + recent runs; execution double-gated (feature flag + exec-capable backend), off by default; run code when enabled. |
| Tools | `/build/tools` | Registered HTTP/MCP tool registry (CRUD), curated MCP catalog (one-click add), built-in primitives with air-gap state. |

### Gateway

| Capability | Route | What it genuinely does |
|---|---|---|
| AI Gateway | `/gateway/ai` | OpenAI-compatible gateway: **model-serving nodes** (`GatewayNodesCard`), model catalog, routing, cache, live health probe. This is where model-node topology is actually surfaced live (the aggregator probes each node). Graceful placeholder if no gateway detected. |
| Gateways | `/gateway/registry` | Registry of model backends (on-prem cluster, OpenAI, Anthropic, OpenRouter) with egress class + live health merged from real probes; add/edit/disable. |
| Services | `/gateway/services` | Directory of every surface with live server-probed health; one login. |
| Edge | `/gateway/edge` | Public HTTP edge (Caddy reverse proxy) with rate limiting / abuse protection; live policy + blocked traffic; subdomain routing posture. |
| **Fleet (devices)** | `/gateway/fleet` | **COMING SOON** — see §B. Device inventory + health + policy version + audit events read back live; enrollment + device commands (lock/wipe/config push) are not yet live. |

### Data

| Capability | Route | What it genuinely does |
|---|---|---|
| Connectors / Integrations | `/data/connectors`, `/data/integrations` | Add connector (endpoint + auth), edit, test, sync, ingest history with real row/document counts, delete. Full configuration UI. |
| Data catalog | `/data/catalog` | Registry of datasets: source, owner, classification, PII flags, row count, freshness; list + detail. |
| Data domains | `/data/domains` | Declare where data lives; rule engine agents route by. Create/edit/delete. |
| Data governance | `/data/governance` | Per-dataset classification, retention/RTBF, freshness SLAs, broken-sync alerts. |
| Retrieval | `/data/retrieval` | Vector store: collections, counts, health, live query, reindex; permission-aware. |
| Tool catalog | `/data/tool-catalog` | Redirects to `/build/tools?tab=catalog`; curated OSS MCP servers, one-click add. |
| Lineage | `/data/lineage` | Source→answer lineage. **Real** — always reconstructs source→answer edges from each grounded run's citations. The full lineage-store graph shows "Coming soon" ONLY when no external lineage store is configured (edges still shown). See §B. |
| Warehouse / Query / ETL | `/data/warehouse`, `/data/query`, `/data/etl` | Warehouse table browse, query tool, ETL/ingest-job management. Deeper CRUD (source/destination creation, orchestrated transforms) is partial — README states this honestly. |

### Governance

| Capability | Route | What it genuinely does |
|---|---|---|
| Control | `/governance` | Egress leash (cloud on/off), routing rules (add/edit/enable/reorder + tester), policy editor, users, secrets, full-text audit search. |
| Policy | `/governance/policy` | Attribute-based rules, deny-by-default, create/edit/enable/delete with priority; first-party engine + optional external policy-as-code (with fallback); Rego module tab. |
| Guardrails | `/governance/guardrails` | Regex PII floor (always on) + entity-grade detection (when configured, degrades to floor); live test box; masking rules; custom recognizers; confidence thresholds. |
| Access | `/governance/access` | Users, roles, machine clients; SSO; realm admin (sessions, MFA, required actions, federation, lifetimes) written through to the identity provider. |
| Secrets | `/governance/secrets` | Vault: write/list/remove; values write-only (only key names listed back); seal/unseal; leases. |
| Provenance | `/governance/provenance` | Signed, tamper-evident answers/reports; verify + browse manifest; rotate signing key. |
| Regulatory | `/governance/regulatory` | Governance registry (attestations, reviews, RACI, DPIA) + framework-mapped (ISO 42001 / NIST AI RMF / EU AI Act), signed compliance exports. Item CRUD. |
| Trust Center | `/governance/trust` | CISO/procurement evidence surface: posture score, pillar rollup, regulatory mapping, artifact checklist + downloadable trust summary. |
| Teams | `/governance/teams` | Business units between org and pipeline; delegated pipeline access; team CRUD + membership. |
| Exporters | `/governance/exporters` | Push audit/lineage/cost to external SIEM/catalog/observability; create/edit/delete/test/run. |

### Insights

| Capability | Route | What it genuinely does |
|---|---|---|
| Observability | `/insights` | Agent-run traces + offline eval scores + drift + online LLM-as-judge; recent traces read back from the tracing store; pipeline facet; run evals / set thresholds. |
| Platform health | `/insights/platform` | Live metrics/logs/traces (request/error rate, latency, log search, distributed traces); URL-driven tabs. |
| Analytics | `/insights/analytics` | Volume, tokens, outcomes, latency percentiles from the traffic index; alerts; BI dashboards embed. |
| FinOps | `/insights/finops` | Virtual keys + monthly budgets (enforced before a call), cost by model/team/key, own-models dividend. |
| Accounting | `/insights/accounting` | Chargeback-grade cost by team/model/use-case over a range. |
| ROI | `/insights/roi` | Hours + ₹ saved per app/department vs. AI cost. Run counts + cost are measured; time-saved is an estimate you set. |
| Reports | `/insights/reports` | Create/run/export signed reports rendered live over real data (Markdown/PDF); template CRUD. |
| Audit | `/insights/audit` | Full accountability ledger; filter by actor/action/outcome; pagination + CSV/JSON export; run-id correlation. |
| Drift | `/insights/drift` | Per-feature drift + quality; baseline reset; alert thresholds; run tests. |
| Security events (SIEM) | `/insights/siem` | Security event stream with suppression rules + alerting monitors. |

### Operations

Admin (tenants, provisioning, ABAC), API docs & playground (live "try it" for safe GETs), Backups
(status/run/prune/restore), Config (edit every env setting, secrets masked, applied on restart),
Runs (all jobs across the platform), Messaging. All real management surfaces.

### Overview & product modules

Overview (`/overview`) — operator home, aggregated read-only with quick actions into every module.
Provit (`/provit`) — visual QA; runs on-prem at its own subdomain, brokered through console auth/
gateway/budgets; reachability shown inline; upload + showcase.

---

## B. Coming-soon / partial (must be framed honestly, never shown as fully live)

1. **Fleet — device/MDM (`/gateway/fleet`).** The ONLY module marked `comingSoon: true` in
   `registry.ts`. The page renders a "Coming soon" banner: device inventory + health + policy
   version + audit events read back live, but **enrollment and device commands (lock / wipe /
   configuration push) are coming soon** (`DeviceActions`, `EnrollDeviceButton` present but the
   command path is incomplete). README §"Device fleet" states this correctly (osquery / inventory /
   CVE / policies work via the OSS core; full MDM control is coming soon). `features/page.tsx` labels
   it "Fleet control (coming soon)" — correct.

2. **Lineage full graph (`/data/lineage`).** Lineage IS real: source→answer edges always render from
   each grounded run's citations. Only the *full lineage-store graph* shows a "Coming soon" state
   when no external lineage store is configured. Docs frame this correctly (fallback reconstruction).
   `lineage.png` is used and accurate — NOT a dead shot.

3. **Data-plane deeper CRUD.** Connector sync + job read-back work now; source/destination creation
   and orchestrated transforms are partial (README states this).

4. **Durable execution.** Workflow state is visible; durable execution is opt-in and being hardened;
   runs are synchronous by default (README states this).

---

## C. Doc claims corrected (in-app `/docs`, `src/lib/docs/*.ts`)

### Removed — "Brain" (no user-facing surface)

Confirmed by route sweep: there is **no Brain module/route**. "Brain" survives only as an internal
library (`src/lib/brain`) and admin API (`/api/v1/admin/brain/*`) whose capabilities are surfaced to
users as separate real modules (Knowledge, Retrieval, Tools, Data reindex). The docs still presented
a user-facing "Brain workbench." Corrected:

- **`guides-build.ts` — deleted the entire `guides/brain` page** ("Brain — the power-user
  workbench…" describing Documents / Retrieval / Grounding verifier / Tools / Router / Prompts as one
  surface). No such surface exists. Removed the `brain.png` reference with it.
  - Before: a `guides/brain` `DocPage` (slug `guides/brain`, ~20 lines of body).
  - After: page removed from the `buildSection` array.
- **`concepts.ts` — `concepts/modules`**, Intelligence group list:
  - Before: `- **Intelligence** - Agents, Agent runs, Brain, Evals, Sandbox.`
  - After: `- **Intelligence** - Agents, Agent runs, Evals, Sandbox.`

### Fleet — corrected the model-node vs. device-MDM conflation

The docs described "Fleet" as **model-serving-node topology** (register a node, assign a model,
enable/drain, roles, routing pool). That capability is real but it lives on the **AI Gateway**
(`/gateway/ai` — `GatewayNodesCard` / `GatewayModels`), NOT on `/gateway/fleet` (which is the
device/MDM surface, coming-soon). The docs also used `fleet.png` (the device screenshot) to
illustrate model-node management. Corrections:

- **`guides-operate.ts` — `guides/fleet`**: retitled and reframed to describe managing the
  model-serving nodes on the AI Gateway (live), removing the implication of a separate live "Fleet"
  console page for nodes. Screenshot `fleet.png` → `gateway.png` (the AI Gateway shot actually shows
  nodes).
  - Before (title / body): "Fleet" / "Fleet is how you run the hardware behind the platform…
    `![Fleet - nodes, their roles…](/docs-shots/fleet.png)`".
  - After (title / body): "Model nodes" / describes node roles + enable/drain on the AI Gateway,
    `![…](/docs-shots/gateway.png)`.
- **`self-hosting.ts` — `deployment` + `scaling`**: the "Add or drain nodes from the Fleet surface"
  links pointed at the device page. Repointed to the AI Gateway guide and swapped `fleet.png` →
  `gateway.png` in both pages.
  - Before: `Add or drain nodes from the [Fleet](/docs/guides/fleet) surface.` +
    `![Fleet - the nodes that serve your models…](/docs-shots/fleet.png)`.
  - After: `Add or drain nodes on the [AI Gateway](/docs/guides/gateway).` +
    `![…the nodes serving each model…](/docs-shots/gateway.png)`.
- **`introduction.ts` — `how-to`**: the "Add or drain a model node … in Fleet" item repointed to the
  AI Gateway guide.
  - Before: `Register it in [Fleet](/docs/guides/fleet), assign a model, enable it…`
  - After: `Register it on the [AI Gateway](/docs/guides/gateway), assign a model, enable it…`
- **`introduction.ts` — home ("What you get")**: "fleet management" phrasing left only where it reads
  as node/estate operation on the gateway, not as a live device-MDM claim (no wording change needed —
  it lists "fleet management" among console capabilities, which is honest for node management).

### Screenshot references — verified

Every other `docs-shots/*.png` reference resolves to a file that exists and matches its caption
(`overview`, `chat`, `knowledge`, `studio`, `control`, `pipelines-list`, `gateway`, `gateway-detail`,
`pipeline-*`, `guardrails`, `policy`, `access`, `secrets`, `provenance`, `regulatory`, `finops`,
`accounting`, `observability`, `audit`, `lineage`, `storage`, `data`, `connectors`, `integrations`,
`agents`, `app-runs`, `app-review`, `app-lifecycle`, `app-reports`, `prompts`, `evals`, `retrieval`).
`brain.png` is now unreferenced by docs (left on disk, not deleted). `fleet.png` references removed
from docs (still used by nothing now; the coming-soon Fleet device page uses no docs shot).

### OSS-engine-name exposure — flagged, not rewritten

`integrations/catalog` and `self-hosting/configuration` name OSS engines in user-facing copy
(Keycloak, Qdrant, OpenBao, Presidio, OPA, Langfuse, Marquez/OpenLineage, OpenSearch, Superset,
Unleash, FleetDM, Temporal, SeaweedFS, MinIO), against the brand rule "never expose OSS engine names."
These appear ONLY on the self-hosting / integrations pages, as "e.g." swap-in examples for an operator
choosing a backend — an engineering audience, and consistent across both pages by design. **Left
as-is** (out of scope for a truth audit), but flagged here for a future brand pass if the founder
wants these behind product terms.

---

## D. README

Structure/hero kept as crafted. Facts verified against reality + `mission_vision.md`; the
`data → gateway → pipelines → agents/apps → compliance` narrative matches. Corrections:

- **Node version drift**: the Node badge says ≥22; two prose lines said "Node 20+". The runtime is
  Node 22+ (server runs node22; `package.json`/badge say 22). Corrected the prose to "Node 22+".
  - Before (line ~37): `Needs Docker and Node 20+.`
  - After: `Needs Docker and Node 22+.`
- **Swap-in table — "Brain" label**: the `Vectors / RAG` row's "In the console" cell said
  "Brain, Knowledge". Brain is gone as a surface. Corrected to "Knowledge, Retrieval".
  - Before: `| Vectors / RAG | … | Brain, Knowledge |`
  - After: `| Vectors / RAG | … | Knowledge, Retrieval |`

The README's honest "caveat we will not hide" and "on the roadmap (not built yet)" sections already
match §B — no drift there. OSS engine names in the README swap-in table are appropriate here
(developer/contributor audience, not product copy).

---

## E. Landing (AUDIT ONLY — founder crafted the hero; code edits only for clear factual errors)

Files: `src/app/page.tsx`, `src/app/_landing/**`, `src/app/features/page.tsx`.

- **`features/page.tsx` — "Fleet control (coming soon)"** (~line 125): correctly labeled coming-soon,
  scoped to "full MDM control." Accurate. No change.
- **`features/page.tsx` — "Data lineage"** (~line 93): "queryable source → chunk → answer graph
  explains where any answer came from." Accurate — lineage is real (§B). No change.
- **`features/page.tsx` — edge/device sections** (~lines 153–163, 288, 421): describe an on-device /
  edge "copilot" and governing thousands of edge devices. Per `mission_vision.md` this is pillar 2
  (edge/on-device) and pillar 3 (org brain) — the **vision**, not what the Console ships today
  (pillar 1). They read as present-tense product capability. **Flag (no code edit — this is
  positioning of a roadmap tier, not a hard factual error in a shipped Console module):** consider
  framing these edge/device sections explicitly as the roadmap/vision tier so a CIO does not read
  on-device edge AI as a shipped Console feature. Deferred to the founder — the hero is theirs.
- **No landing claim asserts a coming-soon Console module as fully live** in a way that is a clear
  factual error. The one item worth the founder's eye is the edge/device positioning above.

Net landing code edits: **none** (the only flags are positioning, not hard errors).
</content>
