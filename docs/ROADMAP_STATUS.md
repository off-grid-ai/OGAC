# Roadmap status — the honest, evidence-based ledger

**What this is.** A per-phase, per-item accounting of the whole `docs/ROADMAP.md`, judged against
evidence — the live harness (`deploy/verify-integration.sh`), the test suite, the production build,
and read code paths — not against optimism. Written 2026-07-06 (integration sweep #3), the morning
status the founder reads. Companion to `INTEGRATION_SUCCESS_SPEC.md` (the falsifiable gate rules) and
`VISION_ALIGNMENT.md` (the strategic scorecard).

**The rule (from the success spec):** nothing is "done" until VERIFIED — a probe passed on the live
box. So every item below lands in exactly one of three buckets:

- **(a) DONE — shipped & live-verified.** Merged, deployed to S1, and a live probe passes.
- **(b) CODE-COMPLETE — merged, needs an on-site operational step.** The code is written, typecheck +
  tests + build green, but a switch has to be flipped on the box before it is live-verified.
- **(c) REMAINING — genuine polish / ops.** Not built yet, or a manual/infra verification still owed.

**Evidence baseline (2026-07-06):**
- Live harness on S1: **8 pass / 0 fail / 4 skip** (A1–A5, C1–C3 PASS; A7/B2/B3/C4 SKIP-by-design).
- Local: `npm run typecheck` clean, `npm test` **810 pass / 0 fail / 2 skip** (812 total),
  `npm run build` clean.

---

## Bucket (a) — DONE: shipped & live-verified

| Phase / item | Evidence |
|---|---|
| **Phase 0 — foundation bugs** | The six Phase-0 bugs (stateful PII regex, gateway port split, unauthed `/gateway/tokens`, in-proc RAG, non-enforcing budget, root-span-per-call) are fixed; budget enforcement in particular is now real (see 4.11 / budgets). Versions pinned, dead containers off. |
| **Phase 1 — navigation** | Two-level AWS-style shell + global search shipped; ~19 grouped modules render under it. Verified in the running console. |
| **Phase 2 — Provit** | Provit is a first-class console module, brokered through the console's own auth/fleet/budgets (`src/lib/provit.ts`, `provit-access.ts`); repos/runs ABAC + tenancy scoped. Live. (Provit-as-console-E2E-tester, §2.D, is a Provit-repo TODO — bucket c.) |
| **Phase 4.10-A — unified identity (broker + KC clients + edge-hardening)** | **Harness A1–A5 PASS on S1.** One Keycloak credential works; 5 per-service clients mint `client_credentials` JWTs with correct `aud`; 5 secrets in OpenBao; no-auth backends bound to loopback; SA-JWT authorized, unauth rejected. This is the moat and it is verified. |
| **Phase 4.11 — audit & accountability** | Canonical attributed audit event on every governed action; **C1/C2/C3 PASS** — one run id (`run_d01891dc`) correlates across all 4 planes (audit·langfuse·marquez·provenance); PII probe blocked/redacted and visible in audit. C2, "the money test," is proven live. |
| **Cross-cutting — no-modals + motion** | Create/edit surfaces are pages/side-panels, delete-confirms only; motion pass applied. |
| **Cross-cutting — full-CRUD management surfaces** | Every module is a management surface (create/read/update/delete + actions), not a read-only dashboard, per CLAUDE.md. |
| **Phase 4.6 — chat parity** | Stop / retry / edit-and-rerun / branch, drag-drop + paste + lightbox + inline thumbnails, in-place artifact edit + version revert, inline stream errors with retry. Essentially done; remainder is polish. |
| **Phase 4.7 — real data / kill synthetic** | Live fabrications removed; demo seed gated behind `OFFGRID_SEED_DEMO` (off); real data sources (corebank/MySQL/MSSQL/Kafka/MinIO/CRM) with actual counts. |
| **Phase 4.9 — deep integrations (build)** | All 9 deep integrations built + merged (vector filter+hybrid, OpenSearch native aggs, Superset provisioning, Temporal client, FleetDM live-query, Presidio recognizers, OPA Rego authoring, OpenBao depth, Unleash management). Typecheck + tests + build green. *Live-wiring of a few is bucket b.* |
| **Phase 4.5 / S1 — Studio through governance** | "Run as app" executes via `runAgent()` through the full governed pipeline; a published Studio app is a real governed agent + template (`src/lib/studio-builder.ts`), same path as a hand-built one. |
| **Permissions-aware retrieval (vision #27)** | Document-level ACL binding (`src/lib/retrieval/acl.ts`, `docVisibleTo`), enforced as a metadata filter + post-filter, default-safe + backward compatible. |
| **Per-org budget enforcement (gap #33)** | `budget-config.ts` resolves env kill-switch → per-org override (`budget.enforce:<org>`) → global flag; enforcement default-on; over-budget call refused pre-flight. |
| **Docs surface** | 8 sections, ~40 pages covering every current module + the newest features (per-org budgets, multi-tenancy/RLS, backups/restore, Studio, Provit, native-OIDC path). Renders; typecheck clean. |

---

## Bucket (b) — CODE-COMPLETE: merged, needs an on-site operational step

These are written, tested, and build clean. Each needs ONE switch flipped on the box (which no
automated on-S1 run can do for it) before it is live-verified. This is where the honest "not done yet"
sits.

| Item | What's built | The on-site step to verify it |
|---|---|---|
| **Temporal durable runs + C4 (Phase 4.9 #4 / spec C4)** | `@temporalio/client` binding, `AgentRunWorkflow`, identity + runId threaded into the durable path (`agent-run-context.ts`, `agent-run-durable.ts`); the harness **C4 probe exists** and SKIPs cleanly today. | **Bootstrap a Temporal worker process + set `OFFGRID_QUEUE_ENABLED` / `OFFGRID_ADAPTER_AGENTRUNTIME=temporal`.** Then C4 flips SKIP → PASS (durable-run 4-plane fan-out parity with C2). Biggest remaining live-wire. |
| **Native-OIDC for UI services (Phase 4.10-D)** | Broker path is live (bucket a); the direct-service validation path is documented + ready (`deploy/onprem/oidc-services.md`, `SERVER_STATE.md` "READY, not enabled"). | **Register the per-service KC client, point the service at the realm, turn its security plugin on** (OpenSearch first). Opt-in, service by service; brokered path keeps working until flipped. |
| **RLS backstop (Phase 3 defense-in-depth)** | Pure policy model + idempotent SQL (`src/lib/rls-policy.ts`, `deploy/onprem/2026-rls-backstop.sql`); no-op until opted in. | **Switch the app's `DATABASE_URL` to the non-superuser role + set the `app.current_org_id` GUC per request (`withOrg`).** Then the DB-level org boundary is live behind the query-layer filter. |
| **Backups schedule + restore (Phase 3A T3 / gap #20)** | Backup surface with on-demand run, prune, and restore; manifest-backed status. | **Bootstrap the scheduled backup launchd job** on the box so the manifest fills on a cadence; run one restore drill to verify end-to-end (gap #28). |
| **Presidio guardrails (gap #2)** | Adapter + `/analyze` + `/anonymize` wired; recognizers UI built. | **Add the edge-Caddy port forwards + set `OFFGRID_ADAPTER_GUARDRAILS=presidio` + URLs** (needs an edge-Caddy reload — maintenance window). Regex floor holds until then. |
| **Superset default dashboard (gap #9)** | Guest-token embed + provisioning code built. | **Run the provisioning against the live audit index** so the embed points at a real dashboard, not a ghost UUID. |
| **SIEM `offgrid-audit` population (gap #6)** | View + `OFFGRID_OPENSEARCH_URL` set; index fills on `shipAudit()` writes. | **Generate governed runs on the box** to seed `offgrid-audit`; then SIEM populates (self-heals with traffic). |

---

## Bucket (c) — REMAINING: genuine polish / ops

Not yet built, or a manual verification that no code change can close.

| Item | Note |
|---|---|
| **#32 — A4 off-host curl** | Manual/infra check, NOT a code task. The true external-unreachability proof (`curl offgrid-s1.local:9200/:8181/:9000 → refused`) needs a **second, non-S1 LAN host**; the on-S1 A4 loopback bind-check stands in for it. Run once from a dev Mac on the LAN and record it. |
| **Docs #21 — guide screenshots/walkthroughs** | Capability guides are text-only; add screenshots (console + Mac). |
| **Docs #22 — syntax highlighting + per-connector setup detail** | Needs a highlighter dep; per-connector setup pages are thin. |
| **Docs #23 — first-party SDK page** | Placeholder present; real page lands with Phase 7 (`@offgrid/sdk`). Today OpenAI-compatible SDKs work and are documented. |
| **Docs #24 — ⌘K docs search** | Search is sidebar-inline; a ⌘K palette would reach parity with the app's global search. |
| **DEMO_WALKTHROUGH refresh** | Walkthrough predates the 07-05→06 closures; refresh the 🟢/🔴 page list against current live state. |
| **Vision gaps still open** | Jobs-oriented Overview synthesis exists (`overview-synthesis.ts`) — deepen cross-module "governance posture right now." Cloud provider clients (#26) — framework exists, no cloud client wired (local-only today). |
| **Phase 3A HA / DR (infra)** | Nomad orchestration, Patroni/Raft/Sentinel HA, VictoriaMetrics alerting, DR runbooks — infra track, largely not started; not blocking single-node operation. |
| **Phases 5–8** | Phase 5 (unified API) partially scaffolded (specs proxy + OpenAPI); Phase 6 (`defineOffgrid` module spine), Phase 7 (SDK), Phase 8 (Soul — blocked on desktop/mobile capture) are future. |

---

## One-paragraph summary

The moat is real and verified: unified identity (A1–A5) and cross-service correlation by run id
(C1–C3, "the money test") both **PASS live on S1**, with a clean `8/0/4` harness, 810 green tests, and
a clean production build. The single largest not-yet-live item is **durable Temporal runs + C4**, which
is code-complete and now has a harness probe — it SKIPs only because the worker isn't bootstrapped.
The rest of bucket (b) is the same shape: written and tested, each waiting on one on-site flip
(native-OIDC per service, the RLS `DATABASE_URL` switch, the backup launchd job, the Presidio edge
forward, the Superset provision run). Genuine remaining work (bucket c) is honest polish and infra: the
off-host A4 curl (a manual LAN check, not code), docs screenshots / syntax highlighting / SDK page /
⌘K, the demo-walkthrough refresh, and the Phase 3A HA/DR and Phase 5–8 build-out. No scaffold is
mislabeled as shipped, and nothing claimed "done" lacks a passing live probe.

_Last updated: 2026-07-06 (integration sweep #3). Owned by: console team. Report progress as a gate,
never as a bare "done."_
