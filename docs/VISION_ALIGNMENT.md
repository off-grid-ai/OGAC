# Vision-alignment scorecard — does the console match the grand product vision?

**Question (founder, 2026-07-06):** does what we built match the grand platform-as-a-product vision?
**Method:** a skeptical read of `docs/VISION.md` + `brand/` + roadmap against the actually-built
surfaces. This is the *strategic* measuring stick (distinct from the tactical harness / tests).

> ⚠️ **Staleness note:** the first pass read the capability/spec docs, which described the
> pre-2026-07-06 state. Many items it flagged "missing" were **closed in the 2026-07-05→06 session**
> (see the correction column). This doc is the reconciled version.

> **✅ RECONCILED 2026-07-06 (overnight build).** The "still-open" items called out below were CLOSED
> this session and are merged + (mostly) deployed + live-verified: **budget enforcement** (402 deny +
> audit, default-ON, per-org), **permissions-aware retrieval** (document-scoped ACL), **jobs-oriented
> Overview** (synthesized operator home), **native-OIDC Phase D** (config ready-to-flip), **C4** (durable
> runs carry identity — code-complete, flips live once the Temporal worker is bootstrapped). Also
> shipped: Studio real builder, Provit deep-integration, Keycloak realm admin, Marquez/Langfuse/
> OpenSearch/FleetDM/OpenBao/Superset/Unleash depth, full audit+accounting, RLS backstop + backups.
> Live harness: **8 PASS / 0 FAIL / 4 SKIP** (C2 4/4). Authoritative current state:
> `ROADMAP_STATUS.md`. The pillar table + lists below are the pre-session snapshot, kept for history.

## The vision, in 4 pillars (from VISION.md)
1. **Harness internal intelligence** — connectors → ingest → permission-aware retrieval → cited answers, on-prem.
2. **Leverage external intelligence, leashed** — one OpenAI-compatible gateway; default-local; policy gates cloud egress; no PII leaves the box.
3. **Unified governance spine** — one policy engine, one PII scanner, one audit ledger, one identity, one cost attribution. *Integration is the moat.*
4. **Operator management surface** — one console where ops/compliance/builder/finance personas *run* the system.

## Pillar verdicts (reconciled to actual current state)

| Pillar | Verdict | Evidence / what changed this session |
|---|---|---|
| 1 — Internal intelligence | 🟡→🟢 partial-strong | Connectors + ingest + cited chat real. **Vector metadata-filtering + hybrid BM25 shipped this session** (was the RAG-quality gap). **Still open:** document-scoped permission binding (retrieval is project-scoped, not per-source-ACL). |
| 2 — Leashed external intelligence | 🟢 mostly | Gateway + routing-policy leash (PII→local/block) real + tested; gateway now runs on a **real Keycloak JWT** (verified). No response cache / per-request fallback chain (surfaced honestly, not faked). |
| 3 — Unified governance spine | 🟡→🟢 the big mover | **This is the moat and it moved most.** Identity: broker + per-service credentials **provisioned + verified live (harness A1/A2/A3/A5 PASS)**. Audit: canonical attributed event on every action + **C2 run-id correlation VERIFIED 4/4 live** (audit+trace+lineage+provenance). OPA Rego authoring, OpenSearch native aggs, Presidio recognizers all shipped. **Still open:** budget ENFORCEMENT (alerts fire, inference doesn't stop — Phase-0 bug, untouched); native-OIDC Phase D (services validate KC tokens directly vs console-brokered); C4 (durable runs carry identity — in flight). |
| 4 — Operator surface | 🟡 partial | ~19 grouped modules, full CRUD, no-modals + motion done. **Still open:** jobs-oriented Overview + cross-module synthesis ("governance posture right now" spanning audit/policy/guardrails); section landings are nav hubs, not dashboards. |

## The "is it the product?" test
A compliance officer would now recognize it far more than the stale docs imply: they **can** pull one
run id and see it correlated across audit + trace + lineage + provenance (C2 verified). What they still
**can't**: (a) set a budget that actually stops inference; (b) be sure retrieval respects per-document
permissions; (c) land on a synthesized governance-posture home. Those are the honest remaining gaps.

## Genuinely still-open, vision-critical (nothing this session closed)
1. **Budget enforcement** — two budget systems, neither denies; alerts fire, inference continues. Tier-0, directly contradicts the governance promise. **S effort.**
2. **Permissions-aware retrieval** — document/source-scoped ACL binding, not just project scope.
3. **Jobs-oriented Overview + cross-module synthesis** — the operator "home" the vision describes.
4. **Native-OIDC (Phase D)** + **C4 durable-run identity** — finish the "one identity everywhere" story for the async + direct-service paths.

## DRIFT — built, but adjacent to the core thesis
Provit (visual-QA), Evals, Sandbox, Regulatory (stub) are credible but orthogonal to "governance-first
intelligent enterprise." Not wrong — but watch that breadth doesn't outpace the moat. The recent shift
to deep-integration work over new surfaces is the right correction; keep it.

## Recommendation (reconciled — highest leverage next)
1. **Budget enforcement** (S) — the one Tier-0 governance gap left; make `checkBudget` deny (402), one budget system.
2. **Permissions-aware retrieval** (M) — per-document ACL in the retrieval filter.
3. **Native-OIDC Phase D + C4** (M/L) — close "one identity" for direct-service + durable paths.
4. **Jobs-oriented Overview** (M) — synthesize governance posture + cost + activity into the operator home.
5. Hold the line on the honesty rigor (VERIFIED-gate, no "largely complete" without a probe) — it's a leadership asset.

*Full narrative in the session transcript (2026-07-06 vision audit). Verdicts reconciled against the harness (8 PASS / 0 FAIL / 3 SKIP) + the session's merges.*
