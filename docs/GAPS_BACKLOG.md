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
| 25 | Provenance signing — is it default on chat/agent runs, or only report export? |
| 26 | Cloud routing — framework exists, no cloud provider clients wired (local-only today) |
| 27 | Permissions-aware retrieval — real-time source-permission binding vs. project/ABAC scoping |
| 28 | Backups restore path — verify end-to-end; DR failover not configured |

## Notes
- The console covers the operational 80% of each service (CRUD + actions an operator needs); deep
  admin tails (Keycloak realm config, etc.) live in each service's own UI by design — not gaps.
- Genuine build gaps are #12–20. The demo-blockers are #1–5 (mostly config + real content, not
  builds).
