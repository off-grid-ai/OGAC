# Verification gaps — "deployed but not actually working"

The honest ledger of things that **look** shipped (page loads, route responds, container is up) but
are **not verified working end-to-end** — or are silently running on a fallback instead of the real
thing. Born from the 2026-07-07 verification sweep (the "how do I know it actually works?" pass) and
kept alive after.

**This is a dev/fix doc — it may name the real engines.** The user-facing story stays
outcome-only in [`user/VERIFY.md`](user/VERIFY.md), which explains the in-product signals an
operator watches for. When a signal there says "not wired," the specifics land **here**.

**Relationship to [`GAPS_BACKLOG.md`](GAPS_BACKLOG.md):** that's the broad prioritized backlog
(UX + features + infra). This is narrower and sharper: only the *deployed-vs-actually-working*
delta, each with **reproducible evidence** (the probe + its output) and a suggested fix. Where an
item already exists in the backlog, we cross-reference rather than duplicate.

**Status key:** 🔴 broken/unwired · 🟡 works-but-on-a-fallback (labelled, honest) · 🟢 verified real ·
✅ resolved (with evidence).

---

## Phase F verification — 2026-07-09 (LIVE against the deployed console on S1)

**How:** off-office-wifi → cloudflared tunnel → `ssh offgrid-tunnel`, then `curl` the console on
`127.0.0.1:3000` (and the public subdomains) with the break-glass admin bearer. Every claim below is
backed by a real endpoint + response snippet captured this session. Build on server: `.next/BUILD_ID`
dated 2026-07-09 00:09 (scoping code present in source AND bundle).

**Tally: 13 surfaces PROVEN LIVE (🟢) · 3 honest-fallback (🟡) · 2 real gaps found (🔴).**

**PROVEN LIVE (🟢):**
- **Warehouse catalog + query** — `GET /warehouse` → `healthy:true, engine:ClickHouse` with real row
  counts; `POST /warehouse/query` `SELECT count() FROM bharatunion.fact_transaction` → **600000**;
  `DESCRIBE bharatunion.fact_loan` returns real columns; a bad-column query returns the real
  ClickHouse `UNKNOWN_IDENTIFIER` error (engine is really executing).
- **PII scan (Presidio) — V1 largely resolved** — `POST /pii/scan` `{text:"raj@x.com 4111111111111111 SSN 123-45-6789"}`
  → `engine:"presidio"`, entities `[EMAIL_ADDRESS, CREDIT_CARD, URL, US_BANK_NUMBER, US_DRIVER_LICENSE]`,
  redacted with proper labels. `OFFGRID_PRESIDIO_URL` + `OFFGRID_PRESIDIO_ANONYMIZER_URL` +
  `OFFGRID_ADAPTER_GUARDRAILS` all set on the server. The real recognizer service is reachable and
  scanning. (Caveat below.)
- **SIEM / audit search — V2 resolved** — `GET /siem` → `configured:true, total:220` and it captured
  MY `warehouse.query` blocked event in real time. Audit → SIEM index is live and populated.
- **Traces (Langfuse) — V3 resolved** — `GET /traces` → `configured:true`; my `warehouse.query` audit
  event appeared as an OTel trace `name:"audit.event.v2"` seconds after I made the call. Traces render.
- **Evals (real scorer)** — `GET /evals` → 25 runs / 267 cases / 88% pass; suites include
  `faithfulness:ragas` (4 real runs) and `ragas` (9 runs) — the REAL scorer, not just heuristic.
- **Drift** — `GET /drift` → `engine:"native", driftScore:1.065, drifted:true` with real per-feature
  PSI + mean-delta and an interpretation note. Real numbers.
- **Provenance sign → verify** — `POST /sign` → Ed25519 signature (201); re-POST with the signature →
  `{valid:true}`; POST with a tampered payload → `{valid:false}`. Real tamper-evident provenance.
- **Governed agent-run pipeline** — `GET /agent-runs` → 25 runs with a real step rollup
  (plan→retrieve→ground→guard→policy→sign→answer) and per-step timings. The governance chain executes.
- **Brain ingest/search (S1)** — `POST /brain/search {query:"loan"}` returns real bharat SOPs
  ("Lapse reinstatement", "FNOL intake — death claim") with ACL; `GET /brain/documents` lists them.
- **Connector reachability** — `POST /connectors/con_corebank/test` → `{ok:true, dialect:"postgres",
  message:"Connected — the database responded."}`.
- **App runs** — `GET /app-runs` → real seeded bharat runs (loan/reimbursement) with steps + ₹ inputs.
- **FinOps** — `GET /finops` → real usage: 1706 requests, 3.62M tokens, $15.31, per-model breakdown
  (cloud-claude, gpt-4o, local qwythos-9b …).
- **Cloud-routing governance invariant (D2)** — `POST /routing/evaluate {egressClass:"public",
  model:"cloud-claude"}` → `action:"local", reason:"no rule matched; defaulted to local"`. The
  chokepoint fails safe to local — never silently egresses to cloud without an explicit rule.
- **Data plane (DB)** — direct `pg` counts confirm the seed: `apps` org_bharat=6, `data_domains`
  org_bharat=19, `masking_rules` org_bharat=8, `data_assets` org_bharat=8.

**HONEST FALLBACK (🟡):**
- **Grounding is on the heuristic (lexical) fallback, not model-NLI** — `POST /grounding/verify` with an
  EXACT-match source → `score:100, supported:true`; with a paraphrase ("sky is blue" vs "sky is blue
  during the day") → `score:0, supported:false`. It scores token overlap, not entailment. No
  `OFFGRID_ADAPTER_GROUNDING`/NLI env set → `heuristicGrounding`, not `modelGrounding`. Wired + honest,
  but not the semantic engine. **This nuances V4** (retrieval works; verification quality is lexical).
- **Guardrails inline demo scan (`POST /guardrails`) still returns `engine:"regex"`** even though the
  recognizer catalog reports `engine:presidio, reachable:true`. Two code paths: `/pii/scan` uses the
  real Presidio adapter (proven above); the `/guardrails` demo uses `demoScan` (regex). Neither default
  path recognizes Indian **PAN / Aadhaar** (not in Presidio's default entity set) — a BFSI fidelity gap.
- **Data-quality engine is a stub** — `GET /data-quality` → `engine:"fallback (stub)", url:...:8944`;
  `POST /data-quality/run` → `engineReachable:true` but 0 expectations. Reachable, not the real GE.

**REAL GAPS FOUND (🔴) — logged to GAPS_BACKLOG.md:**
- **G-F1 — subdomain org-scoping does NOT engage for bearer / service-account requests (S2/T3
  root cause).** Through the REAL public subdomain `bharatunion-onprem-console.getoffgridai.co`,
  `GET /apps` returns the `default`-org apps (`orgId:"default"`), identical to `wednesdaysol-…` and to
  no-host — never the 6 org_bharat apps that exist in the DB. Root cause: `currentOrgId()`
  (`src/lib/tenancy.ts`) resolves the tenant-binding guard from NextAuth `auth()`, which is **null for a
  bearer request** (no session cookie) → `session.user.role` is undefined → the "admin-or-member" guard
  is never satisfied → it returns `sessionOrg` (`default`). Fails **safe** (no cross-tenant leak) but
  means machine principals can't be scoped by subdomain, and it blocks verifying "as the tenant" via the
  admin token. Fix: derive the role/org for the tenant-binding guard from the SAME principal `requireUser`
  used (the verified bearer claims / break-glass admin), not only from `auth()`.
- **G-F2 — Indian BFSI PII (PAN, Aadhaar, IFSC, UPI) is not recognized by either PII path.** The seed is
  explicitly Indian-BFSI (PAN `ABCDE1234F`, masked Aadhaar), but neither the Presidio default entity set
  nor the regex floor detects them. Needs custom Presidio recognizers (or regex patterns) for
  `IN_PAN` / `IN_AADHAAR` / `IN_IFSC` / `IN_UPI`. Without them, tenant PII is under-masked.

---

## Resolved — the pattern that started this

| Surface | Was | Evidence it's now real | Status |
|---|---|---|---|
| **Evals / quality scoring** | Screen reported scores but was silently using the **heuristic fallback**, not the real scorer — the client timed out waiting on the real engine and gave up. The only tell was the `computedBy: heuristic` tag. | Fixed the timeout + scoped scoring to the one needed metric + corrected the engine's gateway key (was 401'ing). Re-ran live 2026-07-06: `computedBy: ragas`, real score, gateway 200 OK, inside timeout. Recorded in `deploy/onprem/SERVER_STATE.md`. | ✅ |

This is the template for everything below: **a surface can look healthy while quietly degraded.**
The console now tags the truth (`ready`/`fallback`/`configure`); this ledger tracks every place the
tag is (or should be) anything but "real."

---

## Known suspects carried in from the backlog (confirm or clear in the sweep)

These are already logged in `GAPS_BACKLOG.md`; the sweep re-verifies them against the live system so
we know the *current* truth, not the truth as of when they were written.

| # | Surface | Suspected state | Backlog ref | To confirm |
|---|---|---|---|---|
| V1 | **Guardrails / PII masking** | Running on the **regex floor**, not the real recognizer service. | GAPS_BACKLOG #2 | 🟢 **RESOLVED 2026-07-09 (with a caveat).** `POST /pii/scan` live → `engine:"presidio"`, catches EMAIL/CREDIT_CARD/URL/US_BANK_NUMBER/US_DRIVER_LICENSE with proper redaction; `OFFGRID_PRESIDIO_URL`+`OFFGRID_PRESIDIO_ANONYMIZER_URL`+`OFFGRID_ADAPTER_GUARDRAILS` all set. Real recognizer reachable + scanning. **Caveat (→ G-F2):** the `/guardrails` inline *demo* still runs `demoScan`→`engine:regex`, and neither path detects Indian PAN/Aadhaar. |
| V2 | **Observability / SIEM audit search** | Read a different (empty) index. | GAPS_BACKLOG #6 | 🟢 **RESOLVED 2026-07-09.** `GET /siem` → `configured:true, total:220`; captured my own `warehouse.query` blocked event in real time. Audit→SIEM index is live + populated. |
| V3 | **Observability / traces** | Unverified that traces actually render. | GAPS_BACKLOG #5 | 🟢 **RESOLVED 2026-07-09.** `GET /traces` → `configured:true`; my `warehouse.query` audit event surfaced as OTel trace `audit.event.v2` seconds later. Langfuse renders. |
| V4 | **Chat / Brain grounding** | Retrieval only works with real ingested content. | GAPS_BACKLOG #3 | 🟢 retrieval · 🟡 verification. `POST /brain/search "loan"` returns real bharat SOPs with ACL (S1 resolved). BUT grounding verification is on the **heuristic/lexical fallback** — exact-match source → `score:100 supported:true`; a paraphrase → `score:0 supported:false`. Set `OFFGRID_ADAPTER_GROUNDING` to a model-NLI adapter for entailment-grade checks. |

---

## Found in the 2026-07-07 sweep

*(Consolidated from the live per-surface verification. Each row: what looked shipped, what the probe
actually showed, and the fix.)*

<!-- ORCHESTRATOR: fill from the four doc agents' "GAPS FOUND" returns. Format:
| # | Surface | Looked like | Probe showed | Suggested fix | Status |
-->

| # | Surface | Looked like | Probe showed | Suggested fix | Status |
|---|---|---|---|---|---|
| S1 | **Brain — new-document ingest** | ~~500 on `/brain/ingest` + `/brain/documents`~~ | **RESOLVED 2026-07-07.** Root cause: LanceDB fixes a table's schema at creation; the live `documents` table predated the per-doc ACL columns (`owner`/`allowed_roles`/`allowed_subjects`/`data_class`), so every new `add()` with those fields was rejected (`Found field not in schema: owner`) → bare 500. Fix: `aclColumnMigration` (pure rule) + `reconcileAclColumns` (adds missing columns on table open, back-fills) in brain.ts; `BrainWriteError` (502) so a real write failure is never a bare 500; +3 real tests incl. a legacy-table integration test. Verified live: POST → **201**, doc searchable. Also fixed a deploy footgun: `push.sh --delete` now excludes `.lancedb` (was capable of wiping the live vector store). | ✅ |

| S2 | **Per-tenant subdomain — routing ✅ / org-scoping pending** | Tenants have a slug and URL `<slug>-onprem-console.getoffgridai.co`. | **Routing RESOLVED** (2026-07-07): switched to a **first-level hyphenated** host (`wednesdaysol-onprem-console.getoffgridai.co`) so the zone's universal `*.getoffgridai.co` cert covers TLS — verified `200`, `ssl_verify_result=0`, no regressions. Wildcard DNS `*.getoffgridai.co`→tunnel + tunnel ingress `*.getoffgridai.co`→:3000 (last rule before 404) are live. (The earlier 2nd-level dotted scheme was TLS-blocked by universal-cert scope + a CF token lacking SSL perms — abandoned.) **REMAINING:** the subdomain currently just reaches the console under the *session* org — it does NOT yet scope to the tenant's org. True isolation needs middleware host→tenant resolution **with a membership check** (`currentOrgId` is session-based by design; letting the host set the org without a check would be a cross-tenant leak). Build that as its own security-reviewed step. **Phase F 2026-07-09: scoping confirmed NOT engaging for bearer/service requests — see G-F1.** | ✅ routing · 🔴 scoping (G-F1) |
| S3 | **cloudflared fragility on S1** | The tunnel serves everything. | **TWO** `cloudflared … run` processes for the same tunnel + a `sh -c pkill/restart` wrapper, and the daemon is **not** managed by launchd (`launchctl … system/co.getoffgridai.cloudflared` → "not found"), so config reloads rely on `kill -HUP <pid>` of the real processes (SIGHUP to the wrapper shell does nothing). | Consolidate to ONE cloudflared under a proper launchd job (KeepAlive) so restarts/reloads are reliable and it survives reboot; remove the duplicate + the pkill wrapper. | 🟡 |

_Other sweep findings (from the doc-deepening agents) still to be consolidated here._

## Phase D — big integrations (2026-07-07)

| # | Surface | State | Detail |
|---|---|---|---|
| D1 | **Temporal durable agent runs (#12)** | 🟢 code + 🟡 prod-flag | 3 inline agent-run trigger routes now go through the durable dispatch seam; injectable-deps SOLID seam + 7 tests; verified live via a manual worker (`mode:durable`, workflow COMPLETED). Code deployed. **Off in prod** until the infra flip: set `OFFGRID_QUEUE_ENABLED=1` + bootstrap the `co.getoffgridai.agent-worker` plist + restart console. Honest inline degradation until then. |
| D2 | **Cloud-provider model routing (#26)** | 🟢 LIVE-verified | Console `cloud-*.ts` forwards `public`→cloud through a configured OpenAI-compatible provider; governance invariants (PII/block/egress-off never reach cloud) enforced in a pure chokepoint + tested; cost→FinOps + egress→audit. **Wired live** via OpenRouter as the `compat` provider: `/api/v1/gateway/providers` → compat `configured/up/200/available`. Full `public`→cloud chat completion to capture in Phase F (browser session). |

## Bharat Union Bank tenant epic (2026-07-07)

| # | Surface | State | Detail | Status |
|---|---|---|---|---|
| T1 | **Bharat tenant DATA** | Seeded live | org `org_bharat` / slug `bharatunion` + tenant-admin user. Source systems: 5k customers (PAN/masked-Aadhaar/IFSC/UPI), ~10k accounts, 50k txns, 6k policies, 3k claims, 40 branches, 4k invoices, 5k GL. Console (org-scoped): 5 connectors, 12 data-domains, 6 governed apps, 32 app_runs, 5 agents + 30 agent_runs, evals+golden, 8 masking rules, 6 virtual keys, 12 devices, 60 audit + 250 gateway OpenSearch docs. Idempotent (`bh_`/`source='bh_seed'`). | 🟢 |
| T2 | **Global tables lack `org_id` — cross-tenant leak** | ✅ RESOLVED 2026-07-07 | Added `org_id` to `custom_agents`, `prompts`, `org_knowledge_collections`, `eval_runs`; scoped every list/create/get/update/delete + retrieval + agent-run path by `currentOrgId` (children — prompt_versions, knowledge docs/chunks — inherit via parent-org guard). Migration applied live (+ filter indexes). SOLID: role→permission split into `role-permissions.ts`. Real-DB isolation tests (`test/org-scoping.integration.test.ts`, 4/4): a list scoped to org A excludes org B; cross-org get/update/delete denied. Deployed. | ✅ |
| S4 | **Storage — nested-key public files 401** | ✅ RESOLVED | middleware `FILE_GET` only matched single-segment keys; widened to `/files/.+`; extracted pure `route-access.ts` + 10 real tests. Deployed. | ✅ |
| S5 | **Policy decision read-back empty** | ✅ RESOLVED | New `policy-decision-log.ts` ring buffer; the policy port mirrors every ABAC/OPA decision; `readDecisions()` falls back to it when no external decision-log URL. Unit + real-DB integration tests. | ✅ |
| S6 | **DSAR / right-to-erasure capture-only** | 🟡 executes + honest | New pure `erasure.ts` planner; the route now runs real parameterized DELETEs across console-owned tables and returns `{erasedRows, results, deferred}`. Vector-index / external-lake / device-replica propagation reported as `deferred` (needs those stores' seams) — surfaced, not silently stubbed. Tests added. | 🟡 |
| S7 | **Vector-inspector misleading "0 / unreachable"** | ✅ RESOLVED | `retrieval-view.ts` gains pure `usingEmbeddedStore` + `retrievalNote()`; UI shows an affirmative "served by the built-in embedded store" state instead of an alarm when the embedded adapter is active. Tests extended. | ✅ |
| T3 | **Tenant subdomain routing (`<slug>-onprem-console`)** | 🟡 blocked on infra | Scoping LOGIC built + unit-tested (host→slug→org, membership-checked); tenant reachable under the base host as its org for a platform admin. But the vanity subdomain 404s at the **Cloudflare edge** — root cause is gap **S3** (two cloudflared processes, not launchd-managed; a stale one answers without the wildcard/route). Needs the S3 consolidation (one launchd-managed cloudflared) done carefully — it serves the whole fleet. Explicit per-tenant DNS record added for bharatunion (correct pattern once S3 is fixed). **Phase F 2026-07-09: the vanity subdomain now RESOLVES (200 through the tunnel) — but a bearer request on it still reads the `default` org, not org_bharat (root cause is G-F1 in `currentOrgId`, not the edge). Verified: `GET /apps` on `bharatunion-onprem-console.getoffgridai.co` → `orgId:"default"`, DB has 6 org_bharat apps.** | 🔴 scoping (G-F1) |

---

## How an item gets closed

1. Reproduce with the probe in its row (read-only).
2. Fix the wiring (env var, key, index, service reachability) — capture the out-of-code change in
   `deploy/onprem/SERVER_STATE.md` in the same step.
3. Re-run the probe; paste the passing output as evidence.
4. Flip to 🟢/✅ here, and confirm the in-product signal in `user/VERIFY.md` now reads "real."

---
## Reconciliation 2026-07-09 (post-fix batch — verified live)
- **G-F1 (S2/T3 scoping) → 🟢 RESOLVED + VERIFIED LIVE.** `bindTenantOrg` now feeds `currentOrgId` the verified bearer/break-glass principal. Proof: admin bearer + `Host: bharatunion-onprem-console.getoffgridai.co` → `GET /api/v1/admin/apps` returns **org_bharat** apps (bhapp_xsell…); `Host: wednesdaysol-…` → `[]` (no leak). Per-tenant machine scoping works.
- **G-F2 (Indian BFSI PII) → 🟢 RESOLVED + VERIFIED LIVE.** `/pii/scan` "my PAN is ABCDE1234F" → `entities:["IN_PAN"], redacted:"my PAN is <IN_PAN>", engine:presidio`. Regex floor + Presidio defaults both carry IN_PAN/IN_AADHAAR/IN_IFSC/UPI.
- **PA-16a (durable app-run enforcement) → 🟢** contract now resolved + enforced on the Temporal worker path (was skipped). **Chat governance (PA-16b chat) → 🟢** (durable + guarded). **Presidio (#2) → 🟢 live** (engine:presidio). **Durable workers (#12) → 🟢 live** (agent/app/chat workers running, OFFGRID_QUEUE_ENABLED=1).
- **Still open (NOT #207 blockers):** G-F3 (grounding on lexical fallback — needs model-NLI adapter), G-F4 (data-quality GE stub — needs real GE engine), PA-11 (public pipeline run doesn't fully execute the model), PA-10/PA-13 (small), S3 (cloudflared consolidation — on-site), design gaps PA-3/4/6/8/9.
