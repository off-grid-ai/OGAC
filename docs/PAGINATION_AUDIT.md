# Pagination audit — deep-check of every list/table/card-grid surface

TASK #123. Goal: consolidate ad-hoc pagination onto ONE common component and apply it to the
clearly-unbounded, data-heavy tables.

## The common building blocks (single source of truth)

| Piece | File | What it is |
|---|---|---|
| Pure logic | `src/lib/paginate.ts` | Zero-IO `paginate(items, page, pageSize)` → `{pageItems, page, pageCount, total, pageSize, from, to, hasPrev, hasNext}`, plus `clampPage`, `clampPageSize`, and `pageRange(page, pageCount, siblings)` for the compact number range with ellipses. Unit-tested (`test/paginate.test.ts`, 16 tests). |
| URL hook | `src/lib/use-pagination.ts` | `usePagination(items, {key, defaultPageSize, pushHistory})` — reads/writes page & size from URL searchParams (nav-in-URL rule), namespaced by `key` so multiple lists coexist. Client-side slicing over an already-fetched array. |
| Control | `src/components/ui/Pagination.tsx` | Presentational: prev/next, page-number range + ellipses, page-size selector, "N–M of T" summary. On-brand (mono, emerald active page, tokens). Emits `onPageChange`/`onPageSizeChange`. |

**Modality note.** Two legitimate pagination models exist in the console:
1. **Client-side over a fetched array** — the common hook/control fit directly. Used for the surfaces below.
2. **Server-side paged (cursor/offset)** — data is fetched per page by the API. The client callback
   control does not fit these directly (they need per-page fetches or `href` links). These are noted
   as "server-paged (already bounded)" — they already have working pagination and are NOT broken.

---

## Consolidated ad-hoc pagination (existing sites found + migrated)

Grep across `src/components` + `src/app` for `slice(`, "page", "Prev"/"Next", "load more", `pageSize`,
offset/limit surfaced these pre-existing ad-hoc pagination implementations:

| Site | File | Was | Action |
|---|---|---|---|
| Audit log (main) | `src/app/(console)/(insights)/audit/page.tsx` | Server-paged with a bespoke `PageLink` Prev/Next + `(page-1)*size+1–…` summary + `page/pageCount`. | **Kept** (server component, server-side paging — the callback control doesn't fit a server page). Logged as the reference ad-hoc pattern; math now mirrored by `paginate`. Left as-is to avoid breaking server-side paging. |
| SIEM search (control) | `src/components/control/AuditSearch.tsx` | Rendered ALL `result.hits` (whole OpenSearch stream) with no pagination. | **Migrated** → `usePagination` + `Pagination` (`key="auditHits"`), resets to page 1 on each new search. |
| Gateway logs | `src/components/gateway/GatewayLogs.tsx` | Server cursor "Load more" (`from += size`). | **Kept** — a true cursor/append model that fetches more from the server; the offset "load more" is the correct UX for an append feed, not page-numbers. Logged, not migrated. |

No component used React `useState` page-index pagination (`setPage`/`currentPage`) — so the ad-hoc
surface area was small: one server link-pager (audit), one cursor "load more" (gateway logs), and a
lot of un-paged full-array renders.

---

## Applied the common component (this task, owned safely)

| Surface | File | Why | How |
|---|---|---|---|
| **SIEM security events** | `src/components/siem/SiemEventsTable.tsx` (new) + `src/app/(console)/(insights)/siem/page.tsx` | `readSiemView` returns up to **500** events, all rendered in one table — clearly unbounded/data-heavy. | Extracted the table into a client component using `usePagination({key:'ev'})` + `Pagination`, client-side slicing over the fetched array. 25/page default. |
| **SIEM full-text search hits** | `src/components/control/AuditSearch.tsx` | "queries the WHOLE stream" — result set can be large. | `usePagination({key:'auditHits'})` + `Pagination`. |

### TASK #130 — applied the common component to the deferred data-heavy surfaces

| Surface | File | Why | How (key · page size) |
|---|---|---|---|
| **Storage browser** | `src/components/storage/StorageBrowser.tsx` | Object listing is potentially large — the audit flagged it the strongest candidate. | Two hooks: folder tiles `usePagination({key:'folder'})` and in-folder files `usePagination({key:'file'})`, each 24/page (only one grid renders at a time). Filters (`applyFilter`) run first, then paginate the filtered set. |
| **Langfuse traces** | `src/components/observability/LangfuseTraces.tsx` | Server-windowed trace list can be large. | `usePagination({key:'traces'})` + `Pagination`, 25/page. |
| **Users (Keycloak)** | `src/components/access/UsersList.tsx` | Realms can hold many users. | `usePagination({key:'users'})` + `Pagination`, 25/page. Paginates the already search-filtered fetched set. |
| **Backups** | `src/components/backups/BackupsManager.tsx` | Long retention windows accumulate many dumps. | `usePagination({key:'backups'})` + `Pagination`, 25/page (over `data.rows`). |
| **FinOps by-key** | `src/components/finops/KeysTable.tsx` (new) + `src/app/(console)/(insights)/finops/page.tsx` | One row per issued virtual key — grows unbounded. | Extracted the by-key `<Table>` into a client leaf (`KeysTable`) using `usePagination({key:'keys'})` + `Pagination`, 25/page. Page stays a thin server component. |
| **Prompts library** | `src/components/prompts/PromptLibrary.tsx` | Card grid grows unbounded. | `usePagination({key:'prompts'})` + `Pagination`, 12/page (options 12/24/48/96). Paginates the search/tag-filtered set. |
| **Artifacts library** | `src/components/artifacts/ArtifactsBrowser.tsx` | Card grid grows unbounded. | `usePagination({key:'arts'})` + `Pagination`, 12/page (options 12/24/48/96). Paginates the search-filtered set. |

All seven slice client-side over the already-fetched array (no store/query signature changes), keep
existing search/filters working (paginate the FILTERED set), and namespace their URL key so they
deep-link and coexist with the surfaces' other `?panel`/`?folder`/`?artifact` params.

---

## DEEP-CHECK INVENTORY — every list/table/card-grid surface

Legend — **Bounded?**: is the row count already limited to a small N? · **Paginated?**: has any
pagination today · **Needs?**: does it need pagination · **Action**: what was/should be done.

### Governance & control
| Surface | Component | Data source | Bounded? | Paginated? | Needs? | Action |
|---|---|---|---|---|---|---|
| Audit log (main) | `app/(console)/(insights)/audit/page.tsx` | OpenSearch, **server-paged** (`readAuditPage`, size/page) | server-paged | **Yes** (Prev/Next links) | has it | Keep — already paged server-side. |
| SIEM full-text search | `components/control/AuditSearch.tsx` | `/api/v1/admin/audit-search` (whole stream) | No | **Now yes** | Yes | **APPLIED** (client). |
| Users (Keycloak) | `components/access/UsersList.tsx` | `/api/…/access/users?search=` | medium; Keycloak-bounded, search-filtered | **Now yes** | Yes | **APPLIED (#130)** — `key:'users'`, 25/page over the search-filtered set. |
| Roles | `components/access/RolesList.tsx` | `/api/…/access/roles` | Small | No | No | None. |
| Identity providers | `components/access/IdpList.tsx` | `/api/…/access/idp` | Small (1–10) | No | No | None. |
| Sessions | `components/access/SessionsPanel.tsx` | `/api/…/access/sessions` | Small–medium | No | Low | Defer. |
| Policy rules | `components/policy/PolicyRulesManager.tsx` | props | Small–medium (≤50) | No | No | None. |
| Rego modules | `components/policy/RegoModulesManager.tsx` | `/api/…/rego-modules` | Small | No | No | None. |
| Guardrail rules | `components/guardrails/GuardrailRules.tsx` | props | Small–medium (≤100) | No | Low | Defer. |
| Presidio recognizers | `components/guardrails/PresidioRecognizers.tsx` | Presidio API | Small | No | No | None. |
| Regulatory activity | `app/(console)/(governance)/regulatory/page.tsx` | rollups, `.slice(0,8)`/`.slice(0,25)` capped | Yes (hard-capped) | capped-slice | No | None — already capped. |
| Provenance | `app/(console)/(governance)/provenance/page.tsx` | rollup rows | Small–medium | No | Low | Defer. |

### Insights / observability / analytics
| Surface | Component | Data source | Bounded? | Paginated? | Needs? | Action |
|---|---|---|---|---|---|---|
| SIEM events | `components/siem/SiemEventsTable.tsx` | `readSiemView` (≤500) | No | **Now yes** | Yes | **APPLIED** (client). |
| SIEM monitors | `components/siem/AlertingManager.tsx` | OpenSearch monitors | Small–medium | No | Low | Defer. |
| SIEM suppressions | `components/siem/SuppressionManager.tsx` | suppression API | Small–medium | No | Low | Defer. |
| Langfuse traces | `components/observability/LangfuseTraces.tsx` | SSR props (server window) | server-windowed | **Now yes** | Yes | **APPLIED (#130)** — `key:'traces'`, 25/page. |
| Langfuse insights | `components/observability/LangfuseInsightsPanel.tsx` | `/api/…/traces/insights` | Small | No | No | None. |
| Langfuse registry | `components/observability/LangfuseRegistryPanel.tsx` | Langfuse API | medium | No | Low | Defer. |
| Analytics alerts/views | `components/analytics/AnalyticsAlerts.tsx` | `/api/…/analytics/*` | Small (≤50) | No | No | None. |
| Threshold rules | `components/observability/ThresholdManager.tsx` | `/api/…/thresholds` | Small–medium | No | No | None. |
| Drift | `app/(console)/(insights)/drift/page.tsx` | rollup, capped slices | Yes | No | No | None. |
| Accounting rows | `app/(console)/(insights)/accounting/page.tsx` | `computeAccounting` aggregations (by actor/project/model) | bounded by distinct dims | No | No | None — aggregation rollups, not raw rows. |
| FinOps by-key/model/subject | `app/(console)/(insights)/finops/page.tsx` + `components/finops/KeysTable.tsx` | `computeFinOps` rollups | by-key: **now yes** | by-key **Now yes** | by-key Yes | **APPLIED (#130)** to by-key (`KeysTable`, `key:'keys'`, 25/page). by-model/by-subject left — bounded by distinct model/subject count. |
| Token budgets | `components/finops/TokenBudgets.tsx` | `/api/v1/finops/budgets` (poll) | Small–medium | No | Low | Defer. |

### Gateway
| Surface | Component | Data source | Bounded? | Paginated? | Needs? | Action |
|---|---|---|---|---|---|---|
| Gateway logs | `components/gateway/GatewayLogs.tsx` | server cursor (`from/size=50`) | server-paged | **Yes** ("Load more") | has it | Keep — cursor append is correct for a log feed. |
| Gateway traffic (recent) | `components/gateway/GatewayTraffic.tsx` | live poll (3s) | live tail window | No | **No** | None — a live-refreshing tail; page-numbers over a 3s-mutating feed would be jarring. Bounded by design. |
| Gateway API keys | `components/gateway/GatewayApiKeys.tsx` | `/api/…/gateway-keys` | Small–medium (≤100) | No | Low | Defer. |
| Gateway tokens/cost/usage | `components/gateway/Gateway{Tokens,Cost,Usage}.tsx` | analytics rollups | bounded by model count | No | No | None. |

### Data / knowledge / retrieval
| Surface | Component | Data source | Bounded? | Paginated? | Needs? | Action |
|---|---|---|---|---|---|---|
| Lineage | `app/(console)/(data)/lineage/page.tsx` | rollup rows | Small–medium | No | Low | Defer. |
| Retrieval collections | `components/retrieval/RetrievalManager.tsx` | `/api/…/retrieval` | Small–medium | No | No | None. |
| Storage browser | `components/storage/StorageBrowser.tsx` | object listing | **potentially large** | **Now yes** | **Yes** | **APPLIED (#130)** — folder tiles (`key:'folder'`) + in-folder files (`key:'file'`), 24/page each, over the filtered set. |

### Build / studio / agents / apps  — **OWNED ELSEWHERE, DO NOT EDIT (deferred)**
| Surface | Component | Needs? | Action |
|---|---|---|---|
| Agent runs | `components/agent-runs/AgentRunsManager.tsx` | Yes — run history grows unbounded | **Needs pagination — deferred (owned elsewhere: agentrun/app-run domain).** |
| Agent runs tabs | `components/agent-runs/AgentRunsTabs.tsx` | Yes | **Deferred (owned elsewhere).** |
| App run status/reports | `components/build/AppRunStatus.tsx`, `app/(console)/(build)/apps/**` | Yes (`limit=200` fetch, all rendered) | **Deferred (owned elsewhere: app-run*).** |
| Agents grid | `components/agents/AgentsGrid.tsx` | Low–maybe | **Deferred (owned elsewhere: build/studio).** |
| Apps list | `components/build/AppsList.tsx` | Low–maybe | **Deferred (owned elsewhere: build/studio).** |
| Eval defs / golden cases / templates | `components/evals/*` | Low–medium | **Deferred (owned elsewhere: evals).** |
| Tool / MCP catalog | `components/tool-catalog/*` | maybe | **Deferred (owned elsewhere: tool-catalog).** |
| Studio gallery | `components/studio/StudioGallery.tsx` | maybe | **Deferred (owned elsewhere: studio).** |

### Other
| Surface | Component | Data source | Bounded? | Paginated? | Needs? | Action |
|---|---|---|---|---|---|---|
| Secrets | `components/secrets/SecretsManager.tsx` | `/api/…/secrets` | Small–medium | No | Low | Defer. |
| Leases | `components/secrets/LeasesPanel.tsx` | per-prefix | Small–medium | No | Low | Defer. |
| Feature flags | `components/config/FlagManager.tsx` | `/api/…/flags` | Small (≤50) | No | No | None. |
| Backups | `components/backups/BackupsManager.tsx` | props + fetch | retention-bounded | **Now yes** | Yes | **APPLIED (#130)** — `key:'backups'`, 25/page. |
| Fleet tools / device software | `components/fleet/*` | fleet API | Small | No | No | None. |
| Prompts library | `components/prompts/PromptLibrary.tsx` | `/api/v1/prompts` (search) | search-filtered | **Now yes** | Yes | **APPLIED (#130)** — `key:'prompts'`, 12/page over the search/tag-filtered set. |
| Artifacts browser | `components/artifacts/ArtifactsBrowser.tsx` | `/api/v1/chat/artifacts` | client grid | **Now yes** | Yes | **APPLIED (#130)** — `key:'arts'`, 12/page over the search-filtered set. |
| Chat conversations | `components/chat/ChatWorkspace.tsx` | `.slice(0,9)` capped sidebar | Yes (capped) | capped-slice | Low | Defer — sidebar already capped. |

---

## Summary

- **Surfaces inventoried:** ~40 across governance, insights, gateway, data, build/studio, admin, chat, prompts, artifacts, fleet, finops, siem.
- **Already had pagination (kept):** 2 — audit log (server link-pager), gateway logs (server cursor "load more").
- **Applied the common control (TASK #123):** 2 — SIEM events (≤500 rows), SIEM full-text search hits.
- **Applied the common control (TASK #130):** 7 — Storage browser (folder + file grids), Langfuse traces, Users list, Backups, FinOps by-key, Prompts library, Artifacts library. All client-side slices over the fetched array, namespaced URL keys, filters preserved.
- **Needs pagination — deferred (owned elsewhere):** 8 (agent-runs ×2, app-run status/reports, agents grid, apps list, evals ×, tool/mcp catalog, studio gallery). Logged for the owning agents.
- **No pagination needed (bounded/rollup/capped/live-tail):** the majority — roles, IdP, policy/rego/guardrail/presidio rules, thresholds, analytics alerts, accounting & finops rollups, gateway token/cost/usage, gateway traffic live-tail, feature flags, fleet, regulatory/drift/chat capped slices.
