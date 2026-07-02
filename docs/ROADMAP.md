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

## Phase 4 — The module spine (`defineOffgrid`)
**Goal:** the gateway becomes a true composition root. Add a capability = add one config line. The console is the gateway with a fuller config.
**Timeline:** 8–10 weeks.
**Depends on:** Phase 3. The module system must be org-aware from the start.

### What this means

Today: the gateway and console are two separate apps. The console is a Next.js app that calls the gateway over HTTP.

Target: `offgrid.config.ts` is the only thing that differs between a standalone gateway and the full console.

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
  nav: NavItem[]                    // what appears in the left nav
  routes: RouteDefinition[]         // the API + UI routes this module contributes
  settingsPanel?: ReactComponent    // appears in the module's Settings sub-page
  gatewayHooks?: {
    sinks?: ObservabilitySink[]     // what this module writes to (OpenSearch, Langfuse...)
    policies?: Policy[]             // what policies this module injects into the pipeline
  }
  requires?: Permission[]           // what the auth provider must grant for this module
}
```

The host (gateway/console) reads the config, registers all manifests, mounts nav/routes/settings automatically, wires sinks/policies into the engine, enforces `requires` via the auth provider.

### Packages to wire in

With the module spine in place, wire the 4 idle shared packages:
- `@offgrid/rag` → replaces the in-console `src/lib/rag.ts` (fixes the OOM issue from Phase 0)
- `@offgrid/memory` → feeds the Soul pipeline (Phase 5)
- `@offgrid/pipeline` → ETL primitives for the Data module
- `@offgrid/ui` → shared React components across console + mobile web

**Definition of done:** `defineOffgrid()` exists and is the single source of module registration. Adding a test module by adding one config line works. The console and standalone gateway use the same host code.

---

## Phase 5 — The intelligence layer (The Soul)
**Goal:** the platform works on your behalf, not just for you. Context flows in, synthesis flows out, nodes get smarter over time.
**Timeline:** 8–10 weeks (parallelisable with Phase 4).
**Depends on:** Phase 3 (org-scoped embeddings), Qdrant active.

### The pipeline

```
Event sources                Enrichment              Store          Retrieval
─────────────────            ──────────────          ──────         ──────────────────
agentRuns (Postgres)  ──►    LLM summary             Qdrant         RRF router
audit log             ──►    (gateway /v1/chat)  ──► event_intel ──► existing sources
Langfuse traces       ──►    + embed                 collection     + new source
Marquez lineage       ──►    (/v1/embeddings)                      ──► context_hints
Provit run results ─►                                               in policy-pull
```

- A scheduled job (Temporal workflow or a cron-hit route) reads the last N events across all four sources
- Calls the local gateway (`/v1/chat`) to summarise — one call per batch, not per event
- Embeds the summary via `/v1/embeddings` (384-dim MiniLM, already wired)
- Upserts into a new Qdrant collection `event_intelligence` namespaced by org
- A new `RetrievalSource` plugs into the existing RRF router automatically
- `GET /api/v1/devices/policy` response gains `context_hints: string[]` — the top-K retrieved summaries for that node

Provit run results are especially valuable here: a failed test run is a signal that something is wrong. The Soul surfaces "tests failed in this repo 3 times this week, likely related to the gateway config change on Tuesday" without anyone asking.

No new containers. Switch `OFFGRID_ADAPTER_RETRIEVAL=qdrant` to make Qdrant the default (it's deployed and has a full client).

**Definition of done:** events are embedded on a schedule, retrieved at query time, `context_hints` appear in node policy-pull responses. The Observability module has a Soul dashboard showing what was summarised and when.

---

## Phase 6 — Unified API gateway (`console-api.getoffgridai.co`)
**Goal:** every service's API is discoverable and accessible through one surface.
**Timeline:** 3–4 weeks (largely config and codegen).
**Depends on:** Phase 3 (auth must be org-scoped before exposing publicly).

### Six things needed

1. **Cloudflare tunnel ingress rule** — add `console-api.getoffgridai.co` to `deploy/onprem/cloudflared-tunnel.yml`
2. **DNS record** — A/CNAME pointing to the tunnel
3. **Caddy site block** — new vhost in the edge compose, routing `/specs/*` to each service's native OpenAPI endpoint, `/v1/*` to the gateway, `/api/*` to the Next.js console
4. **CORS headers** — on all API routes for cross-origin browser access
5. **Console OpenAPI spec** — generate from the 140+ routes via `next-swagger-doc` or `zod-openapi`
6. **Auth alignment** — bearer token (gateway machine client) accepted on all API routes, not just session cookie

### The catalog

9 of 14 services already publish native OpenAPI specs. A single Swagger UI shell with a service picker loads each via the Caddy proxy path (solves CORS). Services without a spec get hand-authored YAML stubs.

| Service | Spec URL via gateway |
|---|---|
| Console | `/specs/console` (generated) |
| OpenBao | `/specs/openbao` |
| Qdrant | `/specs/qdrant` |
| Marquez | `/specs/marquez` |
| Langfuse | `/specs/langfuse` |
| Superset | `/specs/superset` |
| FleetDM | `/specs/fleetdm` |
| Presidio | `/specs/presidio-analyzer`, `/specs/presidio-anonymizer` |
| Unleash | `/specs/unleash` |

**Definition of done:** `https://console-api.getoffgridai.co/docs` loads the Swagger UI with all service specs selectable. Every console API route is documented. A machine client token authenticates against any route.

---

## Phase 7 — Developer surface + the flywheel
**Goal:** third parties build on the platform. The module SDK ships. The OSS community extends Off Grid.
**Timeline:** ongoing.
**Depends on:** Phase 4 (module spine must be real before it can be an SDK).

### What ships

- `@offgrid/sdk` — the module SDK as an npm package. Includes `defineOffgrid()`, the module manifest types, the `ObservabilitySink` and `Policy` interfaces, and the auth provider seam.
- Module scaffold CLI: `npx @offgrid/sdk create-module my-module` — generates the module structure
- Module registry on `console-api.getoffgridai.co/modules` — lists community modules
- The `Pro` flag per module — `organizations.plan_tier` gates Pro modules at the host level. The module itself doesn't know about billing.

### The flywheel

Each new module makes the platform more useful → more orgs adopt it → more events flow through the Soul → the intelligence layer gets richer → the platform surfaces better insights → more orgs adopt it.

The open-core model is the engine: the module SDK and interfaces are AGPL (anyone can build a module), but the maintained connector library (Salesforce, HubSpot, Slack, Gmail, ...) is Pro — because maintaining connectors against live APIs is the treadmill most orgs don't want to own.

---

## Critical path summary

```
Phase 0 (bugs + versions)
    │
    └─► Phase 1 (nav refactor)
            │
            └─► Phase 2 (Prove It)
                    │
                    └─► Phase 3 (multi-tenancy)   ← ── ── ── ── ──┐
                            │                                       │
                            ├─► Phase 4 (defineOffgrid spine)       │
                            │       │                               │
                            │       └─► Phase 7 (SDK + flywheel)   │
                            │                                       │
                            ├─► Phase 5 (Soul / intelligence)       │
                            │                                       │
                            └─► Phase 6 (unified API gateway) ── ──┘
```

Phases 4, 5, and 6 are parallelisable once Phase 3 is done. Phase 7 is continuous from Phase 4 onward.

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

_Last updated: 2026-07-02. Owned by: console team._
_Related: `README.md`, `docs/research/`, `../shared/ROADMAP.md`_
