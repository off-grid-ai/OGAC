# Console audit — 2026-08-05 — CONFERENCE DEMO READINESS

**The lens: this is a demo audit, not production hardening.** The founder is taking the console on
stage to showcase what the product can do. There are no live customer deployments. The only question
for any finding is **would this be seen, and would it cost him the room?**

Severity: **DEMO-BLOCKER** (breaks, embarrasses or lies on stage — an empty chart on a populated
system, a visibly wrong number, a dead link, a permanent spinner, a "coming soon" badge, jargon a
business audience cannot read, anything that fails on the first obvious click) · **DEMO-RISK**
(survives the rehearsed path, fails one obvious follow-up question or one off-script click) ·
**POST-DEMO** (real defect, invisible on stage — one line, no effort).

Explicitly out of scope: backend correctness with no visible symptom, tenant scoping that produces no
visibly wrong number, races, auth hardening, self-approval, idempotency, DRY, tests, code structure.
The full brief is in the session scratchpad as `demo-lens.md`.

**Every team writes to its own file AS IT WORKS.** The first run of this audit lost five of nine teams
to a session limit and every finding they had gathered died with them — a report that only exists in
an agent's context is not a report.

**Every team looks at screenshots.** `scripts/audit-shoot.mjs` signs in, shoots each route at 1600px
(`--dark` for a dark-theme copy), and writes a `report.json` flagging narrow-column geometry,
horizontal scroll, redirects and console/HTTP errors. The JSON is not the finding — the instruction is
to open the PNG and judge it as a projected 16:9 image seen from row 10.

## Files

| File | Scope | Lens | Status |
| --- | --- | --- | --- |
| `demo-narrative.md` | **The end-to-end 10-minute demo** — flow, dead ends, empty surfaces, recommended route order | demo | **complete** |
| `demo-governance-insights.md` | Governance + Insights, re-scored for the stage | demo | in progress |
| `demo-gateway-operations.md` | Gateway / services / devices + observability, re-scored | demo | in progress |
| `data.md` | Data + Storage (41p) | demo | in progress |
| `runtime.md` | AI Runtime (23p) | demo | in progress |
| `solutions-build.md` | Solutions + Build (88p) — **the headline demo** | demo | in progress |
| `work-workspace.md` | Work + Workspace (24p) — human-in-the-loop | demo | in progress |
| `operations.md` | Operations — capability map / nodes / backups | demo | in progress |
| `governance.md` | Governance (36p) | correctness (first pass) | complete |
| `insights.md` | Insights (40p) | correctness (first pass) | complete |
| `gateway.md` | Gateway registry / services / fleet | correctness (first pass) | complete |
| `operations-observability.md` | Logs / traces / metrics / alerts | correctness (first pass) | complete |

The four `correctness (first pass)` reports were written before the reframe. They are kept because
several of their findings are demo-fatal for exactly the reason a correctness audit noticed them —
they put a wrong thing on screen — and the two `demo-*` re-scoring passes triage them for the stage.

## Demo-fatal findings already confirmed, from the first pass

These are the ones that put something visibly wrong or empty on a screen:

- **Three of four platform-health charts query metric names that do not exist**, so a working telemetry
  pipeline renders "Not emitting yet". Four dead charts on a monitoring page. Likely a one-line-each fix.
- **An alerting page reads "Firing 0 · Pending 0 · Alert rules 0 · No active alerts"** with no rule
  engine deployed at all.
- **The insurer tenant's own compliance page shows "PII masking (A9) — GAP — 0/0 rules enabled"** while
  8 rules are configured and enforcing — a red GAP badge on a compliance screen.
- **A failed provenance read renders as "0 signed records"** — three zero tiles on the page whose whole
  job is proving tamper-evidence.
- **Drift says "drift detected, engine proven"** when the only thing that changed is which evaluator
  ran (live: mean 90.3 → 32.3 by evaluator mix). Six `pii_leakage` runs at score 0 — a *perfect*
  result on a lower-better metric — are averaged in as 0% quality.
- **A gateway can render green "up" with the text "3 of 3 nodes up" while every node is degraded.**
- **`data-quality` (:8944) is genuinely down** — Caddy binds the port and answers 502 with no backend,
  so there is a failing tile on the services grid today.
- **The devices page is a "coming soon" card with zero interactive elements**, and its detail route
  404s on a fresh install.
- **Engine names as user-visible labels**: raw `dependency.serviceId` chips render `postgres`, `redis`,
  `opensearch`, `litellm`, `keycloak`, `qdrant`; service labels say "LiteLLM Router", "SeaweedFS",
  "Redis", "FleetDM (osquery)"; the quality surfaces say "Evidently is selected and configured",
  `Engine: ragas 0.2.x`, and show raw metric ids `score_psi` / `mean_delta`.
- **A registry failure renders as "No gateways registered yet. Add one, or seed the samples with
  POST /api/v1/admin/gateways/seed"** — a curl command on screen.
