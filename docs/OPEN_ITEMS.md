# OPEN ITEMS — the single authoritative "what is actually still open" list

**This file supersedes the open-status scattered across the other ledgers.** It was produced by a
reconciliation pass (2026-07-09) that VERIFIED every candidate-open item from all the gap/status docs
against the current `src/` code AND the live deployment on S1 (via the tunnel + break-glass admin
bearer) — not trusted from the doc. The source ledgers (`GAPS_BACKLOG.md`, `VERIFICATION_GAPS.md`,
`HARDENING_AUDIT.md`, `ROADMAP_STATUS.md`, `USE_CASES_PLAN.md`, `OSS_CAPABILITY_AUDIT.md`,
`UX_AUDIT.md`, etc.) remain as append-only history; **read this for the current truth.**

## Tally

- **~470 candidate-open lines** were extracted across the docs (the bulk being the 190-row
  `OSS_CAPABILITY_AUDIT.md`, the 48-row `UX_AUDIT.md`, and the 52-row insurer parity list).
- **~440 are STALE / RESOLVED / out-of-scope-by-design** this pass (see "Verified resolved" below).
- **28 are genuinely OPEN**, listed here.
- **0 are demo-blockers.** The live surfaces the demo leads with (warehouse, PII/Presidio, SIEM,
  traces, evals, drift, provenance, governed agent-runs, brain, connectors, app-runs, FinOps,
  cloud-routing invariant, per-tenant scoping) are all PROVEN LIVE (see `VERIFICATION_GAPS.md`
  2026-07-09 § "13 surfaces PROVEN LIVE" + § Reconciliation).

### Demo-blocker list

**None.** The Phase-F live sweep (2026-07-09) confirmed the demo path works end-to-end. The two 🔴
gaps found that day (G-F1 subdomain scoping, G-F2 Indian PII) were BOTH fixed + verified live the same
day (`VERIFICATION_GAPS.md` § Reconciliation 2026-07-09). Everything below is post-demo hardening,
config/on-site flips, or pre-GA design.

---

## (A) Demo-blockers

_None._ Confirmed by the live Phase-F sweep + same-day reconciliation.

---

## (B) Real gaps — non-blocking (code-side, ship when convenient)

| id | Description | Prio | Demo-blocker | Effort | Evidence it's open |
|----|-------------|------|--------------|--------|--------------------|
| PA-11 | Public per-pipeline run route (`POST /api/v1/pipeline/[id]/run`) does REAL key-auth + governed routing/egress decision + audit, but returns a governed **plan (202)** — it does not dispatch the resolved gateway/model or run output masking. Pipelines have no standalone executor. | P1 | no | M | `src/app/api/v1/pipeline/[id]/run/route.ts:24-28,88,115` — explicit "Model execution wiring is pending (gap)" + returns `status:202 {plan}`. |
| PA-16a-durable (agent) | The DURABLE agent-run path does not carry/enforce the pipeline contract. `agent-run.activities.ts` has no `resolveContract`/`enforceDataAccess`/`enforceModelCall`, and `AgentRunWorkflowInput` has no `contract` field — so a durably-dispatched agent run is not contract-gated (sync path IS). NB: the durable APP-run path IS now enforced (worker resolves + threads the contract). | P1 | no | M | `grep contract src/worker/agent-run.activities.ts` → empty; `src/lib/agent-run-durable.ts` `AgentRunWorkflowInput` (lines 16-27) has no `contract`. Contrast `src/worker/app-run.activities.ts:43,73` which DOES. |
| PA-16c | Overlay-driven PII-mask escalation deferred. `enforceModelCall` returns `requirePiiMasking`/`blockPromptInjection`, but the run paths rely on the org-locked guardrail floor rather than escalating masking when the pipeline overlay tightens it on. | P2 | no | S | `docs/GAPS_BACKLOG.md` PA-16c (still listed open in the 07-09 reconciliation). Floor masks today; overlay-tighten delta unwired. |
| PA-10 | Gateway PATCH silently no-ops on a PARTIAL body: `validateGatewayUpdate` delegates to `validateGatewayCreate` (needs name/kind/baseUrl), so a `{defaultModel}`-only PATCH fails validation. The edit UI always sends the full shape, so the user-facing edit works. API partial PATCH should merge-onto-row or 400, not silent-fail. | P2 | no | S | `src/lib/gateways-policy.ts:194-196` (`validateGatewayUpdate` → `validateGatewayCreate`); `src/lib/gateways.ts:177-196` `updateGateway` sets all 5 fields, no read-modify-write merge. |
| PA-13 | Cosmetic: revoked "audit-test-key" rows linger on the Loan Underwriting seed pipeline. Harmless (revoked). | P2 | no | XS | `docs/GAPS_BACKLOG.md` PA-13 (unchanged). |
| insurer-connectors-selfserve | Connectors are not truly self-serve from the UI for a non-technical user: create takes name+type+endpoint but the browse-tables / guided-cred flow is thin. (Test-connection IS wired — `/admin/connectors/[id]/test` returns real `{ok, dialect}` live.) The founder's north-star persona (tax/accounting staff) can't fully wire a source unaided. | P1 | no | L | `src/app/api/v1/admin/connectors/[id]/test/route.ts` exists + live-verified `ok:true`; no `listTables`/`browseTables` route found; insurer§12-E1 flags "the crux." |
| insurer-connector-creds-vault | Connector credentials are stored in the plaintext `connectors.endpoint` column (e.g. `mssql://sa:PASS@…`), not vaulted in OpenBao. | P1 | no | M | `src/lib/store.ts:65,614,698` — `endpoint text NOT NULL`; creds embedded in the URL. insurer§12A-P0-2. |
| insurer-triggers | Real input triggers beyond on-demand are code-present but unwired/no-callers: schedule trigger + email-in (IMAP poller) + WhatsApp. Needed for the "app runs itself on an event" story. | P1 | no | M | insurer§12A-2/3/4, §12-E3; `docs/GAPS_BACKLOG.md` "report/email/whatsapp sinks defer delivery." Triggers implemented, zero callers, env unset. |
| insurer-output-sinks | `report` / `email` / `whatsapp` output sinks defer delivery at run time — the step succeeds but nothing is delivered. The real signed-PDF path is the separate on-demand `GET .../report` route, not the run sink. No SMTP path. | P1 | no | M | `src/lib/app-run.ts:348-356` (`executeOutputStep` records intent + "delivery deferred" note); documented in `docs/user/app-reports.md`. |
| insurer-agents-framework | Agents are not yet framework-grade (plan / tool-loop / multi-agent-orchestrate like CrewAI/LangChain/Agno). insurer §14A calls this "the one to prioritize / highest value." | P1 | no | L | `USE_CASES_PLAN.md` §14-15 + §14A:469 "BUILD (highest value)". |
| insurer-prompt-playground | Prompt playground + partials (reusable fragments) + fuller guardrail action set — real UX/enforcement value for the non-technical author. (§14A W3 "in flight".) | P2 | no | M | `USE_CASES_PLAN.md` §14-1/4/5, §14A:470. |
| insurer-web-search-tool | Online web-search primitive (Exa/Tavily-style) as a governed TOOL under the egress leash — reconcile env names + thread web_search egress through `enforceModelCall`. | P2 | no | S | `USE_CASES_PLAN.md` §14-13/17, §14A:467. |
| IA-nav-dedup | Nav IA overlap: "Knowledge" appears in Workspace AND as "Agent knowledge base"/"Retrieval" in Brain; "Tools" appears twice (Build›Tools + Brain›Tools). Stores were deduped (#134); the NAV still overlaps. | P2 | no | S | `USE_CASES_PLAN.md:471` unchecked `[ ]`. |
| DSAR-propagation | Right-to-erasure runs real DELETEs across console-owned tables + returns `{erasedRows, deferred}`, but vector-index / external-lake / device-replica propagation is reported as `deferred` (needs those stores' seams). Honest, not silently stubbed. | P2 | no | M | `VERIFICATION_GAPS.md` S6 (🟡 executes + honest); `src/lib/erasure.ts`. |

---

## (C) On-site / infra — need the box or a maintenance window (NOT a code change)

| id | Description | Prio | Demo-blocker | Effort | Evidence it's open |
|----|-------------|------|--------------|--------|--------------------|
| G-F3 | Grounding verification runs on the **heuristic/lexical fallback**, not model-NLI. `modelGrounding` adapter EXISTS in code (`grounding.ts:106`, registry prefers it) but falls back because no gateway-NLI endpoint is configured. Live paraphrase probe → `score:0, supported:false`. | P2 | no | S (config) | Live: `POST /api/v1/admin/grounding/verify {"answer":"the sky is blue during the day","sources":["the sky is blue"]}` → `score:0`. No `OFFGRID_ADAPTER_GROUNDING` in server `.env.local`. Fix = point env at a reachable NLI adapter. |
| G-F4 | Data-quality engine is a stub. `GET /data-quality` → `engine:"fallback (stub)", url:…:8944`. Real Great-Expectations service not running; 0 expectations seeded. | P2 | no | M (infra) | Live: `GET /api/v1/admin/data-quality` → `{"healthy":true,"engine":"fallback (stub)","url":"http://127.0.0.1:8944"}`. `OFFGRID_DATAQUALITY_URL` set but no GE behind it. |
| S3 | cloudflared on S1 not managed by launchd (relies on `kill -HUP`); consolidate to ONE daemon under a KeepAlive launchd job so reloads/restarts survive reboot. (The stale-duplicate 404 was already fixed; this is the durability hardening.) | P1 | no | S (on-site) | `VERIFICATION_GAPS.md` S3 (🟡); `launchctl … co.getoffgridai.cloudflared` → "not found." |
| PA-15-tail | Per-tenant gateway BACKEND routing: add tunnel ingress `*-gateway.getoffgridai.co → :8800` above the wildcard + aggregator resolves tenant by Host. App-side host helper (`tenantGatewayHost`) + resolver are DONE + tested; only the supervised tunnel edit remains. | P2 | no | M (on-site) | `docs/GAPS_BACKLOG.md` PA-15; `SESSION_HANDOFF.md` "PA-15-tail … supervised tunnel edit." |
| #32 (A4 off-host) | True external-unreachability proof (`curl offgrid-s1.local:9200/:8181/:9000 → refused`) from a NON-S1 LAN host. The on-S1 loopback bind-check (harness A4 PASS) stands in for it. Needs a second machine on the LAN. | P2 | no | XS (manual) | `ROADMAP_STATUS.md` bucket (c); harness A4 is a bind-check, off-host curl never recorded. |
| #9 Superset | Embed + provisioning code built; no real dashboard provisioned over the audit index (points at a ghost UUID until run). | P2 | no | S (on-site) | `GAPS_BACKLOG.md` #9; `ROADMAP_STATUS.md` bucket (b). |
| #28 backups restore | Backup surface + on-demand run/prune/restore built; the scheduled launchd job isn't bootstrapped and a full restore drill hasn't been run end-to-end. | P2 | no | M (on-site) | `GAPS_BACKLOG.md` #28; `ROADMAP_STATUS.md` bucket (b). |
| native-OIDC | Per-service direct KC-token validation path is documented + ready; brokered path is live. Flip is opt-in, service by service (OpenSearch first). | P2 | no | M (on-site) | `ROADMAP_STATUS.md` bucket (b); `service-credentials-lib.ts` TODO. |
| RLS-backstop | Postgres RLS pure policy + idempotent SQL exist; no-op until the app's `DATABASE_URL` is switched to the non-superuser role + `app.current_org_id` GUC set per request. Query-layer org filter is the live boundary today. | P2 | no | M (on-site) | `ROADMAP_STATUS.md` bucket (b); `src/lib/rls-policy.ts`, `deploy/onprem/2026-rls-backstop.sql`. |

---

## (D) Pre-GA design work (larger; not v1-blocking, founder-confirmed fixable within the model)

| id | Description | Prio | Demo-blocker | Effort |
|----|-------------|------|--------------|--------|
| PA-3 | Flat org — no team/BU tier. Add a `workspace`/team tier between org and consumer; per-team RBAC + budgets + delegated available-pipelines. | P1 | no | L |
| PA-6 | FinOps won't scale + on-prem GPU cost is unmodeled. Add rollup tables/materialized views over the run fact-table; define a $/GPU-hour → $/token model. | P1 | no | M |
| PA-8 | Chat bound to ONE pipeline is too rigid. Let chat select among multiple allowed pipelines as tools. | P1 | no | M |
| PA-4 | ABAC attribute sourcing + latency. Wire fresh IdP claims → OPA input; measure/budget per-request policy latency; cache attrs with TTL. | P2 | no | M |
| PA-9 | Gateway-vs-pipeline routing wording confuses operators. Doc + UI clarification (gateway = intra-backend nodes; pipeline = inter-gateway + model choice + egress leash). | P2 | no | XS |
| Phase 3A HA/DR | Nomad orchestration, Patroni/Raft HA, VictoriaMetrics alerting, DR runbooks — infra track, largely not started; not blocking single-node operation. | P2 | no | L |
| Phases 5–8 | Unified API (partial), `defineOffgrid` module spine, `@offgrid/sdk` (SDK page placeholder), Soul (blocked on desktop/mobile capture) — future phases. | P2 | no | L |
| Docs polish | #23 first-party SDK page (lands with Phase 7), #24 ⌘K docs search, #21 more guide screenshots, DEMO_WALKTHROUGH refresh. | P2 | no | S–M |

---

## Verified RESOLVED this pass (do NOT re-log — proof recorded)

- **Phase-F live sweep (2026-07-09, VERIFICATION_GAPS.md):** Presidio (`engine:presidio`, #2), SIEM
  audit index (V2/#6, `total:220`), traces render (V3/#5), evals real scorer (`ragas`), drift native,
  provenance sign→verify (Ed25519 tamper-evident), governed agent-run chain, brain ingest+search (S1),
  connector reachability, app-runs, FinOps, cloud-routing fail-safe-to-local invariant (D2), data plane
  counts. All 🟢 PROVEN LIVE.
- **Same-day reconciliation (2026-07-09):** G-F1 subdomain org-scoping for bearer/service (`bindTenantOrg`
  feeds `currentOrgId` the verified principal — proven: `bharatunion-…` host → org_bharat apps, no leak) →
  🟢; G-F2 Indian BFSI PII (`IN_PAN` masked, `engine:presidio`) → 🟢; PA-16a **app-run** durable enforcement
  → 🟢 (`app-run.activities.ts` `resolveContractActivity` + `executeStepActivity(...contract)`); durable
  workers ON (`OFFGRID_QUEUE_ENABLED=1` live, #12/#114); chat governance durable+guarded (PA-16b chat).
- **Hardening (code-verified this pass):** #122/HA-1 vectordb (`requireAdmin` present),
  #123/HA-2 device data-plane (`gateDeviceRequest` + `verifyDeviceToken`), #124/HA-3 client-secret GET
  (`requireAdmin` + `auditFromSession`), #125/HA-4..8/12/13 privileged-mutation audit (kill/erasure/
  users/roles/provision all emit), #126/HA-9 `listIngestJobs` org-scoped (`ingest_jobs.org_id`),
  #127/HA-10 masking-rule org, #131/HA-14..18 fleet/tenant/org-settings/backup-prune audit (all emit).
- **Temporal jobs surface:** #34 cancel/terminate audit (`cancel/route.ts:30` `auditFromSession`),
  #35 `runIdFromWorkflowId` hyphen-safe (`temporal-visibility.ts:138-159` prefix-anchored scan).
- **UX audit T1-T6 program (SESSION_HANDOFF 2026-07-08):** OSS-name scrub (T1), pipeline join-key
  visibility (T2), constrained governance inputs + guardrails scope (T3), RESTful URL hierarchy +
  redirects (T6), loading skeletons (T5). T4-tail knowledge list→detail RESOLVED (rows now
  `href={/workspace/knowledge/${c.id}}`). Analytics now data-wired (`computeAnalytics` + pipeline facet).
- **Integration correlation:** #29 C4 probe, #30 evals-adapter auth, #31/#33/#36..40, S4/S5/S7/T2/PA-14
  — all resolved with evidence in their source ledgers.
- **OSS_CAPABILITY_AUDIT.md (OCA-1..190):** NOT gaps — this is a deliberate capability/scope audit
  ("we use LanceDB not pgvector", "Caddy does the WAF/rate-limit not the aggregator", most Keycloak/
  Temporal/OpenSearch deep features intentionally unused). Excluded from the open list by design; the
  few that overlap a real gap (Presidio custom recognizers, Superset dashboard, backups) are captured
  above under their canonical id.

---

_Reconciled 2026-07-09. Method: extract every 🔴/🟡/TODO/OPEN/pending/stub/deferred/`[ ]` line from all
docs → verify each against `src/` (grep the cited file/symbol) + the live console on S1 (tunnel + admin
bearer) → classify RESOLVED (with file:line or live snippet) / OPEN (with the concrete missing piece) /
STALE. Nothing marked resolved without proof; nothing listed open that the code already fixed._
