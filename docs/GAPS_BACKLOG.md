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
| 21 | Screenshots/walkthroughs on capability guides | console + Mac |
| 22 | Syntax highlighting + per-connector setup detail | console (needs a dep) |
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
