# Gaps backlog — the working list

> **SOURCE OF TRUTH for what's OPEN is now [`docs/OPEN_ITEMS.md`](OPEN_ITEMS.md)** (reconciled + live-verified 2026-07-09: 28 genuinely open, 0 demo-blockers; ~440 candidate lines verified stale/resolved/out-of-scope). This file stays as append-only history — check OPEN_ITEMS.md before assuming anything below is still open.

Consolidated, prioritized gaps from the demo walkthrough, service-capability audit, docs audit, and
the cross-cutting mandates. This is the list we work from. Sources: `DEMO_WALKTHROUGH.md`,
`SERVICE_CAPABILITY_AUDIT.md`, `DOCS_GAPS.md`, `ROADMAP.md` (mandates).

**Priority:** P0 = before the demo · P1 = high-value next · P2 = later.
**Owner:** `console` (my domain) · `infra` (aux tier / fleet — coordinate with the other session).
**No mock data** — anything below is either real config, wiring to a live service, or a build task.

---

## OPEN NOW — current working set (index, 2026-07-08)

> This file is append-only history; most numbered items below are already ✅ RESOLVED inline. This
> index is the **actually-open** set. Everything not listed here is done (search the item for its ✅).

**Phase F verification found (2026-07-09, LIVE) — new:**
- **G-F1 (P0, `console`)** — **subdomain org-scoping does NOT engage for bearer / service-account
  requests.** Confirmed live: `GET /apps` on `bharatunion-onprem-console.getoffgridai.co` returns the
  `default`-org apps (`orgId:"default"`), never the 6 org_bharat apps in the DB — identical to
  `wednesdaysol-…` and to no-host. Root cause: `currentOrgId()` (`src/lib/tenancy.ts`) reads the
  tenant-binding role/org guard from NextAuth `auth()`, which is null for a bearer request (no session
  cookie) → `session.user.role` undefined → the admin/member guard never passes → returns `sessionOrg`
  (`default`). Fails **safe** (no cross-tenant leak) but machine principals can't be subdomain-scoped and
  it blocks per-tenant verification via the admin token. Supersedes/root-causes S2 + T3 scoping.
  Fix: feed `currentOrgId`'s guard the SAME principal `requireUser` resolves (verified bearer claims /
  break-glass admin), not only the cookie session. Ship with the org-isolation integration tests.
- **G-F2 (P1, `console`+`infra`)** — **Indian BFSI PII (PAN / Aadhaar / IFSC / UPI) not recognized by
  either PII path.** `/pii/scan` runs real Presidio (catches EMAIL/CARD/etc.) and `/guardrails` demo
  runs regex, but neither detects the tenant's actual PII types (PAN `ABCDE1234F`, masked Aadhaar). Add
  custom Presidio recognizers (or regex patterns) for `IN_PAN`/`IN_AADHAAR`/`IN_IFSC`/`IN_UPI`. Also
  reconcile the two scan paths so the `/guardrails` demo uses the real adapter, not `demoScan`/regex.
- **G-F3 (P2, `console`)** — **grounding verification is on the heuristic/lexical fallback**, not
  model-NLI. Exact-overlap source → supported; a paraphrase → unsupported (`score:0`). Set
  `OFFGRID_ADAPTER_GROUNDING` to a model-NLI adapter (service reachable) for entailment-grade checks.
- **G-F4 (P2, `infra`)** — **data-quality engine is a stub.** `GET /data-quality` → `engine:"fallback
  (stub)"` (:8944); `/data-quality/run` reports `engineReachable:true` but evaluates 0 expectations.
  Wire the real Great-Expectations service + seed expectations for the bharat catalog.

**Pipelines × Gateways (the active epic — all code-side, mostly small):**
- **PA-16a/b/c** — finish run-time enforcement: durable (Temporal) app-run path, agent-run + chat paths
  (seam built, not called), overlay PII-mask escalation. *App-run inline path IS enforced + shipped.*
- **PA-11** — public pipeline run route does key-auth + governed decision but doesn't fully EXECUTE the model.
- **PA-10** — gateway partial-PATCH edge (UI path works; API partial body should merge or 400). Small.
- **PA-13** — cosmetic: purge revoked test keys on the Loan Underwriting seed pipeline. XS.
- **Residual verify** — exercise a live app-run against a restrictive pipeline through the UI (enforcement is test-proven, not UI-run).

**Enterprise-readiness design gaps (larger, pre-GA):** PA-3 (team/BU tier), PA-6 (FinOps rollups +
on-prem cost model), PA-8 (chat → multiple pipelines), PA-9 (routing wording), PA-4 (ABAC attr sourcing).

**Supervised / on-site (need the box or a maintenance window — NOT code):**
- **PA-15** — per-tenant gateway URLs: tunnel-ingress `*-gateway → :8800` + aggregator resolves-by-host (host helper done).
- **#2** — Presidio via edge-Caddy reload (guardrails run the regex floor until then).
- **#12 / HITL** — flip durable dispatch ON: bootstrap the Temporal `offgrid-agents` + `offgrid-apps` workers + `OFFGRID_QUEUE_ENABLED` (code complete; off in prod).
- **#32** — A4 off-host unreachability curl from a non-S1 host.

**Older still-open (verify-then-fix — some may be stale):** #6 (seed `offgrid-audit` index), #9 (Superset
dashboard), #34 (Temporal cancel/terminate audit — P1), #35 (runIdFromWorkflowId hyphen-fragility — latent),
#121 (durable-worker PII deep-config), report/email/whatsapp sinks defer delivery, #26 (cloud routing —
recheck: OpenRouter was wired since this was written), #28 (backups restore e2e). Build gaps #13–20 are
future features, not defects.

**Housekeeping:** consider archiving the ✅-resolved rows to a `GAPS_ARCHIVE.md` so this file shows only
open work — deferred (low value vs. the git history that already records them).

---

## P0 — before the demo
| # | Gap | What to do | Owner | Effort |
|---|---|---|---|---|
| 1 | ✅ **DONE (2026-07-05)** — Routing rules seeded on live console: `data_class=pii→local`, `confidential→local`, `restricted→block`, `public→cloud (fallback local)`. Verified via `/routing/evaluate` — all enforced by `decideRouting`. Demo note: egress switch is ON so `public`→cloud; flip egress OFF to show `public` leashing to block. | console | ✅ |
| 2 | 🟡 **Presidio DEFERRED (2026-07-05)** — Presidio is live on g6 and reachable from a shell, but the launchd next-server can't reach a standalone loopback forwarder (fresh `node` can — a macOS launchd loopback quirk). Fix = add `8938→g6:5002`/`8939→g6:5001` to the **edge Caddy** (staged in Caddyfile) + set `OFFGRID_ADAPTER_GUARDRAILS=presidio`+URLs, but that needs an edge-Caddy reload (admin off, unsupervised, fronts the public tunnel → on-site/maintenance window). Guardrails runs the regex floor until then. | console + infra | S |
| 3 | **No real knowledge to ground on** | Upload 1-2 of the org's *real* docs (not fabricated) so Chat grounding + a Studio assistant have genuine content. Needs Mac's real docs. | Mac + console | XS |
| 4 | **Decide demo path** | From `DEMO_WALKTHROUGH.md`: lead with the 🟢 pages; skip 🔴 (SIEM/Lineage/Secrets) unless their services get started. | Mac | — |
| 5 | **Confirm Langfuse traces render** | Langfuse is up on g6; verify Observability actually shows traces before demoing it. | console | XS |

## P1 — integration wiring (start service → set env → real data, no mocks)
| # | Gap | What to do | Owner | Effort |
|---|---|---|---|---|
| 6 | 🟡 **SIEM/audit search empty** — CAUSE FOUND (2026-07-05): OpenSearch IS up on S1 (`offgrid-services-a`), but the SIEM view reads `OFFGRID_SIEM_INDEX=offgrid-audit`, a DIFFERENT index than Analytics (`offgrid-gateway`). `offgrid-audit` doesn't exist until `shipAudit()` writes. `OFFGRID_OPENSEARCH_URL` now set → generate governed runs to seed `offgrid-audit`, then SIEM populates. | console | S |
| 7 | ✅ **DONE (2026-07-05)** — Lineage wired: Marquez was already up on S1; set `OFFGRID_MARQUEZ_URL=http://127.0.0.1:9000` + `OFFGRID_ADAPTER_LINEAGE=marquez`. Connected to `default` ns; graph fills once runs emit OpenLineage. | console | ✅ |
| 8 | ✅ **DONE (2026-07-05)** — Secrets wired: OpenBao was already up on S1; enabled KV v2 at mount `secret`, set `OFFGRID_ADAPTER_SECRETS=openbao` + URL + token `offgrid-dev-token`; seeded 3 real secrets. Page shows openbao, reachable, unsealed. | console | ✅ |
| 9 | **Superset dashboard** | Embed wired, but no dashboard provisioned. Provision one real dashboard over the audit index. | console | M |

## P1 — UX debt (the mandates)
| # | Gap | What to do | Owner | Effort |
|---|---|---|---|---|
| 10 | **No-modals conversion** | Convert every create/edit dialog → its own page (or side panel); keep only delete-confirm modals. Affects: connector add/edit, agent create, project, studio, machine-client, routing-rule add, threshold/suppression/masking editors, book-a-call, write-to-us, skills. | console | L |
| 11 | **Motion pass** | Per the finesse mandate — entrance/hover/press across surfaces (primitives done; per-surface remains). | console | M |

## P1/P2 — build gaps (functionality not yet reachable from the console)
| # | Gap | Service | Owner | Effort |
|---|---|---|---|---|
| 12 | **✅ CODE + LIVE-VERIFIED (dispatch off in prod)** — ~~Temporal durable agent runs (scaffold only).~~ The full durable path is built AND was verified live on S1 (2026-07-07): `AgentRunWorkflow` + `runAgentPipeline` activity wrap the real `runAgent` pipeline on the `offgrid-agents` queue, submitted via `dispatchAgentRun` (pure decision in `agent-run-durable.ts`, thin I/O in `adapters/agentruntime.ts`). This branch closed the last inline holdouts — ALL agent-run trigger routes (`/admin/agents/runs`, `/admin/run`, both reruns) now route through `dispatchAgentRun`, so test-runs + reruns inherit durability; each surfaces its mode (durable/sync/pending) honestly. A live run executed durably (`temporalStatus: COMPLETED`, `historyLength: 11`), persisted (status `done`, 8 steps, provenance), and is visibility-queryable. **Remaining (infra flip, not code): durable dispatch is OFF in prod** — `OFFGRID_QUEUE_ENABLED` empty + the `co.getoffgridai.agent-worker` plist not bootstrapped, so runs default to synchronous in-process. Bootstrap the worker + flip the flag to turn it on (see SERVER_STATE.md § Durable agent-run worker). | console + infra | L |
| 13 | **FleetDM live-query + software inventory** | osquery live query UI + inventory. | console | M |
| 14 | **OPA Rego bundle editor** | author/deploy Rego from the console (first-party ABAC is covered). | console | M |
| 15 | **Aggregator cache / rate-limit / fallback tuning** | expose in the Gateway page. | console + infra | M |
| 16 | **Presidio custom recognizers UI** | manage custom PII recognizers. | console | M |
| 17 | **Langfuse score charts / cost→FinOps from traces** | mirror score trends; today FinOps is from the audit log. | console | M |
| 18 | **OpenSearch aggregation dashboards + alert rules** | charts + alerting on the event index. | console | M |
| 19 | **Unleash variants / gradual-rollout editor** | beyond on/off flags. | console | S |
| 20 | **Backups: schedule control + restore-from-UI** | schedule is view-only; wire control + restore. | console + infra | M |

## Docs depth (from DOCS_GAPS.md)
| # | Gap | Owner |
|---|---|---|
| 21 | ✅ **DONE (2026-07-06)** — 14 fresh module screenshots optimized (`sips -Z 1400`, ~2.8 MB total) into `public/docs-shots/` and referenced in the matching capability guides (overview, chat, knowledge, agents, gateway, control, guardrails, policy, provenance, audit, accounting, lineage, retrieval, fleet). `DocsMarkdown` got a styled `img` renderer (bordered/rounded/lazy, alt as caption) — plain markdown `![alt](/docs-shots/x.png)`, no new type field, static-export clean. | console + Mac |
| 22 | ✅ **DONE (2026-07-06)** — Syntax highlighting via **rehype-highlight** (`highlight.js`) wired into the docs code renderer as a `rehypePlugins` entry: highlights at render → SSR/SSG-safe (verified `hljs-*` spans present in `.next/server/app/docs/api/chat.html`, no client-only hack). Copy button + heading anchors intact; copy button recovers raw source through nested highlight spans via the pure, unit-tested `src/lib/docs/node-text.ts`. A brand-matched hljs theme (emerald/mono, light+dark) lives in `globals.css` instead of a third-party stylesheet. Per-connector setup detail left for a follow-up. | console (needs a dep) |
| 23 | First-party SDK page (once Phase 7 exists) | console |
| 24 | Docs search is sidebar-inline; consider ⌘K parity | console |

## Product/doc mismatches to reconcile (verify, then fix wording or build)
| # | Item |
|---|---|
| 25 | ✅ **RESOLVED (2026-07-06)** — Provenance signing IS default-on for **agent runs**, NOT export-only. `src/lib/agentrun.ts` stage 7 signs every answered run UNCONDITIONALLY (no feature flag, no `if`) via `getSigning()` over `{runId, agentId, query, answer, refs}`, and persists the `provenance` record (signature/algorithm/publicKey/signedAt) to `agent_runs`; the runId is embedded as the correlation `provenanceRef` (C2). Report export (`/api/v1/admin/reports/[id]/export`) is a SEPARATE second layer — a detached file manifest — not the only signing path. **Nuance:** the default signing port is **native HMAC-SHA256** (`SIGNING_PORTS[0]`), not ed25519 — set `OFFGRID_ADAPTER_PROVENANCE=ed25519` for offline/public-key verification. **Chat runs (`chat-governance.ts`) are audit-only by design** (they write `audit_events`/`audit_events_v2` with actor/action/cost/outcome, but do NOT sign a per-message provenance record); provenance signing is scoped to governed agent/workflow runs, the answer-producing path. Verified by `test/provenance-default-on.test.ts` (signature round-trips + tamper-evidence + no flag gate in source) and surfaced as **provenance coverage %** on the Regulatory DPO view + DPIA activity export. |
| 26 | Cloud routing — framework exists, no cloud provider clients wired (local-only today) |
| 27 | Permissions-aware retrieval — real-time source-permission binding vs. project/ABAC scoping |
| 28 | Backups restore path — verify end-to-end; DR failover not configured |

## Notes
- The console covers the operational 80% of each service (CRUD + actions an operator needs); deep
  admin tails (Keycloak realm config, etc.) live in each service's own UI by design — not gaps.
- Genuine build gaps are #12–20. The demo-blockers are #1–5 (mostly config + real content, not
  builds).

---

## Integration sweep #1 (2026-07-06) — platform-integration cadence agent

**Live harness result (`deploy/verify-integration.sh` on S1, read-only):** `8 pass / 0 fail / 3 skip`.
This is a large step up from `INTEGRATION_SUCCESS_SPEC.md`'s recorded "GATE 1 only, nothing WIRED/
VERIFIED" (2026-07-05). Full line-by-line:

- PASS A1 (aggregator: minted Keycloak JWT → 200, garbage → 401)
- PASS A2 (all 5 clients mint `client_credentials` JWT with `aud == offgrid-<svc>`)
- PASS A3 (all 5 service secrets readable at `secret/<svc>/client-secret` in OpenBao)
- PASS A4 (opensearch/opa/marquez bound to loopback, not 0.0.0.0)
- PASS A5 (machine SA JWT → 200, unauth → 401 on `/api/v1/admin/agents`)
- PASS **C1** (governed run `run_7ac428c0` shows all stages: policy·guard·ground·sign)
- PASS **C2 — the money test** (`run_7ac428c0` correlated across ALL 4 planes:
  opensearch·langfuse·marquez·provenance all HIT)
- PASS **C3** (PII probe `run_bf0e5156` shows a pii/guard check that blocked/redacted)
- SKIP A7 (destructive rotate-and-reject — by design, not automated)
- SKIP B2 (network-boundary — real proof is A4 from a non-S1 host)
- SKIP B3 (transparent-refresh — needs forced token expiry)

**Coherence spot-check (code paths, not just the harness):**

- **C2 correlation is real and centralized.** `src/lib/correlation.ts` `correlationIds(runId)` derives
  all four plane ids from one runId (audit=verbatim, Langfuse trace=`normalizeTraceId`, Marquez=
  deterministic UUIDv5 `lineageRunUuid`, provenance=verbatim). This closes the biggest flagged unknown
  in `INTEGRATION_SUCCESS_SPEC.md` (C2 "NOT proven"). **Action: update the spec's status table + honest
  status line — C1/C2/C3 are now VERIFIED on the live box, not GATE 1.**
- **Identity is threaded through the durable path (C4 code-level).** `src/lib/agent-run-context.ts`
  (pure `CallerContext` rule) + `src/lib/agent-run-durable.ts` now carry the session actor, org,
  project, AND the canonical runId into a worker run, so its audit/trace/lineage/provenance fan-out is
  meant to match an inline run. This is newer than the spec/backlog (#12, C4 = "identity-in-activity
  not built"). **GAP: C4 is NOT probed by the harness** — the durable fan-out parity is unverified
  end-to-end. Add a C4 probe (run via worker, diff fan-out vs. C2) before claiming durable runs are
  integrated. Update backlog #12 to reflect the code now exists at GATE 1.

**New items found (not fixed — record only):**

| # | Gap | Where | Owner |
|---|---|---|---|
| 29 | **✅ CLOSED** — ~~C4 durable-run fan-out is unverified. The harness had no C4 probe.~~ Added a live `C4` check to `deploy/verify-integration.sh`: when the durable path is configured (`OFFGRID_QUEUE_ENABLED` truthy / `OFFGRID_ADAPTER_AGENTRUNTIME=temporal`) it submits one labelled durable run, verifies it completes, then runs the SAME 4-plane correlation as C2 (factored into a shared `four_plane_correlate` helper reusing the `uuid5` deriver) against its runId + best-effort audit-plane identity check; if not configured → SKIP (never FAIL). | `deploy/verify-integration.sh`, `src/lib/agent-run-durable.ts` | console + infra |
| 30 | **✅ CLOSED** — ~~A6/B1 residual static auth in `src/lib/adapters/evals.ts` (hard-coded `apiKey:'offgrid-local'`).~~ The promptfoo adapter now authenticates through the broker: `getServiceCredential('gateway')` → the shared pure `chooseGatewayAuth` rule → a new pure `selectPromptfooAuth`/`providerAuthFromHeaders` that maps a broker Bearer JWT to promptfoo's `apiKey` (preferred) or the legacy static key to an `x-api-key` header (fallback); unprovisioned degrades to the old placeholder, byte-identical to before. The Ragas/answer-gen fetches moved to `gatewayHeadersAsync`. Auth-selection unit-tested in `test/evals-adapter-auth.test.ts` (no mocks). | `src/lib/adapters/evals.ts` | console |
| 31 | **Spec status drift.** `INTEGRATION_SUCCESS_SPEC.md` still says "every item is GATE 1 only … nothing VERIFIED" (2026-07-05) and marks C2 correlation "NOT proven." The live harness now PASSES A1–A5 + C1–C3. The spec's status tables + "Honest status line" are stale and under-report reality — reconcile them. | `docs/INTEGRATION_SUCCESS_SPEC.md` | console |

**Not a regression:** the 3 SKIPs (A7, B2, B3) are all SKIP-by-design per the spec (destructive /
non-S1 / forced-expiry), so `0 fail` is a genuine clean run, not masked failures.

---

## Integration sweep #2 (2026-07-06) — platform-integration cadence agent

**Live harness result (`deploy/verify-integration.sh` on S1, read-only):** `8 pass / 0 fail / 3 skip`
— identical to sweep #1, reproduced on fresh run ids. Full line-by-line:

- PASS A1 (aggregator: minted Keycloak JWT → 200, garbage → 401; cred = minted-keycloak-jwt)
- PASS A2 (all 5 clients mint `client_credentials` JWT with `aud == offgrid-<svc>`)
- PASS A3 (all 5 service secrets readable at `secret/<svc>/client-secret` in OpenBao)
- PASS A4 (opensearch/opa/marquez bound to loopback, not 0.0.0.0)
- PASS A5 (machine SA JWT → 200, unauth → 401 on `/api/v1/admin/agents`)
- PASS **C1** (governed run `run_2c0d55c7`, agent=sop-synth, shows all stages: policy·guard·ground·sign)
- PASS **C2 — the money test** (`run_2c0d55c7` correlated across ALL 4 planes:
  opensearch·langfuse·marquez·provenance all HIT)
- PASS **C3** (PII probe `run_ff727a0b` shows a pii/guard check that blocked/redacted)
- SKIP A7 (destructive rotate-and-reject — by design), SKIP B2 (network boundary — real proof is A4
  off-host), SKIP B3 (transparent-refresh — needs forced expiry)

**Prior sweep-#1 gaps — status:**

- **#29 (C4 durable-run fan-out unverified) — STILL OPEN.** The harness still has no C4 probe. Identity
  + runId threading remains in code only (`src/lib/agent-run-context.ts`, `src/lib/agent-run-durable.ts`);
  no worker run was launched and correlated against C2's 4-plane check. Durable-run parity is unproven.
- **#30 (`adapters/evals.ts` hard-coded apiKey) — STILL OPEN.** `src/lib/adapters/evals.ts` still sets
  `config.apiKey = 'offgrid-local'` on the primary path (not the `getServiceCredential()` seam the other
  adapters use). It is the exact primary-path static key A6/B1 say must become fallback-only.
- **#31 (spec status drift) — CLOSED this sweep.** `docs/INTEGRATION_SUCCESS_SPEC.md` status tables +
  honest-status line reconciled: A1–A5 + C1–C3 marked VERIFIED (8/0/3), C2 correlation marked proven,
  C4 flagged as the remaining unverified claim, A7/B2/B3 kept as honest SKIP-by-design.

**Coherence spot-check of features merged since sweep #1 (code paths read, not just the harness):**

- **Budget enforcement is real and default-on.** `src/lib/budget-config.ts` resolves an env kill-switch
  (`OFFGRID_BUDGET_ENFORCE`) over a `budget.enforce` flag, defaulting ON; `projectBudget()` in
  `src/lib/chat-governance.ts` prices the incoming call, sums month-to-date spend, and returns a
  `BudgetGate` whose `ok` is forced true only when enforcement is off (advisory). Coherent: the gate is
  a pre-call check on the spend path, not an after-the-fact alert.
- **Permissions-aware retrieval is document-level and default-safe.** `src/lib/retrieval/acl.ts` is a
  pure rule (`docVisibleTo`) binding owner/allowed_subjects/allowed_roles per document, with un-ACL'd
  docs staying visible (backward compatible) and enforced-but-unmatched docs hidden even inside the
  asker's project. Enforced as a metadata filter + post-filter (defence in depth). Closes vision item #27.
- **Studio builder** publishes a real governed agent + a template pointing at it (`src/lib/studio-builder.ts`),
  so a Studio assistant runs the same pipeline as a hand-built one — no special path.
- **Provit** is brokered honestly (`src/lib/provit.ts`, `src/app/(console)/provit/`): it runs no own
  gateway — its oracle points at the console's gateway, so its intelligence rides the same fleet/auth/
  budgets. Repos/runs scoped by ABAC (`resource='provit'`) + tenancy (`src/lib/provit-access.ts`).
- **Operator Overview** (`src/lib/overview-synthesis.ts`) synthesizes health/governance/spend from real
  events; **Access realm admin** (`src/lib/keycloak-realm.ts` + `src/app/api/v1/admin/access/*`) surfaces
  sessions/MFA/required-actions/IdP/realm-lifetimes, writing through to Keycloak via `realm-management`.
  All coherent with the platform; no new gaps found in these paths.

**New items found (record only, not fixed):**

| # | Gap | Where | Owner |
|---|---|---|---|
| 32 | **A4 off-host proof still owed.** The harness's A4 is a loopback bind-check run ON S1; the spec's own coverage note says the true external-unreachability test must be `curl offgrid-s1.local:9200/:8181/:9000 → refused` from a NON-S1 host. That off-host curl has never been run/recorded. Add it to the harness (or a companion script meant to run from a dev Mac) so B2/A4 stop resting on the bind-check stand-in. | `deploy/verify-integration.sh` | console + infra |
| 33 | **✅ CLOSED (2026-07-06, sweep #3)** — ~~Budget enforcement is global, not per-org.~~ `src/lib/budget-config.ts` now resolves a **per-org override** (`budget.enforce:<org>`) between the env kill-switch and the global `budget.enforce` flag: precedence env → per-org → global. A blank/whitespace org falls through to the global flag (backward compatible); the org-scoped read is a pure function (`resolveEnforced`) unit-tested. One tenant's posture no longer flips enforcement for all. | `src/lib/budget-config.ts` | console |

---

## Integration sweep #3 (2026-07-06) — platform-integration cadence agent (final)

**Live harness result (`deploy/verify-integration.sh` on S1, read-only):** `8 pass / 0 fail / 4 skip`
— one more SKIP than sweeps #1/#2 because the harness now carries a **C4 probe** (gap #29). Full
line-by-line:

- PASS A1 (aggregator: minted Keycloak JWT → 200, garbage → 401; cred = minted-keycloak-jwt)
- PASS A2 (all 5 clients mint `client_credentials` JWT with `aud == offgrid-<svc>`)
- PASS A3 (all 5 service secrets readable at `secret/<svc>/client-secret` in OpenBao)
- PASS A4 (opensearch/opa/marquez bound to loopback, not 0.0.0.0 — with the honest off-host note)
- PASS A5 (machine SA JWT → 200, unauth → 401 on `/api/v1/admin/agents`)
- PASS **C1** (governed run `run_d01891dc`, agent=sop-synth, all stages: policy·guard·ground·sign)
- PASS **C2 — the money test** (`run_d01891dc` correlated across ALL 4 planes:
  provenance·marquez·langfuse·opensearch all HIT)
- PASS **C3** (PII probe `run_9e0a7b46` shows a pii/guard check that blocked/redacted)
- SKIP A7 (destructive rotate-and-reject — by design)
- SKIP B2 (network boundary — real proof is A4 off-host)
- SKIP B3 (transparent-refresh — needs forced expiry)
- **SKIP C4 (NEW probe) — durable (Temporal) path not configured** (`OFFGRID_QUEUE_ENABLED` not
  truthy / `OFFGRID_ADAPTER_AGENTRUNTIME != temporal`). Inline path is the default → nothing durable
  to probe. This is the expected SKIP: it becomes a live PASS only once a Temporal worker is bootstrapped.

**Prior gaps reconciled this sweep:**

- **#29 (C4 durable-run probe) — ✅ CLOSED.** The harness now runs a C4 probe (added since sweep #2);
  it SKIPs cleanly today because the Temporal worker is off — not a FAIL, exactly the honest
  NOT-VERIFIED-yet state the spec calls for. C4 flips to PASS the moment the durable path is wired
  (worker + `OFFGRID_QUEUE_ENABLED`).
- **#30 (`adapters/evals.ts` static apiKey) — ✅ CLOSED.** Verified in code: the promptfoo adapter's
  primary auth path is `getServiceCredential('gateway')` → shared `chooseGatewayAuth` →
  `providerAuthFromHeaders`/`selectPromptfooAuth`. The old `apiKey:'offgrid-local'` survives ONLY as the
  unprovisioned fallback branch (`src/lib/adapters/evals.ts:47`), byte-identical to before — it is no
  longer the primary path. A6/B1's "static key must be fallback-only" is satisfied.
- **#33 (per-org budget) — ✅ CLOSED** (see the inline update on the row above). `budget-config.ts`
  resolves a per-org override between the env kill-switch and the global flag.
- **#32 (A4 off-host curl) — CONFIRMED the honest remaining item.** This is a **manual/infra check,
  not a code task**: the true external-unreachability proof (`curl offgrid-s1.local:9200/:8181/:9000
  → refused` from a NON-S1 host) needs a second machine on the LAN, which no automated on-S1 run can
  provide. The A4 loopback bind-check stands in for it and the harness prints the honest note. Leave
  open as an on-site verification, owned console + infra.

**Fresh code scan for NEW gaps (src/lib, adapters, deploy):** none found. Every load-bearing
`TODO`/`stub`/`placeholder` hit is either (a) the already-tracked Phase-D native-OIDC TODO
(`service-credentials-lib.ts` — services validating KC tokens directly; tracked in ROADMAP_STATUS bucket
b), (b) legitimate OpenAPI-spec stubs for services that publish no machine spec (Keycloak/OPA/Temporal
in `service-specs.ts`), or (c) benign string-placeholder logic (prompt variables, brain seed row). No
scaffold is mislabeled as a shipped feature.

**Docs completed this sweep (`src/lib/docs/*`):**

- **Per-org budgets** — the Budget-enforcement guide now documents all three switches with precedence
  (env kill-switch → per-org override → global flag).
- **Multi-tenancy & isolation** — NEW concept page (`concepts/multi-tenancy`): the org-claim + `org_id`
  filtering model, the Postgres RLS backstop (no-op until the current-org GUC + non-superuser role are
  set), file namespacing, and "single-tenant is just one org."
- **Backups/restore** — strengthened: manifest-backed status, end-to-end restore (not display-only),
  and multi-tenant restore scope.
- **Native-OIDC enable path** — added to `self-hosting/configuration`: brokered identity by default +
  the opt-in, service-by-service flip to direct-service Keycloak token validation.
- Studio builder, Provit, RLS, per-org budgets, native-OIDC now all covered across the doc set.

**Deliverable:** `docs/ROADMAP_STATUS.md` written this sweep — the evidence-based whole-roadmap ledger
(buckets: shipped & live-verified / code-complete needing an on-site enable / genuine polish remaining).

## Post-merge audit (workspace/temporal/config batch) — 2026-07-06 QA+docs sweep agent

Findings from an adversarial code-read of the 3 just-merged surfaces (Workspace revamp #75, Temporal
Jobs #76, Config mDNS + honest health #78) + the CSP/Scalar fix. Full trace in
`docs/PLATFORM_INTEGRATION_REPORT.md`. Verdict: the platform coheres; two real seams below, both in
the Temporal Jobs surface.

- **#34 (Temporal cancel/terminate emits no audit) — OPEN, P1.**
  *What:* `POST /api/v1/admin/agent-runs/workflows/[wf]/cancel` (and its `mode:terminate`
  force-kill) mutates live state but writes NO audit event. `grep audit` across `workflows/**`
  returns nothing. The route captures `gate.user.email` into the response `by` field but never
  persists it, so a force-terminate of a durable job leaves zero accountability record.
  *Where:* `src/app/api/v1/admin/agent-runs/workflows/[wf]/cancel/route.ts:23-30`.
  *Why it matters:* violates the audit-every-mutation mandate; terminate is irreversible and the
  most audit-worthy action on the surface. Rerun is fine (it's audited through `runAgent`).
  *Fix:* emit an attributed audit event (`workflow.cancel` / `workflow.terminate`, actor =
  `gate.user.email`, target = workflowId + correlated runId, outcome) via the same audit seam
  `agentrun.ts` uses (`shipAudit`/`audit-event`), on the success path of the cancel route.

- **#35 (`runIdFromWorkflowId` fragile to hyphenated runIds) — OPEN, P2 (latent, not live).**
  *What:* `runIdFromWorkflowId` slices the runId after the LAST `-`, but `workflowIdFor` builds
  `agentrun-<agent>-<runId>`. A runId containing `-` (e.g. a UUID) would resolve wrong or 404 on
  rerun. Today's runIds (`run_2c0d55c7`) are hyphen-free, so it is correct now.
  *Where:* `src/lib/temporal-visibility.ts` `runIdFromWorkflowId` vs `src/lib/agent-run-durable.ts:74`.
  *Fix:* anchor the parse on the known `agentrun-` prefix and a delimiter that can't appear in the
  agentId, or encode a fixed-position separator; add a unit test round-tripping `workflowIdFor` →
  `runIdFromWorkflowId` including a hyphenated runId.

**Verified clean this sweep (no gap):** Config mDNS display↔connect round-trip (exact inverses,
`setConfig` applies `configConnectValue` on write); no raw IP/loopback reaches the client (unknown
private IPs fall back to mDNS); honest health (LanceDB→embedded, Redis→optional, never false "down",
shared probe with public `/status`); workspace routes all resolve under `(workspace)` group with
coherent sidebar highlight; self-hosted Scalar closes the `/docs/api` air-gap hole (bundle present,
`PUBLIC_EXACT` allows it, CSP permits same-origin). No new CRUD-mandate violations found in the
merged surfaces — the Temporal Jobs surface offers rerun + cancel + terminate (the write actions
that make sense for externally-owned Temporal executions; create is `runAgent`, delete is N/A for
Temporal-managed history).

## Live-review gaps (founder UX pass 2026-07-06) — discovered by the founder, not by our own verify

These were caught by the founder clicking through the live console — a reminder that the merge gate
MUST include live vision verification, not just build/typecheck/test. Logged for the gap agent.

- **#36 (P1) — Access → Sessions shows "No active sessions" while the user IS logged in.**
  *Where:* `src/components/access/SessionsPanel.tsx` + `src/lib/keycloak-realm.ts` (session lookup).
  *Why:* the active-session query returns empty for `mac@example.com` despite a live session — likely
  wrong Keycloak endpoint (user-sessions vs client-sessions) or missing admin scope. Fix + verify a
  live session renders (IP mDNS'd), and "Log out everywhere" works.
- **#37 (P1) — Access → Federation: "Keycloak error: HTTP 403 Forbidden" listing identity providers.**
  *Where:* `src/lib/keycloak-admin.ts` IdP calls. The console admin service-account lacks the
  `realm-management` role (view/manage-identity-providers). Grant the role (record in SERVER_STATE)
  and verify list + Add OIDC provider. Infra (Keycloak role) + code.
- **PROCESS — merge gate drifted:** UI merges were build-gated but NOT vision-verified live, so the
  founder found the layout/interaction issues instead of us. Reinstate: screenshot-verify every UI
  merge before "done", and run the QA/platform-integration+docs sweep after every 3 merges.

_Resolved 2026-07-06: #36 (Sessions online+offline merge + mDNS IP, deployed) and #37 (Federation — Keycloak IdP roles granted to the console admin SA, /idp now 200) — see git + SERVER_STATE._

## Post-chat-epic sweep (2026-07-06)

QA/platform-integration sweep after the chat-epic batch (citations, thinking, @-mentions, artifact
editing) + gateway node control + federation/sessions. Verified by code read + unit suites (47
chat-epic tests pass) + IP-leak grep. Full report: `docs/PLATFORM_INTEGRATION_REPORT.md`. New gaps:

- **#38 (P2) — Artifact save from the chat transcript chip does NOT refresh the library. — RESOLVED (2026-07-06)**
  *Where:* `src/components/chat/ChatWorkspace.tsx:1865` — the transcript-chip `ArtifactView` is
  rendered with `title`+`conversationId` but WITHOUT `onSaved`, while the library-context instance at
  `:1870` wires `onSaved={refreshProjects}`. *Effect:* saving a new version from the chip works
  (persists) but the projects/library list is stale until the next navigation.
  *Resolution:* `src/components/chat/ChatWorkspace.tsx:1847` now passes
  `onSaved={() => void refreshProjects()}` to the transcript-chip `ArtifactView` — the same refresh
  `ProjectDialog` uses (`:1852`), so a chip-saved version refreshes the library immediately. Typecheck
  clean, build green.

- **#39 (P1) — Gateway node-control mutations are not audited. — RESOLVED (2026-07-06)**
  *Where:* `src/app/api/v1/gateway/nodes/[name]/route.ts` — POST performs privileged, state-changing
  fleet actions (model swap / restart / enable / disable) but writes no audit event.
  *Resolution:* the POST handler now calls `auditFromSession(gate, orgId, { action:
  'gateway.node.<action>', resource: 'node:<name>', outcome })` after the forward to the aggregator
  (`src/app/api/v1/gateway/nodes/[name]/route.ts:80-88`) — outcome `ok` on a real applied action,
  `error` if the aggregator rejected it. The not-actionable 404/501 path (no state change) is NOT
  audited. Actor is derived from the existing `requireAdmin` gate, mirroring the Temporal
  cancel route. The four `gateway.node.*` actions were added to the `AuditAction` taxonomy in
  `src/lib/audit-event.ts` (no allowlist elsewhere — `action` is a free string union).

- **#40 (P2) — Federation realm-management grant is a manual bootstrap, not server-side. — RESOLVED (self-heal, 2026-07-06)**
  *Where:* `src/lib/keycloak-admin.ts:88-93` + `keycloak-realm.ts:33-40` (`forbiddenGrantMessage`).
  The empty-body 403 is turned into an ACTIONABLE message, but there was NO server-side grant of
  `realm-management` roles to the console's own SA — a fresh realm 403s until an operator grants by hand.
  *Resolution:* added a real self-heal.
  New route `POST /api/v1/admin/access/federation/provision`
  (`src/app/api/v1/admin/access/federation/provision/route.ts`) finds the console's own service-account
  user (`service-account-<OFFGRID_KEYCLOAK_ADMIN_CLIENT_ID>`), resolves the `realm-management` client's
  `view-identity-providers` + `manage-identity-providers` role objects, and assigns them to the SA via
  the Keycloak Admin API (idempotent — returns `{ alreadyGranted: true }` when already held, which is
  the live-server case). Pure bits isolated + tested in `keycloak-realm.ts`
  (`federationGrantRoleNames`, `serviceAccountUsername`, `federationGrantCommand`,
  `REALM_MANAGEMENT_CLIENT`; tests in `test/keycloak-realm.test.ts`). New I/O methods
  `listClientRoles`/`listUserClientRoles`/`assignClientRoles` in `keycloak-admin.ts`. UI: a "Grant
  access" button appears on the Federation panel (`src/components/access/IdpList.tsx`) when the IdP
  list 403s → calls provision → retries. HONESTY: if the console's admin client itself lacks the rights
  to grant its own roles (needs `manage-users` + view/manage-clients on `realm-management`), the route
  does NOT fake success — it 403s with the exact copy-pasteable `kcadm.sh add-roles` command
  (`federationGrantCommand`). So it self-heals when the admin client is broad enough, and degrades to
  the documented manual command otherwise.

## Post-builder-epic sweep (2026-07-06)

QA/integration sweep after the builder epic + evals revamp. Verified the 5-screen app lifecycle
coheres end-to-end (see `docs/PLATFORM_INTEGRATION_REPORT.md`). Gaps below are honest seams the code
already surfaces — not hidden defects. Ordered by impact.

- **[HITL] Durable `offgrid-apps` queue/worker not confirmed enabled on the fleet.** Human-in-the-loop
  pause/resume only works on the DURABLE path: the workflow (`src/worker/app-run.workflow.ts:145`,
  `condition()`) suspends on a human step and resumes via `signalAppRun`
  (`src/lib/adapters/apprun.ts:172-195`). If no Temporal worker is running the `offgrid-apps` task
  queue (`app-run-durable.ts:28`), `submitAppRun` degrades to inline
  (`adapters/apprun.ts:96-102`) and the paused run can't be resumed. STATUS: design-complete, not
  verified live. FIX: stand up the app-run worker on the fleet (`OFFGRID_QUEUE_ENABLED=1` + a worker
  process bundling `app-run.workflow.ts`/`app-run.activities.ts`), then verify a real approve→resume
  and reject→halt against Temporal. Record the worker in `deploy/onprem/SERVER_STATE.md`.

- **[HITL] Console test-run is always inline — a HITL app tested from the Input/canvas screen can't
  be resumed. — RESOLVED (#114, 2026-07-06).** `apps/[id]/run/route.ts` now routes through
  `submitAppRun` (`src/lib/adapters/apprun.ts`) instead of calling `runApp` directly. A spec that
  `shouldRunDurably` (multi-step OR has a human step) goes on the DURABLE Temporal path and can be
  resumed from the Review screen; simple specs still run inline. When the durable worker/Temporal is
  off, `submitAppRun` degrades gracefully to inline and the route surfaces that honestly in the
  response (`mode: 'inline'` + a `note`), so an operator knows a HITL test-run that fell back to
  inline won't be resumable. *Evidence:* route rewritten (thin handler, delegates to the adapter);
  the adapter's durable-vs-inline decision + off-fallback are covered in `test/app-run-durable.test.ts`
  and the adapter tests; `npm run typecheck`/`npm test` (0 fail)/`npm run build` (exit 0) all green.
  NOTE: standing up the actual `offgrid-apps` worker on the fleet (first HITL bullet above) is still
  its own infra task — this fix makes the console USE the durable path when the worker is present.

- **[BUILD/RUN] Inline agent steps (no agentId) cannot execute. — RESOLVED (#113, 2026-07-06).**
  `executeAgentStep` (`src/lib/app-run.ts`) now MATERIALIZES an agent step that has an `inlineAgent`
  (systemPrompt/model/grounded/tools) but no `agentId`: on first run it creates a real `customAgent`
  via `createCustomAgent` (`store.ts`), caches the new id back onto the step, and persists it to the
  app via `updateApp` — then runs it through `runAgent` normally. Idempotent: the cached/persisted
  `agentId` means a re-run reuses the SAME agent (no duplicates); persistence is best-effort so a
  draft/unsaved spec still runs (in-memory id serves that run). Wired behind a `materializeAgent`
  DI seam so it's testable without a live DB. *Evidence:* `test/app-run.test.ts` — "executeStep(agent)
  materializes an inline agent then runs it (idempotent)" (asserts the create fn is called ONCE across
  two runs) + "runApp runs a compiled-shaped app: connector(id)→inline-agent→human"; and
  `test/reimbursement-e2e.test.ts` — "GAP #113: the seeded app's INLINE agent step now materializes +
  runs (no pre-wiring)". All gates green.

- **[REPORTS] `report`/`email`/`whatsapp` output sinks defer delivery at run time.**
  `executeOutputStep` (`src/lib/app-run.ts:348-356`) records the sink intent with a "delivery deferred
  to Phase 4 — outcome available, not sent" note; the step succeeds but nothing is delivered. The real
  signed-PDF path is the separate on-demand route `GET /api/v1/admin/app-runs/[id]/report`
  (ed25519-signed via `provenance.ts`/`signing.ts`), NOT the report sink. FIX: wire the `report` sink
  to call the report renderer during the run (or on run completion) and attach/store the signed PDF;
  gate `email`/`whatsapp` sinks on the same on-prem env the triggers use. Documented in
  `docs/user/app-reports.md`.

- **[BUILD] `apps/compile` route is unaudited.** `apps/compile/route.ts` has no `auditFromSession`.
  This is acceptable (compile is a read-only NL→spec transform that persists nothing), noted for
  completeness — if compile ever starts persisting drafts, add an audit entry then.
## Reimbursement demo-seed + e2e (task #106) — 2026-07-06

- **#106-a (P1) — Compiled AppSpec connector-query steps bind by domain ID, but the runtime resolves
  by LABEL — a compiled spec's data reads MISS at run time. — RESOLVED (2026-07-06).**
  *Was:* `app-compile.ts` `bindDataPhrase` sets `step.domain = domain.id` (e.g. `dom_inv`), but
  `app-run.ts` `executeConnectorStep` called `resolveDomain(step.domain, domains)` which matches on
  LABEL/ALIAS, not id — so `resolveDomain('dom_inv', …)` returned null and the read errored as "no
  data-domain binds ...".
  *Fix (option (a) — the cleaner one):* `executeConnectorStep` now resolves `step.domain` via a new
  pure helper `resolveDomainByIdOrLabel(ref, domains, resolveDomain)` (`src/lib/app-run.ts`) that
  tries an EXACT domain-id match FIRST (what the compiler emits — ids are stable + unique), then
  falls back to the label/alias rule engine (`resolveDomain`) for a human label/phrase. So a saved
  compiled spec with `step.domain = <id>` AND a seed/label spec with `step.domain = <label>` both
  resolve to the same domain. The compiler was left emitting ids (no change needed there); the
  seeded reimbursement app's LABEL convention still works (label branch), so nothing broke.
  *Evidence:* `test/app-run.test.ts` — "resolveDomainByIdOrLabel resolves a compiler-emitted domain
  ID", "resolves a human label to the same domain", "id form and label form resolve to the SAME
  domain", "returns null for an unknown ref (no-guess)", and "executeStep(connector-query) reads via
  a domain ID (the compiler convention)". Existing `reimbursement-e2e.test.ts` label-binding test
  still passes. `typecheck` clean, `npm test` 0 fail, `npm run build` exit 0.

## Autonomous-run tail (2026-07-06)
- **#121 (P2) — PII deep-config unavailable in the durable app-worker.** A guardrail step running inside
  the `offgrid-apps` Temporal worker logs `[pii] deep-config load failed ... headers() outside request
  scope` and falls back to plain Presidio analyze. Non-fatal (degrades), but org-scoped custom PII
  recognizers/thresholds won't apply on the durable path. Fix: pass org context into the guardrail
  adapter explicitly (don't rely on `headers()`) so worker + request paths behave identically.

## Hardening audit (2026-07-06)

Full report: `docs/HARDENING_AUDIT.md`. 20 findings (3 P0, 8 P1, 9 P2). Ranked; fix P0 first.

**P0 — live vulns / secret leak**
- **#122 (P0) — Unauthenticated vector-DB inspector = SSRF + data read.** `src/app/api/v1/vectordb/route.ts:32`
  `POST` has NO auth gate; body supplies `url` + `apiKey` and the handler connects and returns
  `collections`/`sample` (raw payload previews). Unauthenticated read of the on-prem Qdrant (env
  defaults when body omits creds) AND an SSRF primitive. Fix: `requireAdmin` + restrict `url` to an
  allowlist (or drop body `url`, env only). **Single most urgent item.**
- **#123 (P0) — Unauthenticated audit-event injection.** `src/app/api/v1/devices/[id]/audit/route.ts:7`
  `POST` accepts audit events for any device id with no auth (only `getDevice` existence). Forged
  records poison the tamper-evidence store. Fix: verify the device token (`dt_<id>` from enroll)
  before `appendAudit`. (Broader: the whole `/devices/[id]/*` data-plane is unauthenticated — P1
  systemic — introduce a device-token verifier.)
- **#124 (P0) — Live Keycloak client secret retrievable via GET, un-audited.**
  `src/app/api/v1/admin/access/clients/[id]/secret/route.ts:19` GET returns the raw client secret on
  demand (not a one-time create reveal) and does not audit the read. Fix: remove the GET (reveal only
  on create/rotate), or step-up + audit each reveal.

**P1 — real holes**
- **#125 (P1) — Privileged mutations with NO audit event** (accountability gap; all are admin-gated).
  The canonical taxonomy already has the actions; these routes just don't emit: KC password reset
  (`access/users/[id]/password:21`), KC user create/update/delete (`access/users/route.ts:52`,
  `[id]:29,48`), machine-credential provision/rotate into OpenBao (`access/service-clients/provision:30`),
  KC client delete + role create/delete (`access/clients/[id]:24`, `access/roles/route.ts:22`,
  `roles/[name]:7`), device kill-switch (`devices/[id]/kill:10`), GDPR erasure (`erasure:15`), OPA
  policy push (`policy/push:12`). Fix: `auditFromSession(gate, org, {...})` mirroring
  `connectors/route.ts:39`.
- **#126 (P1) — `listIngestJobs` not org-scoped.** `src/lib/store.ts:704` returns all ingest jobs
  globally (no `orgId` column on the table). Callers `data/page.tsx:46`, `integrations/page.tsx:43`,
  `admin/ingest-jobs/route.ts:8` leak cross-org ingest metadata. Fix: add `orgId` (backfill from the
  connector), filter, pass `currentOrgId()`.
- **#127 (P1) — `createMaskingRule` drops `orgId`.** `src/lib/store.ts:721` insert omits `orgId` →
  defaults to `'default'`, while `listMaskingRules(orgId)` filters by org. A non-default org creates a
  rule it can never see, silently landing in `default`. Fix: `createMaskingRule(orgId, kind, action)`
  + pass `currentOrgId()` from `masking-rules/route.ts:27`.

**P2 — robustness / weaknesses** (see report for the full table)
- **#128 (P2) — Unguarded RSC DB calls crash a whole page** (an `error.tsx` boundary catches it, but
  no partial degradation): `lineage/page.tsx:23` (`listAgentRuns`), `agents/[id]/page.tsx:84` +
  `agents/[id]/runs/page.tsx:31` (`listAgentRunsByAgent`). Fix: `.catch(() => [])` (the same file
  already does this for `listTools`).
- **#129 (P2) — Route DB calls with no try/catch → opaque 500 instead of `{error}` 503:**
  guardrails `recognizers/route.ts:13,22`, `recognizers/[id]:23,31,40`, `thresholds:14,21`;
  observability `thresholds/route.ts:11,18`, `[id]:13,22`; provit `repos`/`runs` `db.insert`.
- **#130 (P2) — Input-validation gaps:** `vectordb` url allowlist (SSRF, ties to #122); password no
  length/complexity check (`access/users/[id]/password:16`); `body.modules` capabilities unvalidated
  (`access/clients/route.ts:73`); `gateway/tokens/route.ts:72` `req.json()` missing `.catch`.
- **#131 (P2) — Fleet/tenant/org-settings/backup-prune mutations un-audited** (see report Dim 2 table).
- **#132 (P2) — `data/page.tsx:219` passes raw `127.0.0.1` `urlHint` across the server→client
  boundary** (currently safe — `VectorDBInspector` maps it via `toDisplayHost` before render — but
  wrap server-side for defense in depth).

### Wave-2 resolutions (2026-07-06, TASK #139)

- **#123 (P1 systemic device data-plane) — RESOLVED.** All three node data-plane routes
  (`devices/[id]/{audit,policy,commands}`) now gate through the shared `gateDeviceRequest()` seam
  (`src/lib/device-auth.ts`), which verifies a per-device Bearer via the PURE `verifyDeviceToken()`
  (`src/lib/device-token.ts`, unit-tested). The predictable `dt_<id>` is replaced by a RANDOM secret
  minted at enroll (`enrollDevice` → `devices.token`), returned once, and required thereafter;
  legacy `dt_<id>` still works ONLY for pre-hardening devices with no stored token (backward-tolerant,
  closes on re-enroll). Evidence: `test/device-token.test.ts` (9 cases) + `test/ingest-jobs-scope.integration.test.ts`
  (enroll→verify), typecheck + build clean.
- **#125 (P1 audit-emit) — RESOLVED.** `auditFromSession` wired on: KC password reset
  (`access.user.change`), KC user create/update/delete (`access.user.change`), machine-cred
  provision/rotate (`access.machine.issue`/`rotate`, per-service), KC client delete + role
  create/delete (`access.role.change`), device kill (`device.kill` — new action), GDPR erasure
  (`data.erasure` — new action), OPA policy push (`policy.change`, outcome from push result). Only
  successes (`ok`) + real failures (`error`) are emitted — never gate rejections. New actions added
  to `src/lib/audit-event.ts` taxonomy.
- **#126 (P1 ingest scope) — RESOLVED.** `ingest_jobs.org_id` column added (schema.ts + self-healing
  `ensureOrgSchema` DDL); set from the connector's org on insert (`syncConnector`); `listIngestJobs(orgId)`
  filters and all three callers pass the org. Evidence: `test/ingest-jobs-scope.integration.test.ts`
  (cross-tenant leak test, passes against live DB).
- **#127 (P1 masking-rule org) — was ALREADY FIXED** before this wave (`createMaskingRule` sets `orgId`
  on insert). Verified, no change needed.
- **#130 (P2, partial) — password min-length** now enforced (8-char) on `access/users/[id]/password`
  for a clean 400. The other #130 items (vectordb allowlist, clients `body.modules`, gateway/tokens
  `.catch`) are outside this wave's file-set — DEFERRED to the owning agent.
- **DEFERRED (out of file-set):** #128 (lineage/agents RSC guards — wave-1 files), #129 (guardrails/
  observability/provit route try-catch — other concerns), #131 (fleet/tenant/org-settings/backup-prune
  audit — not in the named audit list + outside owned set), #132 (urlHint — vectordb concern), #122/#124
  (P0s, already fixed + deployed per task brief).

## Pipelines-as-first-class — deferred design gaps (2026-07-08)

From the adversarial review of the 3-tier model (canonical: `PIPELINES_AND_GATEWAYS_PLAN.md`
§ Adversarial review). Founder-confirmed as fixable *within* the model, NOT v1-blocking. Each is
real and should be closed before enterprise GA:

| # | Gap | What to do | Owner | Effort |
|---|-----|-----------|-------|--------|
| PA-3 | **Flat org — no team/BU tier.** One admin per org doesn't scale to a bank's departments; per-team budgets/data-scope/delegated-admin have nowhere to live. | Add a `workspace`/team tier between org and consumer; RBAC + budgets + "available pipelines" delegated per team. | console | L |
| PA-6 | **FinOps won't scale + on-prem cost is unmodeled.** One run-keyed fact table times out at volume; a self-hosted GPU has no per-token $ figure. | Add derived rollup tables/materialized views over the run fact-table; define an on-prem cost-allocation model ($/GPU-hour → $/token). | console | M |
| PA-8 | **Chat bound to ONE pipeline is too rigid** — a conversation often needs several (loan, then fraud); rigidity drives shadow AI. | Let chat select among *multiple* allowed pipelines as tools, not a single hard binding. | console | M |
| PA-9 | **Gateway vs pipeline routing overlap** confuses operators. | Doc + UI wording: gateway = intra-backend (nodes within one provider); pipeline = inter-gateway + model choice + egress leash. | console | XS |
| PA-4 | **ABAC attribute sourcing + latency** — subject attrs must come fresh from the IdP per request; OPA on every interactive call has a latency cost. | Wire Keycloak/AD claims → OPA input; measure + budget per-request policy latency; cache attrs with TTL. | console + infra | M |

Being built NOW (fold into schema from the start, per founder): pipeline **versioning** (immutable
versions, consumers pin, edit = new version) and **mandatory-vs-overridable** controls (org control
typed `locked|default`; pipeline may only tighten a locked one).

## Live-audit findings — pipelines/gateways fan-out (2026-07-08)

| # | Gap | What to do | Owner | Effort |
|---|-----|-----------|-------|--------|
| PA-10 | **Gateway PATCH silently no-ops on a PARTIAL body** — sending only `{defaultModel}` returns 200 but does not persist (validateGatewayUpdate delegates to create-validation which needs name/kind/baseUrl). The edit UI always sends the FULL prefilled shape so the user-facing edit WORKS; but a partial API PATCH should either merge onto the existing row or return 400, not silent-200. | Make `updateGateway` merge the patch onto the current row (read-modify-write) OR the route 400 on missing required fields. Add a partial-PATCH test. | console (gap agent) | S |

## Fan-out deferred gaps (honest — flagged by agents B/C, 2026-07-08)

| # | Gap | What to do | Owner | Effort |
|---|-----|-----------|-------|--------|
| PA-11 | **Public pipeline run route doesn't fully EXECUTE.** `POST /api/v1/pipeline/[id]/run` does REAL key-auth + the governed routing/egress decision (block honored + audited) but returns a governed plan/echo (202) — pipelines have no standalone executor (apps run via `submitAppRun`). | Dispatch the resolved gateway/model on the governed decision + apply output guardrail masking, so an external key call actually invokes the model. | console | M |
| PA-12 | ✅ RESOLVED (task #175) — **Telemetry now pipeline-tagged at the source.** One canonical `pipelineTagOrNull` helper (extends the existing `pipelineTag`) derives `pipeline:<id>` for every sink. **Traces:** the chat + agent-run Langfuse trace builder (`buildTraceBatch`) stamps the bound pipeline as a `tags[]` entry + `pipelineId` metadata (chat route threads `pipelineBinding.pipelineId`; agent-run threads it via the `RunContext`/dispatch, resolved once by the runs route). **eval_runs:** added `eval_runs.pipeline_id` (schema.ts + idempotent `ensureEvalsSchema` self-migrate + `deploy/onprem/2026-eval-runs-pipeline.sql`); `runEvalDef`/`persistRun` stamp `def.pipelineId`; `listEvalRuns(limit, org, pipelineId)` filters per-pipeline (Drift can read exactly one pipeline's history). **Cost/Audit** already used the identical `pipeline:<id>` form — unified, no divergence. Additive: a run with no bound pipeline emits no tag. Tests: `pipeline-api-key-format.test.ts` (pure helper), `chat-trace-batch.test.ts` (pure trace-payload builder — trace push can't be integration-tested w/o live Langfuse), `eval-runs-pipeline.integration.test.ts` (real-Postgres write/read + cross-pipeline isolation). typecheck + `npm test` (1697 pass) + `npm run build` all clean. | Stamp run traces + eval_runs with `pipeline:<id>` so the Observability + Drift lenses are exact, not best-effort. | console | M |
| PA-13 | Cosmetic: revoked "audit-test-key" rows linger on the Loan Underwriting seed pipeline (from live audit). Harmless (revoked). | Optionally purge on next seed refresh. | console | XS |

## Live-audit round 2 (2026-07-08) — findings + resolutions

- **S3 tenant-subdomain 404 — RESOLVED.** Not a Cloudflare/app bug: a stale duplicate cloudflared
  replica served a config without the wildcard ingress. Killed it; single current replica remains.
  `bharatunion-onprem-console` verified 15/15 → 200. (See SERVER_STATE.md 2026-07-08.)
- **PA-14 org-settings admin gate — RESOLVED.** The chat-binding PUT double-gated (requireAdmin + a
  redundant `auth()` session role check) and rejected the service bearer token every other admin route
  accepts, so the write silently failed for non-session callers. Dropped the redundant check; verified
  the chat-binding PUT now persists (default + allowlist round-trip live).

| # | Gap | What to do | Owner | Effort |
|---|-----|-----------|-------|--------|
| PA-15 | **Per-tenant gateway URLs** — `<slug5><rand5>-gateway.getoffgridai.co` per provisioned tenant gateway (mirrors `gateway.getoffgridai.co`). | Pure host helper (done) + store the host on the gateway; add `*-gateway.getoffgridai.co → :8800` tunnel ingress above the wildcard (verify cloudflared pattern support); aggregator resolves tenant from Host. Supervised tunnel edit. | console + infra | M |
| PA-16 | **Consumer-run governance ENFORCEMENT** — apps/agents/chat now BIND + run-tag a pipeline, but the executor doesn't yet gate each run against the bound pipeline's policy/guardrails/data-allowlist. | Wire the resolved pipeline contract into the app/agent/chat run path (deeper run-path integration). | console | M |

### PA-16 — PARTIAL RESOLUTION (2026-07-08): APP-RUN inline path enforced

**Done + verified (typecheck + full suite 1676✓ + clean build):** the bound pipeline's contract is now
ENFORCED at run time on the **app-run inline path**. New PURE decision lib `src/lib/pipeline-enforcement.ts`
(`enforceDataAccess` = HARD data-allowlist ceiling via `canReachData`; `enforceModelCall` = egress leash via
`deriveEgress` + `maxEgress` policy-ceiling tighten + guardrail/policy overlay flags via `effectiveGovernance`)
— reuses the existing pure primitives, zero-IO, unit-tested (12 cases). I/O seam `src/lib/pipeline-contract.ts`
(`resolveContract` loads the pipeline + org governance defaults → a DB-free contract; `auditEnforcement` emits
a pipeline-tagged audit event). The app-run route resolves the contract once and threads it onto `AppRunContext`;
`executeConnectorStep` denies a read outside the allowlist (audited, governed error), `executeAgentStep` blocks a
model call the egress leash refuses (audited). **Additive: a run with NO bound pipeline behaves exactly as before**
(integration test proves no-pipeline runs are unchanged + a restrictive pipeline gates as expected — 5 cases).

**Deferred sub-gaps (honest — NOT wired this round):**

| # | Gap | What to do | Owner | Effort |
|---|-----|-----------|-------|--------|
| PA-16a | **Durable (Temporal) app-run path not enforced.** `submitAppRun`'s durable branch serializes only `{appId,runId,input,orgId,caller}` to the workflow — the resolved contract isn't carried, so a durable run isn't gated. (Inline path IS enforced; durable is off by default, so the common path is covered.) | Resolve the contract inside the durable activity/worker (it already has orgId+appId), or serialize a contract ref into `AppRunWorkflowInput`, then call the same pure `enforceDataAccess`/`enforceModelCall`. | console | M |
| ~~PA-16b~~ | ~~**Agent-run + chat run paths not gated by the contract.**~~ **RESOLVED (2026-07-08)** — enforcement is now wired into BOTH paths, reusing the pure libs (not rebuilt). See the resolution note below. | — | console | ✅ |
| PA-16c | **PII-masking flag not yet forced from the overlay.** `enforceModelCall` returns `requirePiiMasking`/`blockPromptInjection`, but the run paths rely on the existing `runChecks` guardrail floor rather than escalating masking when the pipeline overlay tightens it on. | Have the run path raise the guardrail phase to enforce masking when `verdict.requirePiiMasking` is set (currently the org-locked floor already masks; the overlay-tighten escalation is the delta). | console | S |

- **PA-16 (app-run inline enforcement) — SHIPPED + deployed.** Residual verification: a live app-run
  against a restrictive pipeline (empty allowlist / block egress) was not exercised end-to-end from the
  console UI — enforcement is proven by the real-`runApp`-executor integration test + no-regression
  smoke, not a live UI run. Exercise a live restrictive run when convenient. Sub-gap PA-16a (durable/
  Temporal path) remains.

### PA-16b — RESOLVED (2026-07-08): AGENT-RUN + CHAT-RUN paths now contract-gated

The bound-pipeline contract is now enforced on both consumer run paths, reusing the ALREADY-BUILT
pure decisions (`enforceDataAccess` / `enforceModelCall`) + contract seam (`resolveContract`,
`auditEnforcement`) — nothing in `pipeline-enforcement.ts` / `pipeline-contract.ts` was rebuilt or
changed (only imported). New thin glue: `src/lib/pipeline-run-glue.ts` (resolves which pipeline
governs an agent/chat run, most-specific-wins, then loads its contract).

- **Agent runs (`runAgent`, agentrun.ts):** the contract rides `RunContext.contract` (resolved once at
  the `agents/runs` route via `resolveAgentBinding(null, orgDefault, org)` → threaded through
  `dispatchAgentRun` onto the sync `RunContext`). Before retrieval a grounded run calls
  `enforceDataAccess(contract,'retrieval')` (deny ⇒ status `denied` + `pipeline.data.deny` audit, no
  retrieval); before the gateway/compose call it calls `enforceModelCall(contract, dataClass)`
  (`block` ⇒ status `blocked` + `pipeline.egress.block` audit, no gateway call). `dataClass` =
  `'general'` for a grounded run (real org data in the prompt), `'none'` for an ungrounded one.
- **Chat runs (`chat/stream`):** the contract is resolved via `resolveChatBinding(convo.projectId, org)`
  (real `resolveChatPipeline`). Knowledge reads are gated by `enforceDataAccess` (project KB keyed by
  its project id, org-wide KB keyed `'org-knowledge'` — outside the allowlist ⇒ the read is SKIPPED +
  audited, so the model never sees ungoverned data; the chat still answers). The model call is gated
  by `enforceModelCall(contract, dataClass)` layered ON TOP of the existing routing plan — `block` is
  a hard stop (deny + audit), `forceLocal` demotes a cloud plan to on-prem (the pipeline can only
  tighten, never widen). All existing chat governance (RBAC / budget / routing) is untouched;
  enforcement is purely additive.
- **Additive / no-regression:** a run whose resolved contract is `null` (no bound pipeline) is
  fully permissive (the `noPipeline` verdict) — proven by `test/pipeline-run-callsite.test.ts` and the
  full suite passing (1686 pass / 0 fail). Coverage: `test/pipeline-run-glue.test.ts` (real binding
  resolution, injected DB reads), `test/pipeline-run-callsite.test.ts` (real pure verdicts at the exact
  data-keys/classes both paths use). NOTE: an end-to-end `runAgent` import test is NOT possible under
  `node:test` — importing `agentrun.ts` transitively pulls in `next-auth`/`next/server`, which the
  type-stripping loader can't resolve; the wiring is instead validated by the clean production build
  (which compiles the routes + `runAgent` through the real Next toolchain) + the pure/glue tests.

**Residual sub-gaps (open):**
- **PA-16b-durable:** the DURABLE agent-run path (Temporal worker) does not yet carry the contract —
  `AgentRunWorkflowInput` has no `contract` field, so a durably-dispatched run is not contract-gated
  (only the default SYNC path is). Mirrors PA-16a (durable app-run). Thread the JSON-serializable
  contract through `AgentRunWorkflowInput` → the worker's `RunContext` to close it.
- **PA-16c:** overlay-driven PII-mask escalation still deferred (the org-locked guardrail floor masks
  today; the overlay-tighten delta is the remaining work). Not folded in this round — it touches the
  guardrail phase across both paths and warrants its own change.

## T1-tail — residual OSS-name leaks (post-merge scan, 2026-07-08)
T1 scrubbed its 9 named surfaces cleanly; a full scan found more OUTSIDE that scope — fold into the next agents:
- **Observability Langfuse panels** (`LangfuseRegistryPanel.tsx`, `LangfuseInsightsPanel.tsx`): "Langfuse registry", "Read back from Langfuse's public API", "No Langfuse datasets/sessions" → "trace/prompt registry", "tracing store". → **fold into T2** (touching observability).
- **/control SecretsPanel** (`SecretsPanel.tsx`): toast "Stored X in OpenBao" → "…in the secrets store". → **fold into T3** (owns /control).
- **AI-Gateway tokens** (`GatewayApiKeys.tsx`): "backed by its own Keycloak service-account client", "Keycloak is not configured" → "identity-provider service account" / "SSO not configured". → **T4/misc**.

## T4-tail (2026-07-08)
- **Knowledge list→detail NOT done** — the `/workspace/knowledge` list still opens a side-Sheet; a `knowledge/[id]` detail route exists but rows don't route to it. (T4 agent hit session limit after 3/4 items.) Wire rows → `/workspace/knowledge/[id]`; keep the sheet for quick add-doc. Small.
- **Still-deferred T4 'actionable' items:** /gateway/services drill-through, /gateway/edge WAF toggle, /gateway/fleet[id] policy reassign, /governance/provenance verify+rotate, /insights/analytics data-wiring. Read-only today; logged for a later pass.

## SPEECH consolidation (2026-07-08) — gateway is the single STT/TTS engine
Founder: STT/TTS runs through the GATEWAY only (same engine desktop+console), multi-model selectable,
keep-both. STT = Parakeet (+Whisper); TTS = Orpheus (+Kokoro). Decision + detail in memory
`project-speech-stack`. Console speech client is engine-agnostic (OpenAI /v1/audio/*).

- **SP-1 (building, #180):** `@offgrid/speech` shared pkg (../shared/packages/speech) — engine-agnostic
  gateway speech client (transcribe/speak) + target-resolution + speech-model catalog; console consumes
  it (behavior-preserving) + engine/voice picker. Desktop adopts later. IN PROGRESS.
- **SP-2 (fleet fix, live bug):** gateway aggregator `:8800` `/v1/audio/voices` → **500 `spawn ENOTDIR`**
  on S1 — the audio handler tries to spawn a TTS binary but the path/binaries aren't present on the
  console's server, so live STT/TTS-through-gateway is BROKEN on S1. Working reference = desktop
  `src/main/model-server.ts` (Kokoro/Piper via `/v1/audio/speech`, catalog in desktop/packages/models).
### SP-2 root cause + access boundary (2026-07-08, traced end-to-end)
Traced: console → aggregator :8800 (no /v1/audio branch → default proxy `pick()`s a chat node) →
node model-server (:7878, "Off Grid AI — local model gateway") → **spawns its TTS/STT binary →
`spawn ENOTDIR`** (bad/missing binary path). Reproduced directly: `curl http://offgrid-g1.local:7878/v1/audio/voices` → same error.
**BLOCKED remotely:** the node model-server + its bundled speech binaries run under the node's **`user`**
account. S1/aggregator SSH key = `admin@gN` (works) but admin CANNOT access `user`'s procs/files/the
Off Grid AI Desktop bundle where the TTS binary/model live; `user@gN` rejects the admin key. So the fix
must happen in the node `user` context — it's a **desktop model-server / node-provisioning** task (bundle
+ correct the whisper/kokoro binary+model spawn path; desktop is adding Parakeet in that same code), NOT a
console-side patch. Console side (@offgrid/speech client+catalog+picker+fallback) is DONE + live; it
auto-works once the node serves /v1/audio/* correctly. Owner: desktop/fleet (on-node `user` access).

  MECHANISM (now clear): the desktop MODEL-SERVER (which runs on the gateway nodes as :7878) already
  serves /v1/audio/* natively (whisper.cpp STT + Kokoro TTS; handlers in desktop/src/main/model-server.ts
  handleTranscription/handleSpeech). ENOTDIR = the aggregator serves audio itself / routes to a node
  WITHOUT the speech models loaded, instead of proxying to a node running the full model-server with
  whisper(ggml)+kokoro(onnx) present. FIX: (a) ensure >=1 gateway node has the speech models downloaded
  + model-server serving /v1/audio; (b) aggregator routes /v1/audio/* to that node (like it round-robins
  chat, or a dedicated speech route). Fleet-side (SSH + ~230MB model download). This is why console
  audio falls back to the browser today.
- **SP-3 (models, after SP-2):** add Orpheus-TTS (Llama GGUF → same llama.cpp gateway engine) + Parakeet
  STT (parakeet-mlx) as selectable models alongside Kokoro/Whisper. Desktop is adding Parakeet now.

### SP-2 — EXACT FIX (desktop-repo, hand off; 2026-07-08)
Fully diagnosed live. TWO bugs in the node's packaged `Off Grid AI.app --server-only`:
1. **ENOTDIR (FIXED live on g1):** `desktop/src/main/tts.ts` spawns the TTS worker with `cwd: appRoot()`,
   and `appRoot()`=`app.getAppPath()`=`.../app.asar` (a FILE) → spawn ENOTDIR. Live hotfix applied to g1:
   added `OFFGRID_APP_ROOT=/Users/admin` to the gateway launchd plist EnvironmentVariables (appRoot() is
   used in exactly ONE place, so safe) + full bootout/bootstrap. **Permanent fix:** in tts.ts set
   `cwd` to a guaranteed real dir (e.g. `os.tmpdir()`), drop the appRoot() dependency.
2. **Dep tree not asarUnpacked (NOT fixed — the real blocker):** tts-worker.mjs is a loose file in
   Resources/ that imports `kokoro-js` → `@huggingface/transformers` → (jinja, onnxruntime, sharp).
   electron-builder auto-unpacked only the NATIVE modules (onnxruntime-node, sharp) + a PARTIAL
   @huggingface/transformers (missing its dist/index.js); the pure-JS deps stayed inside app.asar so the
   loose worker can't resolve them (ESM ignores NODE_PATH; it needs an ancestor node_modules).
   **Permanent fix:** `desktop/electron-builder.yml` → add `asarUnpack` for `**/node_modules/kokoro-js/**`,
   `**/node_modules/@huggingface/**`, `**/node_modules/phonemizer/**` (their native deps already unpack);
   AND ensure the worker resolves them (a `Resources/node_modules` symlink → app.asar.unpacked/node_modules,
   which I created on g1, or run the worker from inside app.asar). Then rebuild + redeploy the app to g1-g8.
   Owner: DESKTOP repo (team is already in tts.ts adding Parakeet). Console side (@offgrid/speech) is done
   + waits. g1 is left hand-modified (env + kokoro-js/phonemizer copied + Resources/node_modules symlink) —
   harmless; a clean desktop reinstall supersedes it.

## M1 follow-up (found in live verify, 2026-07-08)
- **[RESOLVED 2026-07-08] M1-a: release-gate publish is SYNCHRONOUS → 524 on slow evals.** `publishWithGate`
  ran the pipeline's evals inline in the POST /pipelines/[id]/publish request; a real ragas eval through
  the Cloudflare edge exceeded ~100s → HTTP 524 before a verdict returned. The gate logic was correct — the
  sync request was the bug. **FIX (shipped):** the publish gate is now ASYNC via a tracked **job record**
  (durable-agent path not reused — the eval chain itself isn't a Temporal workflow; a `publish_jobs` row is
  the simplest correct seam and makes the resolution pollable + idempotent).
  - Route branches on `countGatingEvals(id)`: **0 evals ⇒ instant sync publish** (unchanged); **≥1 eval ⇒
    202 `{status:'gating', jobId}`** returned immediately, evals run in the BACKGROUND (fire-and-forget
    `resolveGatingJob`), the gate is applied on completion (publish if pass/override, else leave draft +
    record the blocked decision), audited either way.
  - Poll route `GET /pipelines/[id]/publish/status?jobId=` → `{status: gating|published|blocked, decision}`
    (or latest job when no jobId). Quality tab shows a "running the release evals" banner + polls every
    2.5s and surfaces the verdict; PipelineActions lifecycle band toasts "running evals … track on Quality".
  - **SOLID:** pure state model in `src/lib/publish-job.ts` (transitions + gate→terminal mapping,
    zero-I/O); store `src/lib/publish-jobs-store.ts` (idempotent self-migrate, terminal-guard on resolve);
    orchestration in `src/lib/pipeline-release.ts` reuses the unchanged `release-gate.ts` pure logic.
  - **Evidence:** typecheck clean; `npm test` 1854 pass / 0 fail (pure `test/publish-job.test.ts` + real-DB
    `test/publish-gate-async.integration.test.ts` — gating→terminal, idempotent double-resolve guard, ungated
    instant publish); clean production build (both routes present). NEW `publish_jobs` table (schema.ts +
    idempotent CREATE in the store) — NOT applied live yet; self-migrates on first use. Owner: console.

## GAP (2026-07-09) — Suraksha insurer tenant: connector endpoints mismatch real containers + source data not seeded
**Status: OPEN — needs founder/daylight, do NOT blind-seed (shared demo containers, cross-tenant-bleed risk).**

The `org_suraksha` (Suraksha Life) tenant + 3 connectors + 12 data-domains are live in the console DB (applied 2026-07-09, verified 1/3/12). But the tenant is NOT yet demoable — its domains resolve to tables that have no rows for it, and the connector endpoints are wrong:

- **Endpoint mismatch:** `surcon_coreins` was generated as `postgres://coreins:coreins@127.0.0.1:5433/coreins`, but the real demo container (`deploy/onprem/data-sources.yml`) is **`corebank`** (postgres:16, port 5433, container `offgrid-ds-corebank`) — DB/user `coreins` likely don't exist. `surcon_policyadmin` → MySQL :3307 (`policyadmin`) looks right; `surcon_warehouse` → S3 :9010 is MinIO (`offgrid-ds-minio` maps 9010:9000) — plausible but unverified.
- **Containers not confirmed running:** the `offgrid-ds-*` demo sources are NOT up on S1; they're expected on the S2 data plane (or stopped). Could not cleanly confirm S2 container/DB/table state via the S1→S2 double-hop at low-risk.
- **Isolation question (the crux):** bharatunion's source data lives in ClickHouse warehouse DB `bharatunion` (via `WAREHOUSE_DB` in `seed-insurer-usecases.mjs`), while `corebank`/`policyadmin` MySQL are SHARED single-DB containers. If Suraksha points at the same shared tables, the two tenants share rows unless separated by DB name / a tenant column. **Must decide the isolation model before seeding** (separate warehouse DB `suraksha` is clean for ClickHouse; the shared OLTP containers need a plan).

**To resolve (daylight):** (1) reconcile the 3 Suraksha connector endpoints against the REAL S2 containers (fix `coreins`→`corebank` etc., verify creds/DBs); (2) decide tenant isolation on the shared OLTP containers; (3) seed the insurer-book source rows for `org_suraksha` (adapt `seed-insurer-usecases.mjs`, likely `WAREHOUSE_DB=suraksha` + a per-tenant OLTP scheme). Only then do the domains return rows and the 15 use cases become authorable end-to-end. Owner: console + data-plane. See SERVER_STATE.md § Suraksha, docs/SESSION_HANDOFF.md.
