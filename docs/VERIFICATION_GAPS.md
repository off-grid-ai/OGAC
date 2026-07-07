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
| V1 | **Guardrails / PII masking** | Running on the **regex floor**, not the real recognizer service — the real one (Presidio on g6) is reachable from a shell but the launchd next-server can't reach the loopback forwarder; needs an edge-Caddy reload (staged, pending a maintenance window). | GAPS_BACKLOG #2 | Does a masking **preview** in the console redact a fake SSN/email? If regex-only, note which entity types silently pass through. |
| V2 | **Observability / SIEM audit search** | OpenSearch is up, but the SIEM view reads a **different index** (`offgrid-audit`) than the one that has data (`offgrid-gateway`); `offgrid-audit` is empty until governed runs ship audit to it. | GAPS_BACKLOG #6 | Does the audit/SIEM search return rows after a real governed run? |
| V3 | **Observability / traces** | Trace backend (Langfuse) is up on g6; unverified that the Observability page actually **renders** traces. | GAPS_BACKLOG #5 | Do traces appear on the page after a real chat/run? |
| V4 | **Chat / Brain grounding** | Retrieval works only if there's **real ingested content**; with an empty knowledge base, answers won't carry citations and it looks "broken." | GAPS_BACKLOG #3 | Ask Chat a question your ingested docs cover — does the answer carry clickable citations? |

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

| S2 | **Per-tenant subdomain — routing ✅ / org-scoping pending** | Tenants have a slug and URL `<slug>-onprem-console.getoffgridai.co`. | **Routing RESOLVED** (2026-07-07): switched to a **first-level hyphenated** host (`wednesdaysol-onprem-console.getoffgridai.co`) so the zone's universal `*.getoffgridai.co` cert covers TLS — verified `200`, `ssl_verify_result=0`, no regressions. Wildcard DNS `*.getoffgridai.co`→tunnel + tunnel ingress `*.getoffgridai.co`→:3000 (last rule before 404) are live. (The earlier 2nd-level dotted scheme was TLS-blocked by universal-cert scope + a CF token lacking SSL perms — abandoned.) **REMAINING:** the subdomain currently just reaches the console under the *session* org — it does NOT yet scope to the tenant's org. True isolation needs middleware host→tenant resolution **with a membership check** (`currentOrgId` is session-based by design; letting the host set the org without a check would be a cross-tenant leak). Build that as its own security-reviewed step. | ✅ routing · 🟡 scoping |
| S3 | **cloudflared fragility on S1** | The tunnel serves everything. | **TWO** `cloudflared … run` processes for the same tunnel + a `sh -c pkill/restart` wrapper, and the daemon is **not** managed by launchd (`launchctl … system/co.getoffgridai.cloudflared` → "not found"), so config reloads rely on `kill -HUP <pid>` of the real processes (SIGHUP to the wrapper shell does nothing). | Consolidate to ONE cloudflared under a proper launchd job (KeepAlive) so restarts/reloads are reliable and it survives reboot; remove the duplicate + the pkill wrapper. | 🟡 |

_Other sweep findings (from the doc-deepening agents) still to be consolidated here._

## Bharat Union Bank tenant epic (2026-07-07)

| # | Surface | State | Detail | Status |
|---|---|---|---|---|
| T1 | **Bharat tenant DATA** | Seeded live | org `org_bharat` / slug `bharatunion` + tenant-admin user. Source systems: 5k customers (PAN/masked-Aadhaar/IFSC/UPI), ~10k accounts, 50k txns, 6k policies, 3k claims, 40 branches, 4k invoices, 5k GL. Console (org-scoped): 5 connectors, 12 data-domains, 6 governed apps, 32 app_runs, 5 agents + 30 agent_runs, evals+golden, 8 masking rules, 6 virtual keys, 12 devices, 60 audit + 250 gateway OpenSearch docs. Idempotent (`bh_`/`source='bh_seed'`). | 🟢 |
| T2 | **Global tables lack `org_id` — cross-tenant leak** | ✅ RESOLVED 2026-07-07 | Added `org_id` to `custom_agents`, `prompts`, `org_knowledge_collections`, `eval_runs`; scoped every list/create/get/update/delete + retrieval + agent-run path by `currentOrgId` (children — prompt_versions, knowledge docs/chunks — inherit via parent-org guard). Migration applied live (+ filter indexes). SOLID: role→permission split into `role-permissions.ts`. Real-DB isolation tests (`test/org-scoping.integration.test.ts`, 4/4): a list scoped to org A excludes org B; cross-org get/update/delete denied. Deployed. | ✅ |
| S4 | **Storage — nested-key public files 401** | ✅ RESOLVED | middleware `FILE_GET` only matched single-segment keys; widened to `/files/.+`; extracted pure `route-access.ts` + 10 real tests. Deployed. | ✅ |
| S5 | **Policy decision read-back empty** | ✅ RESOLVED | New `policy-decision-log.ts` ring buffer; the policy port mirrors every ABAC/OPA decision; `readDecisions()` falls back to it when no external decision-log URL. Unit + real-DB integration tests. | ✅ |
| S6 | **DSAR / right-to-erasure capture-only** | 🟡 executes + honest | New pure `erasure.ts` planner; the route now runs real parameterized DELETEs across console-owned tables and returns `{erasedRows, results, deferred}`. Vector-index / external-lake / device-replica propagation reported as `deferred` (needs those stores' seams) — surfaced, not silently stubbed. Tests added. | 🟡 |
| S7 | **Vector-inspector misleading "0 / unreachable"** | ✅ RESOLVED | `retrieval-view.ts` gains pure `usingEmbeddedStore` + `retrievalNote()`; UI shows an affirmative "served by the built-in embedded store" state instead of an alarm when the embedded adapter is active. Tests extended. | ✅ |
| T3 | **Tenant subdomain routing (`<slug>-onprem-console`)** | 🟡 blocked on infra | Scoping LOGIC built + unit-tested (host→slug→org, membership-checked); tenant reachable under the base host as its org for a platform admin. But the vanity subdomain 404s at the **Cloudflare edge** — root cause is gap **S3** (two cloudflared processes, not launchd-managed; a stale one answers without the wildcard/route). Needs the S3 consolidation (one launchd-managed cloudflared) done carefully — it serves the whole fleet. Explicit per-tenant DNS record added for bharatunion (correct pattern once S3 is fixed). | 🟡 |

---

## How an item gets closed

1. Reproduce with the probe in its row (read-only).
2. Fix the wiring (env var, key, index, service reachability) — capture the out-of-code change in
   `deploy/onprem/SERVER_STATE.md` in the same step.
3. Re-run the probe; paste the passing output as evidence.
4. Flip to 🟢/✅ here, and confirm the in-product signal in `user/VERIFY.md` now reads "real."
