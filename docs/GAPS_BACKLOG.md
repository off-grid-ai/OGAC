# Gaps backlog — the working list

Consolidated, prioritized gaps from the demo walkthrough, service-capability audit, docs audit, and
the cross-cutting mandates. This is the list we work from. Sources: `DEMO_WALKTHROUGH.md`,
`SERVICE_CAPABILITY_AUDIT.md`, `DOCS_GAPS.md`, `ROADMAP.md` (mandates).

**Priority:** P0 = before the demo · P1 = high-value next · P2 = later.
**Owner:** `console` (my domain) · `infra` (aux tier / fleet — coordinate with the other session).
**No mock data** — anything below is either real config, wiring to a live service, or a build task.

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
| 12 | **Temporal durable agent runs** | Temporal (scaffold only) — biggest unbuilt integration; Phase 6/8. | console + infra | L |
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
