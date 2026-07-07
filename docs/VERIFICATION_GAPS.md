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
| S1 | **Brain — new-document ingest** | `POST /api/v1/admin/brain/ingest` and `/brain/documents` both **500** on the live console (2026-07-07 BFSI seed attempt). Retrieval/search of *existing* docs works, but adding NEW knowledge fails. | 500 with empty body; path is `addDocument` → `embed()` → embedded vector-store write. Consistent with the earlier "embedded store is the active one; external inspector unreachable" finding. | Reproduce on the server, capture the embed/vector-write error (find the console log), fix the ingest write path so operators can add knowledge. Blocks seeding Indian BFSI knowledge docs. | 🔴 |

| S2 | **Per-tenant subdomain — TLS blocked** | Tenants now have a slug and a URL `<slug>.onprem-console.getoffgridai.co` shown in the UI. Wildcard DNS (`*.onprem-console` → tunnel, proxied) + tunnel ingress (`*.onprem-console.getoffgridai.co` → 127.0.0.1:3000) are in place. | `curl` → **TLS handshake failure**: Cloudflare Universal SSL covers `getoffgridai.co` + `*.getoffgridai.co` (one level only), NOT the 2nd-level `*.onprem-console.getoffgridai.co`. The CF API token used also **lacks SSL/ACM permissions** (`Authentication error` on `/acm/total_tls` + certificate-pack order). | Provision an edge cert for the 2nd-level wildcard: enable **Total TLS** or order an **Advanced Certificate Manager** pack for `*.onprem-console.getoffgridai.co` (paid add-on) with a CF token that has **SSL and Certificates: Edit**. DNS + tunnel are ready; only the cert is missing. Alternative: use first-level `<slug>.getoffgridai.co` (covered by the universal cert) with a reserved-slug guard. | 🟡 |

_Other sweep findings (from the doc-deepening agents) still to be consolidated here._

---

## How an item gets closed

1. Reproduce with the probe in its row (read-only).
2. Fix the wiring (env var, key, index, service reachability) — capture the out-of-code change in
   `deploy/onprem/SERVER_STATE.md` in the same step.
3. Re-run the probe; paste the passing output as evidence.
4. Flip to 🟢/✅ here, and confirm the in-product signal in `user/VERIFY.md` now reads "real."
