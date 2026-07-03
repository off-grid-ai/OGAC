# Off Grid Console — Phased Roadmap

> From ops dashboard to the control plane for the AI age.

This document is the authoritative phase plan. Each phase has a clear goal, a definition of done, and the critical decisions that unlock the next phase. Phases within a tier can overlap; a later tier cannot start until its predecessor's critical path item is complete.

---

## The north star

A developer or an org admin sits down at the console and sees every AI service they run — modelled, governed, and composable — in one surface. They can add a capability with one config line. They can swap a backend with one env var. Every test result, every agent run, every policy decision, every budget breach, every PII hit, every recorded user journey is visible, searchable, and traceable. The platform gets smarter over time because everything that flows through it feeds back into the intelligence layer. And all of this runs on their hardware, under their governance, with no SaaS dependency.

---

## Phase 0 — Fix the foundation
**Goal:** stop the bleeding. Nothing compounds on broken primitives.
**Timeline:** 1–2 weeks. Do this before touching anything else.

### Critical bugs (all must be fixed)

| Bug | File | Impact |
|---|---|---|
| PII stateful regex (`/g` at module scope) | `src/lib/adapters/pii.ts` | Every other document silently misses PII |
| Gateway port split (`:8800` vs `:7878`) | `src/app/api/v1/gateway/config/route.ts` | Silent traffic split when env var unset |
| `/gateway/tokens` — no admin auth check | `src/app/api/v1/gateway/tokens/route.ts` | Any authenticated user can read/modify tokens |
| RAG in-process cosine similarity | `src/lib/rag.ts` | Will OOM on any real corpus |
| Two FinOps budget systems, neither enforces | `src/db/schema.ts`, `src/lib/finops.ts` | Budget alerts fire; inference never stops |
| `emitSpan()` creates fresh root span every call | `src/lib/otel.ts` | Langfuse shows thousands of disconnected traces |

### Version freeze
- Pin Langfuse (35 versions behind), Keycloak + OpenBao (security patches), MinIO (7 months behind)
- Lock `next-auth` to exact version (currently floating beta `^5.0.0-beta.31`)
- Lock `@lancedb/lancedb` and `c2pa-node` (v0.x with `^` — breaking changes permitted by semver)
- Commit lockfile; all installs switch to `npm ci`

### Container cleanup
Turn off: VictoriaMetrics, VictoriaLogs, OTel Collector, Jaeger, SeaweedFS — zero callers in `src/`. Reclaim RAM on S2.

One-time setup: run `superset init` and `fleetctl setup` so both show real data.

**Definition of done:** all 6 bugs fixed, versions pinned, dead containers off, Superset and FleetDM showing live data.

---

## Phase 1 — Navigation refactor (AWS-style shell)
**Goal:** a navigation system that scales to 22+ modules without becoming unusable.
**Timeline:** 2–3 weeks. Pure UI — no backend changes.
**Depends on:** Phase 0 complete.

### What changes

**Today:** a flat sidebar with every module listed. No hierarchy. No search. Falls apart past ~10 items.

**Target:** two-level navigation, exactly like AWS console.

**Home / service directory view:**
- Left nav lists all service groups (Productivity, Infrastructure, Intelligence, Observability, Governance)
- Each group is collapsible, showing the modules inside
- Global search in the header — finds modules, sub-pages, and live service health results
- The current page is `/services` — this becomes the home page

**Inside a module:**
- Left nav collapses to show only that module's sub-pages (tabs become nav items)
- Breadcrumb in the header: `Off Grid > Gateway > Traffic`
- Global search stays in the header at all times
- "Back to all services" link at the top of the scoped nav

### Technical shape
- New `<AppShell>` layout component with two states: `global` (all modules) and `scoped` (current module's sub-pages)
- Module registry (`src/modules/registry.ts`) gains a `children` field per module — the sub-pages
- Global search index built from: module registry + live health data + Postgres full-text search
- Gateway tabs (`overview / traffic / logs / control / tokens / settings`) become nav items, not tab components — this applies to every module with sub-pages

**Definition of done:** two-level nav working, global search finding modules and sub-pages, every module with sub-pages using nav-item layout instead of tabs.

---

## Phase 2 — Prove It (Provit integration)
**Goal:** Provit becomes a first-class module in the console. Every repo, every feature map, every test run, every recorded journey is visible and searchable in the same surface as the rest of the platform.
**Timeline:** 4–6 weeks.
**Depends on:** Phase 1 (nav) so the module slots in cleanly.

### What Provit is

Provit (running as `gungnir` on the fleet at `:7799`) is a visual QA platform. It:
- Indexes repos → builds a feature plan (feature → test cases → code markers)
- Records user journeys (screenshots, video frames, accessibility timelines)
- Replays journeys and judges pass/fail via an LLM vision model (your gateway)
- Maintains a `Ledger` — a durable tape mapping every user-facing behavior to the tests that guard it
- Produces run results (passed / failed / skipped-manual / no-tests) per behavior

Today all of this data lives in flat JSON files on the Provit node (`./data/repos/`, `./recordings/`). None of it is visible in the console, searchable, or correlated with agent runs or deployments.

### The integration shape

**A. Provit pushes to the console**

Add a push API to the console that Provit calls after each operation:

| Provit event | Console endpoint | What it writes |
|---|---|---|
| Repo indexed | `POST /api/v1/provit/repos` | Repo record + feature plan |
| Test run complete | `POST /api/v1/provit/runs` | Run result per behavior (pass/fail/duration) |
| Session recorded | `POST /api/v1/provit/sessions` | Session plan + journey metadata |
| Recording captured | `POST /api/v1/provit/recordings` | File upload (frames, video, timeline JSON) |

Auth: Provit authenticates with a machine client token (the gateway token system already exists — use it).

**B. File storage for recordings**

Provit captures: video frames (JPEG/PNG), full recordings (MP4/MOV), accessibility timeline JSON, bug-note annotations.

Storage path: activate SeaweedFS (already in compose, currently off) as the object store for Provit recordings. Every file upload to `/api/v1/provit/recordings` streams to SeaweedFS, stores the object key in Postgres. SeaweedFS is the right call here — it's S3-compatible, already in the compose, and recordings are large binary blobs that don't belong in Postgres.

Schema additions:
```
provit_repos       — repo records + feature plans (JSONB)
provit_runs        — one row per behavior per run (status, duration, failures)
provit_sessions    — session metadata + journey plan
provit_recordings  — file metadata (seaweedfs key, mime, size, sha256)
provit_behaviors   — the ledger (behavior → tests → code markers)
```

**C. The Prove It module in the console**

New module: `prove-it` (route `/prove-it`). Sub-pages (nav items):

- **Repos** — directory of all indexed repos with feature count, test case count, last run status
- **Features** — drill into a repo: the full feature map (feature → behaviors → test files)
- **Runs** — timeline of all test runs, filterable by repo / status / date. Click a run → per-behavior breakdown with pass/fail, duration, failed test titles
- **Journeys** — the recorded sessions: the video player, the frame-by-frame timeline, the LLM judge verdict for each step
- **Ledger** — the durable behavior tape: every user-facing behavior, the tests that guard it, the code markers that prove the fix is still present, whether it needs manual verification

**D. Correlation with the rest of the platform**

This is the payoff. Because everything goes through Postgres:
- A failed test run on the same day as a gateway config change → link them in the Lineage view
- A Provit recording of a broken UI → attach it to the agent run that generated the broken output
- Provit's code marker check failing → surface in the Control audit log

### Multi-tenancy note
All Provit tables get `org_id` from day one (see Phase 3). Provit's machine client token carries the org claim. Don't build it single-tenant and migrate later.

**Definition of done:** Provit pushes repos, runs, sessions, recordings to the console. The Prove It module shows all four views with live data. Recordings play back in the journey viewer. SeaweedFS stores all binary assets.

### D. Provit as the console's own E2E screenshot tester (TODO — evaluated, not built)

Use Provit to run full end-to-end **screenshot functional tests of the console itself** (sign in → navigate modules → act → assert + screenshot each step → surface results). Evaluated 2026-07 (read-only); Provit is ~70% there — it already has a Playwright driver (`adapters/capture.mjs`), a VLM oracle that judges a plain-English expectation against a screenshot (`src/core/oracle.ts`), a dashboard (`:7799`), and the console file-upload path (`showcase.ts` → `/api/v1/files`). **These changes live in the Provit repo, not the console.** Additive, low-risk, ~days for a working proof:

1. **Web `observe`/assert step + `replayJourneyWeb.ts`** (mirror the proven iOS `src/ios/replayJourney.ts`): screenshot at checkpoints, call `oracle.judge`. *#1 gap — without it you get a recording, no pass/fail.* [M]
2. **Keycloak login handling**: save a Playwright `storageState` from a one-time sign-in, reuse it; creds from env (`PROVIT_CONSOLE_USER/PASS`). [M]
3. **A `web` config block** in `ProvitConfig` (`baseUrl`, viewport, headless, storageStatePath). [S]
4. **Emit `timeline.jsonl` from the web capture** so the existing dashboard/judge/replay work for web unchanged. [M]
5. Later: `--headless` + CI hook; DOM self-heal; author console journeys (`journeys/console/*.json`); surface runs via `/api/v1/files` gallery → Observability.

Sequence 1→2→3→4. Console flows authored as journey JSON (`launch web → signin → click/type → observe "X visible"`). Full eval in the session record.

---

## Phase 3 — Multi-tenancy
**Goal:** the console serves multiple orgs from one deployment. Each org's data is completely isolated. This is the prerequisite for offering managed hosting.
**Timeline:** 6–8 weeks. This is deep schema and auth work.
**Depends on:** Phase 2 (all tables must have `org_id` before multi-tenancy can be enforced).

### The multi-tenancy model

**Org model:** one Keycloak realm per deployment (not per org). Each user's JWT carries an `org_id` claim (a Keycloak group → org mapping). The console reads `org_id` from the session token on every request.

**Data isolation:** every table gets `org_id text NOT NULL`. Drizzle query helpers wrap every query with an automatic `WHERE org_id = $current_org` filter — a single seam, enforced in one place, not in every route. Postgres row-level security (RLS) as a defense-in-depth backstop.

**File isolation:** SeaweedFS paths are namespaced: `/{org_id}/provit/recordings/{file}`. Presigned URL generation always scopes to the requesting org.

**Gateway isolation:** the gateway's `TokenStore` is already keyed by token; add org scope. OPA policies receive `org_id` in the input — policies can be org-scoped.

### What changes

**Schema:** every table currently without `org_id` gets it. Migration order matters:
1. `organizations` table (new) — org record, name, plan tier, created_at
2. Add `org_id` to all existing tables with a backfill default (`'default'` for single-tenant installs)
3. Create Drizzle query wrapper `withOrg(db, orgId)` that applies the filter
4. Switch every route handler to use `withOrg` instead of raw `db`
5. Enable Postgres RLS as a backstop

**Auth:** `requireModuleForUser` gains an org-aware version. The session token must carry `org_id` — add the Keycloak mapper to the token claim.

**Provisioning:** new Admin route `POST /api/v1/admin/orgs` creates an org + seeds the default modules + creates the Keycloak group. The existing `admin` module gets an Orgs tab.

**Self-serve path (later):** an org admin can invite members, assign roles, set budgets — all within their org scope. The console's Access module already has users + roles; scope them to org.

### Managed hosting readiness

Once multi-tenancy is working:
- A deployment can serve N orgs from one instance
- Each org has its own data, its own gateway config, its own Provit repos, its own budgets
- The `organizations.plan_tier` column gates Pro features (connector libraries, ETL, fleet orchestration)
- Billing hooks on `organizations` — usage is already in FinOps per user; aggregate to org

**Definition of done:** two orgs in one deployment, data completely isolated, one org cannot see another's data even with a valid session token. RLS verified with a penetration test (use OPA + Postgres RLS together).

---

## Phase 3A — Hardening & Scale
**Goal:** every service scales independently, survives node failure, recovers from disaster. This is the infrastructure prerequisite for managed hosting and for selling the platform to orgs with uptime SLAs.
**Timeline:** 6–8 weeks. Runs in parallel with Phase 4 (different skill set — infra vs. UI/API).
**Depends on:** Phase 3 (multi-tenancy schema must be stable before designing backup strategies around it).

### The problem with the current setup

Today the stack is split manually across two nodes: S1 holds the heavy stateful services (Postgres, Keycloak, OpenSearch, Qdrant, Marquez, Temporal, OPA, OpenBao), S2 holds the worker/analytics tier (Langfuse, Superset, FleetDM, Presidio, Unleash, Redis). This is a static partition — if S1 goes down, auth, the database, and search all go with it. There are no replica sets, no automated failover, no backup schedule, no documented recovery procedure.

### Track 1 — Container orchestration (independent scaling)

Move from bare `docker-compose` to an orchestrator that can schedule, scale, and restart containers independently per service. The right choice for an on-prem two-node fleet is **Nomad** (HashiCorp, AGPL) or **k3s** (lightweight Kubernetes). Both support:
- Per-job resource limits and scaling policies
- Health-check-driven restarts
- Cross-node scheduling (a service doesn't have to live on a fixed node)
- Rolling deploys with zero downtime

**Recommended: Nomad.** Simpler operational model than k3s for a two-node fleet; native HCL job specs are easier to read than Kubernetes YAML; integrates natively with OpenBao (Vault protocol) for secret injection; already in the HashiStack alongside what we run.

Migration path: each `docker-compose` service becomes a Nomad job spec. The compose files stay as the dev/local reference; Nomad is the production scheduler. No code changes — all services are already containerised.

Per-service scaling policy (steady state):

| Service | Scaling model | Min replicas | Notes |
|---|---|---|---|
| Postgres | Active-passive (Patroni) | 2 | Primary + standby; auto-failover via etcd |
| Keycloak | Active-active | 2 | Infinispan distributed cache; both nodes serve login |
| OpenSearch | Clustered | 3 (1 primary + 2 replica) | Already supports clustering; enable shard replication |
| Qdrant | Distributed | 2 | Qdrant supports sharding + replication natively |
| Redis | Sentinel | 3 (1 primary + 2 sentinel) | Sentinel handles failover; Cluster if write throughput demands it |
| OPA | Stateless, horizontal | 2 | No shared state; round-robin behind Caddy |
| Presidio | Stateless, horizontal | 2 | Analyzer and anonymizer scale independently |
| Langfuse | Stateless workers | 2 | Worker pool; Langfuse DB is separate Postgres |
| Unleash | Stateless, horizontal | 2 | Unleash DB is separate Postgres |
| Gateway cluster | Active-active | 3 | Already has a cluster router; add a third node |
| Console (Next.js) | Stateless, horizontal | 2 | Already behind Caddy LB; add second instance |
| Marquez | Stateless API | 2 | Marquez DB is separate Postgres |
| Superset | Stateless | 2 | Celery worker pool for async queries |
| FleetDM | Active-passive | 2 | FleetDM supports multi-node with shared MySQL |
| OpenBao | HA with Raft | 3 | OpenBao built-in Raft consensus; 3-node quorum |
| Temporal | Clustered | 3 | Temporal supports multi-node cluster with Cassandra or Postgres backend |
| Caddy edge | Active-active | 2 | Two edge nodes; Cloudflare tunnel load balances between them |

### Track 2 — High availability

HA means no single point of failure for any service in the critical path. Critical path = Postgres, Keycloak, the gateway, Caddy.

**Postgres HA — Patroni + streaming replication**
- Primary on S1, standby on S2 (or a third node)
- Patroni manages leader election via etcd (etcd is a 3-node cluster itself)
- PgBouncer in front of both nodes for connection pooling
- Automatic failover: if primary dies, Patroni promotes the standby within ~30 seconds
- The console's `DATABASE_URL` points to PgBouncer, not directly to Postgres

**Keycloak HA — Infinispan cluster**
- Both Keycloak nodes share distributed session cache via Infinispan
- Both nodes are active — Caddy round-robins between them
- One node dying doesn't log users out (sessions survive in the other node's cache)

**Gateway HA — already built**
- The cluster router already handles multinode routing and health-based admission
- Add a third gateway node so the cluster survives one node failure with two remaining
- Caddy health checks remove a dead node within one check interval (~5s)

**OpenBao HA — Raft consensus**
- OpenBao (Vault fork) has native Raft: 3 nodes form a quorum
- Leader handles writes; followers serve reads
- Auto-promotion if the leader dies; quorum maintained as long as 2 of 3 are up

### Track 3 — Backup & recovery

**What needs backing up:**

| Data | Where it lives | Backup method | Schedule | Retention |
|---|---|---|---|---|
| Postgres (all tables) | S1 Postgres | `pg_dump` + WAL archiving to SeaweedFS | Continuous WAL + daily full dump | 30 days |
| OpenSearch indices | S1 OpenSearch | Snapshot API → SeaweedFS S3 endpoint | Daily | 14 days |
| Qdrant collections | S1 Qdrant | Snapshot API | Daily | 14 days |
| OpenBao KV | S1 OpenBao | `bao kv get` export + Raft snapshot | Daily | 30 days |
| Langfuse data | S2 Langfuse Postgres | `pg_dump` | Daily | 14 days |
| Provit recordings | S2 SeaweedFS | SeaweedFS replication to offsite bucket | Continuous | 90 days |
| Keycloak realm | S1 Keycloak | Realm export via admin API | Daily | 30 days |

**Backup storage:** activate SeaweedFS with erasure coding across both nodes. Add an offsite bucket (Cloudflare R2 or Backblaze B2) as the secondary destination for all backups. SeaweedFS already supports S3-compatible replication.

**Backup schedule job:** a Nomad periodic job runs the full backup sequence nightly, validates checksums, pushes to the offsite bucket, and writes a backup manifest row to Postgres. The console's Control module gets a Backups tab that reads the manifest — operators can see last successful backup per service and trigger manual restores.

### Track 4 — Disaster recovery

**RTO/RPO targets:**

| Scenario | Target RTO | Target RPO |
|---|---|---|
| Single node (S1 or S2) failure | < 5 minutes | 0 (HA replica takes over) |
| Both nodes lost (hardware failure) | < 2 hours | < 24 hours (last daily backup) |
| Data corruption (Postgres) | < 1 hour | Point-in-time via WAL archiving |
| Full DR (new hardware) | < 4 hours | Last daily backup |

**DR runbook structure** (to be written as `docs/RUNBOOKS.md` entries):
1. Node failure → Nomad auto-reschedules containers to surviving node; Patroni promotes Postgres standby
2. Postgres corruption → restore from WAL archive to point-in-time; replay
3. Full site loss → provision new hardware, run `deploy/scripts/restore.sh` which pulls latest backup manifest from offsite bucket and restores each service in dependency order
4. Keycloak loss → restore realm export; users re-auth (sessions are lost, JWTs are short-lived)

**Restore verification:** monthly automated drill — spin up a fresh environment, restore from the previous night's backup, run the Provit test suite against it. Pass/fail reported to the Control audit log.

### Track 5 — Observability for the infrastructure

You can't have HA without knowing when things are failing. Currently there are no resource limits on containers and no infrastructure alerting.

- **Resource limits:** add CPU/memory limits to every Nomad job spec. Prevents one runaway service from starving the node.
- **VictoriaMetrics** (currently off) → turn it on as the metrics TSDB. Every service emits Prometheus metrics; VictoriaMetrics scrapes them. Dashboards in Grafana or natively.
- **Alerting:** VictoriaMetrics alerting rules for: Postgres replication lag > 30s, OpenBao leader unreachable, gateway node count < 2, disk usage > 80%, backup job failed.
- **Uptime endpoint:** `GET /api/v1/health` on the console already exists; add a synthetic monitor from Cloudflare Workers that pages if it's unreachable.

**Definition of done:** any single service or node can be killed and the platform continues serving within the RTO targets above. Last night's backup is restorable in under the stated RTO. The Control module shows backup status and infrastructure health. VictoriaMetrics alerting is firing on at least one synthetic failure in a drill.

---

## Phase 4 — OSS feature parity
**Goal:** for every OSS service already running, close the gap between what it exposes and what the console actually uses. No new services. No new architecture. Just leverage what we're paying to run.
**Timeline:** 6–8 weeks. Parallelisable across services — each service is an independent track.
**Depends on:** Phase 3 (org-scoped queries on all new read-back views).

### The principle

The research found a consistent pattern: services are wired as **write-only sinks** — the console ships data to them, but never reads back or surfaces their capabilities in the UI. Phase 4 closes every one of those gaps, working through the services in priority order.

### Priority 1 — Read-back paths (high value, API already exists)

These services have rich APIs and the console calls them zero times on the read path. Each becomes a proper two-way integration.

**OpenSearch** — currently write-only (`_bulk` audit ingest). Add:
- Full-text audit search UI (the `_search` API with filters by user/action/date) in the Control module
- Aggregations: top users by request count, error rate over time, model usage breakdown
- Alert rule management — wire OpenSearch Watchers to the Control guardrails UI

**Langfuse** — currently write-only (OTLP spans + scores pushed). Add:
- Native trace waterfall in the Observability module (reading `/api/public/traces` + `/observations`) — the embedded iframe is blocked by X-Frame-Options; replace it with a first-party component that reads the Langfuse API directly
- Per-trace cost rollup fed into FinOps (Langfuse has a cost API — wire it to the budget system)
- Score distribution chart (the LLM-as-judge scores are written but never visualised)

**Marquez** — currently emit-only (OpenLineage POST). Add:
- Read the Marquez job→dataset graph directly (`/api/v1/namespaces/{ns}/jobs/{job}/lineage`) and render it as the Lineage view's primary source (not the audit-reconstructed fallback)
- Dataset catalog: list all datasets Marquez knows about, with their upstream/downstream jobs

**OpenBao** — currently scaffold only (`getSecrets()` has zero call sites). Add:
- Real KV read/write/list wired to the Secrets panel in Control (the UI exists; the calls don't)
- Secret rotation UI — list KV keys with last-updated timestamps, trigger rotation
- Lease expiry alerts

### Priority 2 — Admin operations (moderate value, one-time setup unblocks them)

**Presidio** — `/analyze` is used; `/anonymize` is never called. Add:
- Replace the in-console regex string-replace with actual Presidio `/anonymize` ML redaction
- Custom recognizer management UI — add/remove entity types via the Presidio API
- Per-request entity breakdown in the audit log (what PII types were found, not just a boolean)

**FleetDM** — read-only host list only. Add:
- Policy management: create/edit/delete FleetDM policies from the Fleet module (not just view)
- Live query UI: run an osquery query across the fleet, see results in real time
- Software inventory per device: what's installed, what has known CVEs (FleetDM exposes this)
- MDM enrollment status column in the device table

**Superset** — health-ping only; embed blocked. Add:
- Replace the iframe embed with the Superset guest-token SDK (solves X-Frame-Options)
- Provision one default dashboard via the Superset API (`/api/v1/chart` + `/api/v1/dataset`) seeded from the console's gateway analytics data
- SQL Lab passthrough: link from the Analytics module to Superset SQL Lab for ad-hoc queries

**Unleash** — flag lookups only; strategies and segments unused. Add:
- Flag management UI in the Admin module: create/edit/delete flags, set gradual rollout %, assign segments
- A/B variant editor: define variants per flag, see variant distribution in Analytics

### Priority 3 — Activate swaps (low effort, high signal)

**Qdrant** — built, not default. Switch `OFFGRID_ADAPTER_RETRIEVAL=qdrant` in the deployment. Wire `@offgrid/rag` (the shared package) to replace the in-console `src/lib/rag.ts` — this also fixes the OOM bug from Phase 0.

**Presidio anonymizer** — the `/anonymize` endpoint is already running on S2. The switch from regex to ML redaction is one adapter change once the UI work above is done.

**Temporal** — the adapter scaffold exists. Wire it properly: add `@temporalio/client` binding, define `AgentRunWorkflow`, deploy a worker alongside the cluster gateway. Switch `OFFGRID_QUEUE_ENABLED=1`. This makes agent runs durable across restarts.

### Priority 4 — Wire idle shared packages

Four `@offgrid/*` packages are complete and unused. Wire them now, not in a future architecture phase:
- `@offgrid/rag` → replaces `src/lib/rag.ts` (fixes OOM, uses Qdrant properly)
- `@offgrid/pipeline` → ETL primitives for the Data module connectors
- `@offgrid/ui` → shared React components (reduces duplication with mobile web later)
- `@offgrid/memory` → **not yet** — this depends on desktop/mobile capture, which isn't built. Leave it for Phase 7.

### Per-service gap table

| Service | Today | Phase 4 adds | Effort |
|---|---|---|---|
| OpenSearch | write-only `_bulk` | full-text search UI, aggregations, alert rules | M |
| Langfuse | write-only OTLP | first-party trace waterfall, cost→FinOps, score charts | M |
| Marquez | emit-only | read lineage graph from Marquez API directly | S |
| OpenBao | scaffold (zero call sites) | real KV read/write/list, rotation UI | S |
| Presidio | `/analyze` only | `/anonymize` wired, custom recognizers UI, per-request breakdown | S |
| FleetDM | host list only | policy CRUD, live query UI, software inventory, MDM status | M |
| Superset | health-ping only | guest-token SDK embed, default dashboard provisioned, SQL Lab link | M |
| Unleash | flag lookups only | flag management UI, A/B variants, gradual rollout editor | S |
| Qdrant | built, not default | flip default, wire `@offgrid/rag` | XS |
| Temporal | scaffold | `@temporalio/client` binding, worker, durable agent runs | L |

S = 1–3 days · M = 1–2 weeks · L = 3–4 weeks · XS = hours

**Definition of done:** every OSS service is two-way — the console reads back from it, not just writes to it. No service is a write-only sink. The gap table above is fully green.

---

## Phase 4.5 — AI Studio (non-technical builder)
**Goal:** non-technical users — ops, analysts, domain experts — can build AI workflows without knowing routing, policy pipelines, or any technical terminology. They describe what they want in plain language; Studio wires it.

**Context:** the Studio module (`/studio`) exists in the module registry and renders a placeholder. The real builder has never been built out. This phase defines and delivers it properly.

**Timeline:** 4–6 weeks, parallel to late Phase 4 (shares the agents/gateway infra).
**Depends on:** Phase 4 (models must be reachable + agent runner must work), Phase 3 (org-scoped saves).

### What non-technical means here

Studio must work for someone who:
- Does not know what a system prompt is
- Does not know what a temperature or top-k is
- Cannot distinguish between a RAG pipeline and a chat completion
- Has a business goal ("summarise every support ticket and tag it"), not a technical one

This is ChatGPT Custom GPTs + Zapier for AI, on-prem, org-scoped.

### The builder (what to build)

**Step 1 — Goal capture (plain language)**
A conversational onboarding: "What do you want this assistant to do?" Studio infers the system prompt, relevant tools, and data sources from the description. No form fields, no jargon.

**Step 2 — Skills (what it can do)**
Drag-and-drop skill tiles, not code. Built-in skills: search org knowledge, search the web, run code, send Slack messages, write to a doc. Custom skills via HTTP (URL + auth + schema — but described in plain English: "call our CRM at this URL when someone asks about a client").

**Step 3 — Data (what it knows)**
Connect a knowledge collection (from the Knowledge module — no jargon: "Upload files your assistant should know about"). No embedding config, no chunking strategy exposed to the user.

**Step 4 — Try it**
Inline test chat with the agent before publishing. One-click save → deploys as a `/chat` conversation template accessible to the org.

**Step 5 — Share**
Publish to the org (all users can find and chat with it), a team, or keep private. Generates a direct link.

### What's hidden from the builder
All of the following are handled automatically and never exposed in the Studio UI:
- Model selection (Studio picks the best available model from the gateway for the task)
- Temperature / sampling params
- Token limits
- Embedding model / chunk size
- Temporal workflow config
- API keys / auth tokens for skills (entered once by an admin in Integrations)

### Technical substrate
Studio agents are `AgentRun` records with a saved `StudioTemplate` config (stored in Postgres, org-scoped). The template resolves to a system prompt + skill list + knowledge collection ID at run time. No new agent runtime — same Temporal worker, different input.

### Surfaces to build
| Surface | What |
|---|---|
| `/studio` page | Template gallery — browse, duplicate, launch |
| Studio builder | 4-step flow (Goal → Skills → Data → Try/Publish) |
| `StudioTemplate` schema | Postgres table, org-scoped, versioned |
| `/api/v1/studio/*` routes | CRUD for templates, publish/unpublish |
| Template runner | Resolve template → AgentRun input at chat time |

### Definition of done
A non-technical user with no prior AI experience can:
1. Open Studio
2. Describe their workflow in plain English
3. Connect a knowledge base (upload PDFs)
4. Test the assistant inline
5. Publish it for their team

...without ever seeing: temperature, top-k, chunk size, embedding model, system prompt (unless they click "Advanced"), or any routing config.

### Studio as a full product (expanded scope — "Lovable for on-prem AI")

Beyond compose+run, Studio must be a complete builder. Sequenced sub-milestones:

- **S1 — Run through governance (DONE).** "Run as app" executes via `runAgent()` — ABAC/policy gate, input+output guardrails, retrieval/grounding, provenance signing, persistence, lineage, QA, Temporal queue. Result shows a "✓ governed" badge.
- **S2 — Deploy to a subdomain.** Publishing a Studio app mints a URL on `*.getoffgridai.co` (e.g. `app-<slug>.getoffgridai.co`) via a Cloudflare DNS record (API) + a Caddy vhost (gated) that serves the app shell → the template's runner. One-click deploy, like Lovable.
- **S3 — Triggers.** Real synchronous (HTTP/webhook) and asynchronous (schedule/cron via Temporal, email/inbound) triggers wired to the runner — not the current inert Input blocks.
- **S4 — Human-in-the-loop (real).** Server-side checkpoint: a run pauses at `status:'pending_review'`, persists, and exposes an approve/reject endpoint + inbox UI — replacing the current client-only toggle.
- **S5 — Report cycles.** Scheduled runs that produce citation-backed reports (reuse the Reports module) on a cadence, delivered to the chosen sink.
- **S6 — Real connectors + data.** Studio's data blocks bind to live enterprise sources (see Phase 4.7). No synthetic catalog.

### S8 — Cloud model routing + BYO provider tokens (FinOps-attributed)

When launching/deploying a Studio app, the builder must let you route to a **cloud model**
(OpenAI/Anthropic/etc.), not just local — and supply the **provider API token** required. Flow:
- Studio app config gets a model picker that includes cloud models (from the gateway's leashed-cloud routing) + a field to provide the provider key (stored as a secret via the config service / OpenBao, never in the workflow JSON).
- The gateway's routing rules already model local↔cloud; wire the app's chosen model + key through `runAgent` → gateway so the deployed app can call the cloud model.
- **The FinOps layer attributes that cloud spend** — the gateway logs the call (model, tokens, caller `app:<slug>`) to the OpenSearch index that FinOps already reads, so cloud cost per app/user shows up in FinOps automatically (the `(ip, token, meta)` token store + cost pricing already exist).

**Definition of done:** deploy an app that uses a cloud model with your own provider key; the call routes through the governed gateway; FinOps shows the attributed cloud cost per app.

### S7 — World-class builder (Bolt.new / Lovable parity)

The bar: Studio should feel as good as the best OSS app-builders (bolt.new, Lovable, and the open forks like bolt.diy / OpenHands). Concretely:

- **Generative UI, not just a chat template.** Describe an app → the agent generates a real, editable app (forms, tables, dashboards) rendered live — reuse the console's artifact runtime (sandboxed iframe, already built) as the preview surface. Study bolt.diy's WebContainer approach for live code preview; on-prem we use the sandbox adapter.
- **Iterative refine loop.** "Change the header", "add a filter" → diffs the app, re-renders. Chat-driven editing of the generated app (the bolt/Lovable core loop).
- **Live preview + code view side-by-side**, in-place edit (already have the artifact editor — extend it).
- **Templates gallery / one-click starts**, versioning + rollback per app (schema supports versions).
- **Instant deploy** (S2, done) + custom subdomain, share links, embed snippet.
- **Multi-file / multi-step apps**, not single prompts — the workflow graph already models this; wire the runner to execute multi-node.
- **Evaluate the OSS field** (bolt.diy, OpenHands, Dyad, srcbook) and lift the best patterns; keep everything on-prem + governed (every generated app runs through `runAgent`).

**Definition of done:** a non-technical user builds, previews, iteratively refines, and one-click deploys a real working app — parity with bolt.new/Lovable — entirely on-prem and governed.

### Non-negotiables for all of the above
- SOLID + the ports/adapters discipline in `docs/ENGINEERING.md`.
- Every underlying service actually alive and exercised (no stubbed blocks presented as working).

---

## Phase 4.7 — Real data & connectors (kill synthetic data)

**Goal:** nothing shown is fabricated. Two live fabrications removed (`syncConnector` random counts, random latency fallback); seed scripts (`src/db/seed.ts`, `seed-agentic.ts`, `brain.ts` SEED_DOCS) stop pre-populating; real producers wired.

**Real enterprise data sources** (Docker on S1's existing OrbStack — no new node/OrbStack-first-run needed; Snowflake/Databricks aren't self-hostable so use connectable OSS equivalents, labeled honestly):
- **Core Banking** — Postgres with a realistic schema + data (customers, accounts, transactions, claims).
- **Warehouse** — MinIO (S3) + DuckDB/Trino as the "Snowflake/Databricks" stand-in.
- **CRM** — a mock Salesforce-style REST API.
- Console connectors point at these real endpoints; `syncConnector` reports **real** row/document counts.

**Analytics/FinOps** already read the real `offgrid-gateway` OpenSearch index — the legacy Postgres-audit-seeded path is the synthetic one to retire.

**Definition of done:** a fresh tenant shows empty or real data only; connectors connect to live sources; sync counts are actual; every metric traces to a real event.

---

## Phase 4.6 — Chat feature parity (ChatGPT/Claude-grade UX)
**Goal:** the chat surface is currently thin. Bring it to parity with ChatGPT/Claude so it's a product people actually prefer, not a toy over the gateway.

**Context:** the chat works (streams from the gateway) but is missing table-stakes interaction features. Users notice immediately.

**Timeline:** 3–4 weeks, parallel to Phase 4. **Depends on:** gateway API-key wiring (done) + storage module (done, for the image gallery).

### Gaps to close (all confirmed missing today)

**Message actions**
- **Retry** — regenerate the last assistant turn (same or different model).
- **Stop** — cancel an in-flight stream mid-generation (abort the upstream fetch, keep partial text).
- **Edit** — edit a previous user message in place and re-run from that point (fork the conversation).
- Copy, thumbs up/down (feeds Observability), branch/fork a conversation.

**Attachments & images**
- **Drag-and-drop images/files** onto the composer (not there today).
- **Image gallery** — view all images attached in a conversation in a lightbox/grid; click a thumbnail to expand. Reuse the Storage module's viewer.
- Paste-from-clipboard image support.
- Show attached-image thumbnails inline in the message, not just filenames.

**Artifacts**
- **Edit artifact in place** — an inline editor for generated HTML/SVG/React/code artifacts, with live re-render (today artifacts are read-only after generation).
- Version history + revert on an artifact (schema already supports `chat_artifact_versions`).
- "Ask AI to change this" on a selected region of an artifact.

**Composer & session**
- Slash-command palette polish, model picker with capabilities, per-message model badge.
- Regenerate-with-different-model, streaming token counter, stop/continue.
- Keyboard shortcuts (⌘↵ send, ↑ to edit last, esc to stop).

**Error handling (currently poor)**
- Surface gateway/stream errors **inline in the message** (not a silent empty bubble or a toast that vanishes) — with the actual reason (gateway offline, 401, rate-limited, timeout, model unavailable).
- **Retry affordance on every failed turn** — one click to re-run the failed generation.
- Distinguish transient (retryable: timeout, 502) from terminal (401/403/400) errors and message accordingly.
- Preserve the user's input on failure (never lose the prompt).
- Mid-stream failure keeps partial output + shows "generation interrupted — retry?".
- Attachment/upload errors reported per-file with a reason.

### Definition of done
The chat supports: stop, retry, edit-and-rerun on any message; drag-drop + paste + inline image thumbnails + a per-conversation image gallery; in-place artifact editing with live re-render and version revert. A user coming from ChatGPT/Claude finds nothing obviously missing.

---

## Phase 5 — Unified API gateway (`console-api.getoffgridai.co`)
**Goal:** every service's API is discoverable and callable through one surface. Makes the platform buildable-on without touching the console UI.
**Timeline:** 3–4 weeks (largely config and codegen). Parallelisable with Phase 4.
**Depends on:** Phase 3 (auth must be org-scoped before public exposure).

### Six things needed

1. **Cloudflare tunnel ingress rule** — add `console-api.getoffgridai.co` to `deploy/onprem/cloudflared-tunnel.yml`
2. **DNS record** — CNAME to the tunnel
3. **Caddy site block** — new vhost: `/specs/*` proxies to each service's native OpenAPI endpoint; `/v1/*` to the gateway; `/api/*` to the Next.js console
4. **CORS headers** — on all API routes for cross-origin browser access
5. **Console OpenAPI spec** — generate from the 140+ routes via `next-swagger-doc` or `zod-openapi`
6. **Auth alignment** — bearer token (gateway machine client) accepted on all API routes alongside session cookies

### The catalog

9 of 14 services already publish native OpenAPI specs. A single Swagger UI shell with a service dropdown loads each spec via the Caddy proxy (solves CORS). Services without a machine-readable spec get hand-authored YAML stubs.

| Service | Spec URL | Notes |
|---|---|---|
| Console | `/specs/console` | Generated — biggest gap |
| OpenBao | `/specs/openbao` | Native at `/v1/sys/internal/specs/openapi` |
| Qdrant | `/specs/qdrant` | Native at `/openapi/openapi-3.1.0.json` |
| Marquez | `/specs/marquez` | Native at `/api/v1/openapi` |
| Langfuse | `/specs/langfuse` | Native at `/api/public/openapi.json` |
| Superset | `/specs/superset` | Native at `/api/v1/openapi.json` |
| FleetDM | `/specs/fleetdm` | Native at `/api/openapi.json` |
| Presidio | `/specs/presidio-*` | Native on both analyzer + anonymizer |
| Unleash | `/specs/unleash` | Native at `/api/swagger.json` |
| Keycloak | `/specs/keycloak` | Hand-authored (Keycloak has no machine spec) |
| OPA | `/specs/opa` | Hand-authored |
| Temporal | `/specs/temporal` | gRPC-only; hand-authored REST bridge spec |

**Definition of done:** `https://console-api.getoffgridai.co/docs` loads Swagger UI with all specs selectable. Every console API route documented. Machine client bearer token works on all routes.

---

## Phase 6 — Module spine (`defineOffgrid`)
**Goal:** the gateway becomes a true composition root. Add a capability = one config line. The console is the gateway with a fuller config. Enables the SDK in Phase 7.
**Timeline:** 8–10 weeks.
**Depends on:** Phase 4 (feature parity must be real before abstracting it) + Phase 5 (the API catalog is what the module manifest routes expose).

### What changes

Today the gateway and console are two separate apps connected by HTTP. Target: one host, one config file.

```ts
export default defineOffgrid({
  auth: keycloakAuth({ url, realm, clientId, clientSecret }),
  modules: [
    gateway(),
    brain({ vectorStore: qdrant({ url: 'http://qdrant.lan:6333' }) }),
    analytics(),
    finops({ pricing: { 'gemma-3-9b': { input: 0.10, output: 0.30 } } }),
    proveIt({ provitUrl: 'http://192.168.1.60:7799' }),
    fleet({ fleetdmUrl: 'http://fleet.lan:8070', token: process.env.FLEETDM_TOKEN }),
    observability({ langfuseUrl, langfuseKey }),
  ],
})
```

Each module is a factory returning a manifest:
```ts
interface ModuleManifest {
  id: string
  nav: NavItem[]
  routes: RouteDefinition[]
  settingsPanel?: ReactComponent
  gatewayHooks?: { sinks?: ObservabilitySink[]; policies?: Policy[] }
  requires?: Permission[]
}
```

The host reads the config, mounts everything automatically. Add/remove a module = add/remove one line.

**Definition of done:** `defineOffgrid()` is the single source of module registration. Adding a new module by config line works end-to-end. Console and standalone gateway run the same host code.

---

## Phase 7 — Developer SDK + flywheel
**Goal:** third parties build modules. Managed hosting ships.
**Timeline:** ongoing from Phase 6.
**Depends on:** Phase 6 (module spine must exist before it can be an SDK).

- `@offgrid/sdk` on npm — `defineOffgrid()`, manifest types, sink/policy interfaces, auth seam
- `npx @offgrid/sdk create-module` scaffold
- Community module registry at `console-api.getoffgridai.co/modules`
- `organizations.plan_tier` gates Pro modules at the host level

---

## Phase 8 — The Soul (intelligence layer)
**Goal:** the platform works on your behalf. Context flows in from all sources, synthesis flows out, nodes get smarter over time.
**Timeline:** after Phase 6. **Explicitly after desktop/mobile capture is built.**
**Depends on:** `@offgrid/memory` (which depends on desktop/mobile capture — not built yet), Qdrant as default (Phase 4), org-scoped embeddings (Phase 3).

### Why this comes last

The Soul's value comes from feeding it rich event data from all surfaces: desktop captures, mobile sessions, agent runs, Provit test results. Without desktop/mobile capture (`@offgrid/capture`, `@offgrid/memory`), the Soul has partial signal. Build it when the full signal is available.

### The pipeline (when ready)

```
Event sources (all surfaces)     Enrichment          Store           Retrieval
────────────────────────────     ──────────────      ──────          ──────────
agentRuns (Postgres)        ──►  LLM summary         Qdrant          RRF router
audit log                   ──►  /v1/chat        ──► event_intel ──► + new source
Langfuse traces             ──►  + embed             per org     ──► context_hints
Marquez lineage             ──►  /v1/embeddings                      in policy-pull
Provit run results          ──►
Desktop captures (mobile)   ──►  ← blocked on @offgrid/memory
```

No new containers needed. The pipeline is a scheduled job (Temporal, already wired by Phase 4) reading across all sources per org, summarising, embedding, upserting to Qdrant.

**Definition of done:** events embedded on a schedule, retrieved at query time, `context_hints` in node policy-pull responses. Observability module has a Soul activity view.

---

## Critical path

```
Phase 0 (bugs + versions)
    │
    └─► Phase 1 (nav refactor)
            │
            └─► Phase 2 (Prove It)
                    │
                    └─► Phase 3 (multi-tenancy)
                            │
                            ├─► Phase 3A (hardening & scale) ─────────────────┐
                            │       infra track, parallel to P4/P5             │
                            │       · Nomad orchestration                      │
                            │       · HA (Patroni, Raft, Sentinel)             │
                            │       · Backup + DR runbooks                     │
                            │       · VictoriaMetrics alerting          ───────┘
                            │
                            ├─► Phase 4 (OSS parity) ──────────────────────────┐
                            │       UI/API track                                │
                            │       · OpenSearch read-back                      │
                            │       · Langfuse first-party trace view           │
                            │       · Marquez lineage graph                     │
                            │       · OpenBao real KV UI                        │
                            │       · FleetDM policy + live query               │
                            │       · Superset guest-token embed                │
                            │       · Unleash flag management                   │
                            │       · Temporal wired                     ───────┤
                            │               │                                   │
                            │               └─► Phase 6 (module spine)          │
                            │                       │                           │
                            │                       └─► Phase 7 (SDK/flywheel)  │
                            │                                                   │
                            ├─► Phase 5 (unified API) ─ parallel w/ P4/3A ─────┘
                            │
                            └─► Phase 8 (Soul) ── blocked on desktop/mobile capture
```

**Parallel after Phase 3:** Phases 3A, 4, and 5 run simultaneously — different skill sets (infra vs. UI/API vs. config/codegen), no shared blockers.
**Sequential:** Phase 6 needs Phase 4 (abstract real integrations, not aspirational ones). Phase 7 needs Phase 6. Phase 8 needs `@offgrid/memory` which needs desktop/mobile capture — do not start early.

---

## Multi-tenancy architecture reference

Every table in the schema follows this pattern:

```sql
-- Every table
org_id text NOT NULL REFERENCES organizations(id),

-- Drizzle wrapper (one place, not everywhere)
export const withOrg = (db: DB, orgId: string) =>
  db.where(eq(schema.table.orgId, orgId))

-- Postgres RLS (backstop)
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON agent_runs
  USING (org_id = current_setting('app.current_org_id'));
```

Keycloak JWT claim:
```json
{
  "sub": "user-uuid",
  "org_id": "org-wednesday",
  "realm_access": { "roles": ["admin"] }
}
```

File storage (SeaweedFS) namespacing:
```
/{org_id}/provit/recordings/{session_id}/{frame}.jpg
/{org_id}/artifacts/{artifact_id}
/{org_id}/knowledge/{doc_id}
```

The `organizations` table is the anchor:
```sql
CREATE TABLE organizations (
  id          text PRIMARY KEY,          -- slug, e.g. "wednesday"
  name        text NOT NULL,
  plan_tier   text NOT NULL DEFAULT 'oss', -- oss | pro | enterprise
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

---

## Phase 9 — Open source + CI/CD deploy (LATER — not now)

**Goal:** make the full console open source and deploy it via GitHub Actions instead of the
current manual rsync-over-tunnel. Deferred, but planned.

- **Open-source prep:** license (AGPL-3.0 to match the workspace), scrub the repo of any real
  secrets/hostnames/IPs (move all to env + `.env.example`), CONTRIBUTING + CLA, security policy.
  Nothing in git should be a live secret — audit `deploy/`, `SERVER_STATE.md` (references only),
  and the gateway/keycloak values.
- **GitHub Actions deploy:** a workflow that builds + deploys to the fleet on merge to `main`.
  Because git doesn't work on the servers and direct LAN isn't reachable, the runner deploys
  **over the Cloudflare tunnel** (the SSH-from-outside path already proven this session):
  `cloudflared access ssh` + rsync + build + restart.
- **Secrets to create in the repo (GitHub → Settings → Secrets):**
  `SSH_PRIVATE_KEY` (a deploy key authorized on S1), `CLOUDFLARE_*` (for `cloudflared access`),
  the server env values needed to render `.env.production`. A Cloudflare **service token** for
  the Access-gated SSH app (so the runner authenticates non-interactively).
- **Zero-downtime restart** in the workflow (start new before killing old) so deploys stop
  briefly 502-ing the gated services.

**Definition of done:** push to `main` → GitHub Actions builds, tests (incl. Provit E2E once
2.D lands), and deploys to the fleet over the tunnel, with no manual steps and no secrets in git.

---

_Last updated: 2026-07-03. Owned by: console team._
_Related: `README.md`, `docs/research/`, `../shared/ROADMAP.md`_
