# Governance, Access, Secrets, Trust, Evidence — viewer-demo audit

Auditors: CISO, DPO/privacy officer, Principal UX/Usability/UI, Principal QA/QC.

Screenshots: insurer tenant confirmed as `demo-insurer@getoffgridai.co`, role **viewer**, org
`org_suraksha` at `https://suraksha-onprem-console.getoffgridai.co`, width 1600px. Bank tenant shoot
(`demo-bank@getoffgridai.co`, org for Bharat Union) running in parallel; appended once captured.

(Working notes below — will be reorganized into the final structure before this file is finished.)

## ⚠️ CONFIRMED CROSS-TENANT DATA LEAK — top finding, report first regardless of cost

**`/governance/evidence/audit` (and its underlying API) leaks the INSURER's full audit trail to the
BANK's read-only viewer, and vice-versa is architecturally certain.** Proven two ways:

1. **Screenshots**: `insurer/governance_evidence_audit.png` and `bank/governance_evidence_audit.png`
   are **byte-for-byte identical** — same 200 events, same timestamps down to the second
   (8/5/2026 8:53:23 AM …), same actors (`proof:ceiling`), same resources — and every row's Project
   column reads **`org_suraksha`** (the INSURER's org id) **on the BANK's own signed-in console**
   (confirmed session: `demo-bank@getoffgridai.co`, role `viewer`, `org: "org_bharat"`).
2. **API, direct**: `GET /api/v1/admin/audit-search` on the **bank** session
   (`https://bharatunion-onprem-console.getoffgridai.co`) returns **1015 hits spanning FOUR orgs**:
   `org_bharat` (its own, fine), **`org_suraksha`** (the insurer — leak), **`default`** (the scratch
   org — the exact case the brief calls out), and `null`. Raw insurer business detail is exposed
   through it, e.g. a resource string naming the insurer's own pipeline and internal domain id:
   `"data:dom_e633d22e-348 pipeline:pl_seed_org_suraksha_fraud-screening — \"dom_e633d22e-348\" is
   OUTSIDE the pipeline data allowlist (hard ceiling) — denied"`.

**Root cause, found and pinpointed**: `src/lib/siem.ts`'s `buildQuery()` (used by `searchAudit()`)
never filters on `org` — `AuditSearchParams.org` is declared as a field (`siem.ts:37`) but **no code
path ever reads it**. Every caller confirms the same gap:
- `src/app/api/v1/admin/audit-search/route.ts` — never reads/passes an org at all.
- `src/lib/audit-log-reader.ts` (`readAuditPage`, `readAuditForExport` — feeds
  `/governance/evidence/audit` and its CSV/JSON export) — accepts an `orgId` parameter but **only**
  uses it to decide whether to hide QA-autotest rows (`isDemoTenantOrg(orgId)`); it is never passed
  into `searchAudit()`, and the "pure post-filter" (`filterAuditRows`) the file's own comment says
  applies actor/action/project/time-range narrowing **does not filter by org either**.
- `src/app/(console)/build/pipelines/[id]/audit/page.tsx` and `src/lib/exporters/run.ts` call
  `searchAudit()` the same unscoped way — likely affected too, not yet screenshot-verified.

This is a real, live, exploitable tenant-isolation failure in the shipped audit/SIEM read path — not
a cosmetic issue. Any of the ~6 users on EITHER demo tenant (viewer or admin) can read the other
tenant's complete governed-decision history, including which pipelines exist, which data domains are
denied, and volumetrics, via a page already on both public demo links. Given the section's own
Trust & Regulatory page (`/governance/trust`) states "verified cross-surface isolation for shared
multi-tenant deployments is being hardened" — this is the concrete proof that hardening is not done.

**Fix is well-scoped, not a rewrite**: thread `org` into `AuditSearchParams`/`buildQuery()` as a hard
OpenSearch `term` filter (pre-fetch, not just a post-filter — the 2000-row over-fetch window can
otherwise still starve/hide a low-volume tenant behind a noisy one), then pass the caller's org through
at all three call sites above. This should block a release, not wait in a backlog.

**The fix pattern already exists in this codebase** — `src/app/api/v1/admin/provenance/route.ts:13-16`
has a comment reading *"ORG-SCOPED, same reason as the page: unscoped, this returned the DEFAULT
org's signed records to every tenant"* and calls `currentOrgId()` then threads it through. Confirmed
by API: bank's provenance ledger correctly returns 48 org-scoped records vs. the insurer's 50 — this
exact class of bug was found and fixed once already for provenance. It just never got applied to the
audit/SIEM path. Same fix, same shape, different file.

## Code-level findings (pre-screenshot, confirmed by reading source + API routes)

- **`/governance/secrets/overview` — "Seal vault" button is fully live, NOT wrapped in `ReadOnlyGuard`.**
  `src/components/secrets/SealControl.tsx` renders an enabled, un-muted destructive button
  ("Seal vault... Destructive — takes all secrets offline") for a viewer. Clicking it opens a native
  `confirm()` dialog reading "SEAL the vault? ... This will break every service reading from the
  secrets store," then POSTs `/api/v1/admin/secrets/seal`. Confirmed server-side the route is gated by
  `requireAdmin` → `decideAdminGate` → viewer + POST = `forbid-viewer-write` (403), so no actual outage
  results — but a stranger sees a live, destructive-looking control with zero indication they can't
  use it until after a scary confirm dialog and a failed request. Per the brief this is top-severity:
  "a write control that looks live and then fails."
  Fix: wrap in `<ReadOnlyGuard>` (already built and used elsewhere — `src/components/ReadOnlyGuard.tsx`).

- **`/governance/secrets/dynamic-database` — "Generate creds" button also fully live, not guarded.**
  `src/components/secrets/DynamicDbPanel.tsx`. Same pattern: enabled button, POSTs
  `/api/v1/admin/secrets/dynamic-db`, gated server-side (403 for viewer) but the UI gives no warning.
  This is the same shape of surface as today's live plaintext-credential leak on the connectors API —
  confirms it's a systemic gap (ReadOnlyGuard adoption), not a one-off.

- **`/governance/provenance` — "Rotate signing key" button live, not guarded.**
  `src/app/(console)/governance/provenance/RotateKeyControl.tsx`. Confirm dialog then POST
  `/api/v1/admin/provenance/rotate-key` (403 server-side for viewer, confirmed via `requireAdmin`).

- **`/governance/provenance` (ledger) — "Verify" / "Verify all" buttons live, not guarded.**
  `ProvenanceLedger.tsx` posts to `/api/v1/admin/provenance/verify/run`, same unguarded pattern.

- **`/governance/access/review` — Approve/Deny + Submit review buttons live, not guarded, on REAL
  users' names/emails/roles.** `src/components/access/AccessReviewPanel.tsx` lets a viewer click a
  decision for every person in the org and hit "Submit" (POST `/api/v1/admin/access-reviews`, gated by
  `requireAdmin`, will 403). Worse optics than the others: the flow visually invites a stranger to
  decide whether named employees keep their access, before failing.

- **Systemic root cause**: `useIsViewer()` / `<ReadOnlyGuard>` exist and are wired in exactly 2 places
  in the whole app (`src/components/build/CaseDecision.tsx`, `BulkDecideBar.tsx`,
  `src/components/data/AddConnectorButton.tsx`) — **zero adoption inside `/governance/*`**. Every write
  control enumerated above (seal/unseal, rotate key, verify, generate creds, access-review
  decide+submit) is unguarded. This is one mechanical fix applied N times, not N separate bugs.

- **Vault plumbing on screen (appropriateness).** `src/components/secrets/SecretsStatusViews.tsx`
  renders "threshold X of Y key shares", "Sealed/Unsealed", cluster/version tiles, and the literal
  OpenBao URL (`view.baoUrl`) in the "Reachable" tile's `sub` line. The brief explicitly calls out
  "unseal thresholds" and "cluster ids, versions" as vault infrastructure a stranger should not see —
  this page is built to show exactly that. Need to confirm on screen whether `baoUrl` renders a real
  hostname/port (would also be an internal-infra leak) — checking screenshot next.

## Screenshots opened so far — insurer tenant (org_suraksha)

- **`/governance/posture`** (`governance_posture.png`) — STRONG. Real stat tiles (people with access 6,
  1 source without lawful basis flagged red, access certified date, 3 teams), "Inside governance" tile
  grid links to every subsection. No jargon. Good example of the section done right.

- **`/governance/policies`** (`governance_policies.png`) — thin (two small cards, huge blank canvas
  below at 1600px) but not wrong. "Policy-as-code" is the correctly-mapped label (not "OPA"/"Rego") —
  good use of the `publicLabel()` convention on this particular screen.

- **`/governance/policies/bundles`** (`governance_policies_bundles.png`) — **BLOCKER**. The "Engine
  configuration" card literally labels a row **"OPA version"** (`0.70.0`) and **"Node id"** with a raw
  UUID (`93cfc78e-3d05-4780-b935-e0d33e64a33b`) rendered in plain text. Source:
  `src/components/governance/PolicyAuditBundles.tsx:40-41` — hardcoded `label="OPA version"` /
  `label="Node id"`. This is the exact violation the brief names by name ("OPA" on the face of the
  screen) plus a raw UUID where a name belongs. Fix: rename the label (e.g. "Policy engine version"),
  drop the "Node id" row entirely — it has no audience value.

- **`/governance/policies/decision-logs`** (`governance_policies_decision-logs.png`) — **BLOCKER**.
  "Decisions 0 / Allowed 0 / Denied 0 / Engines 0", "No decisions recorded yet," and the empty-state
  copy names a raw internal API path (`/api/v1/admin/policy/decision-logs/ingest`) to a business
  stranger. This is the screen whose entire job is to prove policy enforcement is real, on the
  headline demo tenant, showing a wall of zeros — worse than not having the screen. (Note: the org's
  actual enforcement activity clearly exists and is real — see `/governance/evidence/audit` below,
  200 real events with blocked/redacted outcomes — so the underlying fact is fine; this specific view
  is just not wired to it.)

- **Confirmed repeat bug, Policies section only**: `/governance/policies`,
  `/governance/policies/bundles`, and `/governance/policies/decision-logs` all render the *identical*
  H1 "Overview" and subtitle "Policy posture and actions." regardless of which sub-page is open —
  traced to `src/modules/contextual-navigation.ts:255` (a section-level description used as if it were
  the leaf page's own heading). Confirmed NOT a global pattern: `/governance/secrets/*` correctly
  varies its H1 per page ("Mounts", "Leases", etc.). RISK — a stranger clicking through the Policies
  sidebar could reasonably conclude the page never changed.

- **`/governance/access`** (`governance_access.png`) — real Indian-BFSI seed data, 6 users,
  `@surakshalife.example` (correctly the reserved `.example` TLD, not real-looking PII). But: **"Add
  user" button (top right) and a red trash/delete icon on every single row are fully live, un-muted,
  clickable** — `src/components/access/UsersList.tsx` has no `ReadOnlyGuard` import at all. This is the
  single highest-traffic "click the obvious button" surface in the whole audit (a table of named
  people with a delete icon staring back). List→detail works (row links to
  `/governance/access/users/[id]`, confirmed reachable via `src/app/(console)/governance/access/[id]/[userId]/page.tsx`).

- **`/governance/access/review`** (`governance_access_review.png`) — also flagged a React hydration
  error (`Minified React error #418`) in the console during capture; check the screenshot for visual
  breakage. The Approve/Deny + "Submit review" controls in
  `src/components/access/AccessReviewPanel.tsx` are unguarded and act on real named users — same
  pattern, worse optics (a stranger is invited to decide whether a named employee keeps access).

- **`/governance/evidence/audit`** (`governance_evidence_audit.png`) — GENUINELY STRONG, best screen
  in the section. 200 real events, 14 actors, 36 actions, 3 projects, filterable table with real
  timestamps (today), real `blocked` / `redacted` outcomes visible in the data (not just "ok" rows),
  real model + token + cost columns. This is what "evidence that isn't decorative" looks like — proof
  enforcement is live. Minor RISK: actor/resource cells are raw internal codes (`proof:ceiling`,
  `sink:lake pipeline:pl_seed_…`, `data:dom_e633d22e-348…`) truncated with ellipses — technically
  correct but dense/unexplained for a lay reader; not a blocker on an audit-log page but worth a
  glossary/tooltip pass.

- **`/governance/evidence/security`** (`governance_evidence_security.png`) — **BLOCKER, probably the
  single worst screen in this section.** A red error banner reads verbatim **"Could not reach the SIEM
  index: OpenSearch 401"** — the literal OSS engine name AND a raw HTTP status code, on-screen, on the
  page whose job is to prove security evidence is real. Below it: Events 0, Blocked/Denied 0, Distinct
  actors 0, Outcomes 0, "No security events recorded yet." Further down, a "Suppression rules" /
  "Alerting & retention" panel says **"OpenSearch alerting monitors... and the index-lifecycle (ISM)
  retention policy"** — more raw engine name + an OpenSearch-specific acronym ("ISM") with no gloss.
  Traced to `src/lib/siem.ts`, `src/lib/siem-view.ts`, `src/lib/opensearch-alerting.ts`,
  `src/lib/adapters/opensearch-admin.ts` — ALL of them template `` `OpenSearch ${res.status}` `` as the
  user-facing error string; this is systemic, not a one-off string. The 401 itself indicates the
  integration is presently broken on the live insurer tenant (auth failure talking to the search
  backend), despite a recent commit (`d8895ebd`) that reportedly addressed a related "OpenSearch
  offline while it was actually up" complaint — this is a *different*, still-live failure on this box.
  publicLabel()/the jargon mapper is not applied to any of these error paths.

- **`/governance/evidence` (overview)** (`governance_evidence.png`) — RISK: "22 signed answers" here
  vs "50 signed records" on `/governance/evidence/provenance` itself, and "205 events" vs "200
  Events" on `/governance/evidence/audit`. Small, but it's exactly the "inconsistency between two
  panels" class the brief names — a stranger who lands on both will notice the numbers disagree.

- **`/governance/evidence/retention`** (`governance_evidence_retention.png`) — GENUINELY STRONG copy
  ("A limit is only a setting until a sweep runs... the record proves the deletion rather than
  asserting it") across App run / Agent run / Indexed document / object-store retention, each with its
  own keep-for period and "when the time is up" policy. Also the single densest unguarded-write
  screen found: 3 editable day-count inputs, 3 "when time is up" dropdowns, 3 "Save limit" buttons, and
  a top-level **"Apply retention now"** button (destructive: deletes old records) — all live, none
  wrapped in `ReadOnlyGuard`.

- **`/governance/evidence/fairness`** (`governance_evidence_fairness.png`) — GENUINELY STRONG: honest
  "UNTESTED rather than clear" framing when sample size is too small (<20 cases) to score, explains
  the four-fifths rule in plain language, lists the sensitive attributes tested (gender, age_band,
  city, state, religion, caste) as attribute *names*, not real people's values — appropriate. "Run
  check" buttons unguarded (same systemic gap).

- **`/governance/evidence/export`** (`governance_evidence_export.png`) — **BLOCKER**: "No exporters
  yet" on an otherwise clearly-populated, active tenant — textbook "click New to get started is a dead
  end" empty state the brief explicitly prohibits for this audience. Third-party names mentioned
  (Splunk, Purview/Collibra, Grafana/Prometheus) are acceptable — real recognizable integration
  targets, not the platform's own OSS internals. "New exporter" button unguarded.

- **`/governance/egress`** (`governance_egress.png`) — **BLOCKER (jargon)**: literally renders
  **"Engine: llm-guard"** on the face of the screen — the OSS product name the brief names directly,
  with no gloss and not even present in `src/lib/lineage-labels.ts`'s mapper (confirmed by grep — no
  entry for `llm-guard` exists to map from). Also a **structural/nav bug**: this page's top header is
  completely blank (no "GOVERNANCE ▸ Egress" breadcrumb/subtitle) and the left sidebar shows
  `Governance` collapsed instead of expanded-with-Egress-highlighted like every other governance page
  — traced to `src/modules/contextual-navigation.ts` never registering an `egress` entry. A stranger
  landing here (it's linked from the Posture page's tile grid) gets a page that visually doesn't
  belong to the section it's in. Otherwise the actual feature (cloud egress DLP, mask vs. block,
  fail-closed messaging) is well-written and substantively strong.

- **`/governance/guardrails`** (`governance_guardrails.png`) — clean contrast case: PII detection is
  correctly labelled **"Built-in pattern detection"** (not "Presidio") — proof the jargon mapper does
  work when it's actually wired to a screen. Entity codes `IN_PAN`, `IN_AADHAAR`, `IN_IFSC`, `UPI_ID`
  are appropriate India-specific PII types, not internal jargon.

- **`/governance/teams`** (`governance_teams.png`) — GENUINELY STRONG, realistic insurer business
  units (Claims / Policyholder Service / Underwriting) with real domain language ("Owns FNOL,
  death-claim assessment and settlement", "the OYRT rate card"). "New team" + per-card delete icons
  unguarded (same systemic gap). List→detail via "Open →" confirmed present.

- **`/governance/trust`** (`governance_trust.png`) — GENUINELY STRONG, best "is this real" evidence in
  the section: "Trust & Security Center", honest 55% posture (11 implemented / 8 in progress / 1
  planned — not a fake 100%), controls cited against real framework clauses (Art. 15, Annex A.3,
  GOVERN 2.1, MEASURE 2.7). Notably, "Multi-tenant data isolation" is self-reported **"In progress"**
  with copy admitting isolation for shared multi-tenant deployments "is being hardened" — which the
  cross-tenant audit leak above proves correct.

- **`/governance/trust/regulatory`** (`governance_trust_regulatory.png`) — GENUINELY STRONG: DPDP Act
  2023 (India), EU AI Act, ISO/IEC 42001, GDPR, NIST AI RMF each with an honest partial coverage % and
  real control citations (A9, A12a, C2, C3, C4, C5, C7, C16). This is exactly the "prove it" evidence
  an investor auditing a governance pitch wants to see, and it's real, not decorative.

- **`/governance/trust/reports`** (`governance_trust_reports.png`) — GENUINELY STRONG: built-in
  regulator packs precisely targeted at the Indian insurer persona (IRDAI, DPDP/MeitY, CERT-In, RBI),
  well-written descriptions. "Run"/"Export"/"New template" buttons unguarded (same systemic gap).

## Screenshots opened — bank tenant (org_bharat) comparison

- **`/governance/posture`** — confirmed distinct org (`23 data sources` vs insurer's `14`), correct
  session (`demo-bank@getoffgridai.co`). No leakage visible on this screen.
- **`/governance/access`** — confirmed distinct, correctly-scoped users (`@bharatunion.example`), no
  insurer names present. Clean.
- **`/governance/secrets/overview`** — **identical** `http://offgrid-s1.local:8200/`,
  `vault-cluster-9948369c`, version `2.1.0` as the insurer tenant. This is the same shared backing
  store surfaced identically on both public demo links — i.e. any visitor holding both sets of demo
  credentials can fingerprint that both "separate" customer tenants sit on the same named
  vault cluster. Reinforces the infra-leak finding above; not itself business-data leakage but adds to
  the "this doesn't look like a properly isolated per-tenant deployment" impression.
- **`/governance/evidence/security`** — **identical** live failure: "Could not reach the SIEM index:
  OpenSearch 401" on both tenants, confirming this is a current, global, live-broken integration
  affecting every public demo link right now, not a one-off blip caught mid-shoot.
- **`/governance/evidence/audit`** — **the cross-tenant data leak** (see top of file): byte-identical
  to the insurer's audit page, showing the insurer's `org_suraksha` rows on the bank's own session.

## Verdict for this section

Governance is simultaneously the strongest and the most dangerous section audited. The individual
screens the founder would most want to show off — Posture, Evidence/Audit, Evidence/Retention,
Evidence/Fairness, Trust & Security Center, Trust/Regulatory, Trust/Reports, Teams — are genuinely
well-built, honestly worded, and populated with real, coherent, India-BFSI-appropriate demo data; they
would make a skeptical CISO or DPO more confident this is real. But the section also contains a
**proven, live, API-confirmed cross-tenant data leak** on one of those exact "prove it" screens
(`/governance/evidence/audit`), a live broken integration surfacing a raw OSS name + HTTP error on the
Security evidence page, an OSS engine name and a raw UUID rendered on-screen elsewhere, an internal
hostname+port+cluster-id shown to any viewer, and a systemic, section-wide failure to wire the
already-built `ReadOnlyGuard` onto virtually every write control (seal/unseal a live secrets vault,
delete a named user, decide someone's access review, generate live database credentials, delete a
team) — meaning literally every destructive-looking button in Governance is armed for this read-only
audience. None of these are hard to fix and several already have a working precedent elsewhere in the
codebase (`ReadOnlyGuard`, org-scoping in provenance) — but as shipped, a stranger who clicks around
unguided for five minutes will find both the best and the worst evidence in the whole console.

## BLOCKERS (cheapest fix first; confirmed exposure listed first per instructions)

1. **[CONFIRMED EXPOSURE — report first regardless of cost] Cross-tenant audit leak** —
   `/governance/evidence/audit` + `GET /api/v1/admin/audit-search` return every tenant's rows to
   every other tenant's viewer (proven: bank session returned 1015 hits across `org_bharat`,
   `org_suraksha`, `default`, null). Root cause pinpointed to `buildQuery()` in `src/lib/siem.ts`
   never filtering on `org`, and `src/lib/audit-log-reader.ts` never passing `orgId` into
   `searchAudit()`. Fix precedent already exists in `src/app/api/v1/admin/provenance/route.ts`.
   Screenshots: `insurer/governance_evidence_audit.png` vs `bank/governance_evidence_audit.png`
   (identical).

2. **Systemic: wrap every governance write control in the existing `<ReadOnlyGuard>`** — one
   mechanical fix, applied at ~10+ call sites, cheaper than anything else on this list per site fixed:
   `SealControl` (seal vault), `DynamicDbPanel` (generate creds), `RotateKeyControl`,
   `ProvenanceLedger` (verify/verify all), `UsersList` (add/delete user), `AccessReviewPanel`
   (keep/change role/remove/submit), `SecretsManager` (add/remove/rotate/undelete/destroy secret),
   retention's Save-limit/Apply-retention-now controls, Teams' new/delete, Trust/Reports' run/export/
   new-template. Evidence: `insurer/governance_secrets_overview.png` (a live red "Seal vault" button
   labelled "Destructive — takes all secrets offline"), `insurer/governance_access.png` (live "Add
   user" + delete icons on named people), `insurer/governance_access_review.png` (live
   Keep/Change-role/Remove on named people), `insurer/governance_evidence_retention.png` (7+ unguarded
   controls on one screen incl. "Apply retention now").

3. **OSS engine name on-screen, twice** — `/governance/egress` renders "Engine: llm-guard" verbatim
   (`src/components/guardrails/CloudEgressPanel.tsx:165`, and `llm-guard` has no entry at all in the
   `publicLabel()` mapper); `/governance/evidence/security` renders "Could not reach the SIEM index:
   OpenSearch 401" and "OpenSearch alerting monitors... index-lifecycle (ISM) retention policy" —
   traced to hardcoded `` `OpenSearch ${res.status}` `` templates in `src/lib/siem.ts`,
   `src/lib/siem-view.ts`, `src/lib/opensearch-alerting.ts`, `src/lib/adapters/opensearch-admin.ts`.
   Screenshots: `insurer/governance_egress.png`, `insurer/governance_evidence_security.png` (also
   reproduced on bank tenant).

4. **Raw OSS version + raw UUID on-screen** — `/governance/policies/bundles` hardcodes
   `label="OPA version"` and shows a raw node UUID (`src/components/governance/PolicyAuditBundles.tsx:40-41`).
   Screenshot: `insurer/governance_policies_bundles.png`.

5. **Internal infrastructure disclosed to a viewer** — `/governance/secrets/overview` (and the
   `/api/v1/admin/secrets` response behind it) shows a raw internal hostname+port
   (`http://offgrid-s1.local:8200/`), a vault cluster id (`vault-cluster-9948369c`), engine version
   (`2.1.0`), and the unseal threshold (`1 of 1`) — all four are named in the brief as things a
   stranger should not see, and all four render on the visible page, identically on both tenants.
   Screenshots: `insurer/governance_secrets_overview.png`, `bank/governance_secrets_overview.png`.

6. **Empty audit trail on the screen built to prove enforcement** — `/governance/policies/decision-logs`
   shows Decisions/Allowed/Denied/Engines all `0` on the populated insurer tenant, and its empty-state
   copy names a raw internal API path. The underlying fact (enforcement is real) is proven elsewhere
   (`/governance/evidence/audit`), so this is a wiring gap, not a missing capability — cheap to
   either populate from the same audit stream or hide until it has data. Screenshot:
   `insurer/governance_policies_decision-logs.png`.

7. **Dead-end empty state on Evidence Export** — `/governance/evidence/export` says "No exporters
   yet" on an otherwise very active tenant. Seed one example exporter (even a disabled/sample one) so
   the audience sees the feature, not a blank page. Screenshot: `insurer/governance_evidence_export.png`.

## RISKS

- `/governance/policies`, `/governance/policies/bundles`, `/governance/policies/decision-logs` all
  show the identical H1 "Overview"/"Policy posture and actions." regardless of which sub-page is
  open (`src/modules/contextual-navigation.ts:255` — a section-level description reused as if it were
  the leaf page's title). Confirmed NOT global — `/governance/secrets/*` varies correctly.
- Numeric inconsistency between `/governance/evidence` overview tiles ("22 signed answers", "205
  events") and the equivalent detail pages ("50 signed records", "200 Events").
- `/governance/egress` is missing from the nav/breadcrumb config (`contextual-navigation.ts` has no
  `egress` entry) even though the route is real and linked from Posture — the page renders with no
  section breadcrumb and a collapsed sidebar, looking structurally disconnected from Governance.
- `/governance/access/review` triggered a `Minified React error #418` (hydration mismatch) in the
  browser console during capture; not visually broken in the screenshot, but worth a follow-up check.
- `/governance/evidence/audit` and other audit rows render dense internal codes (`proof:ceiling`,
  `sink:lake pipeline:pl_seed_…`, `data:dom_e633d22e-348…`) with no plain-language gloss — technically
  correct but reads as a raw log dump to a business stranger, not a narrated audit trail.
- `/governance/secrets/leases` ships with placeholder copy ("empty = root") and an example path
  (`database/creds/app-ro`) that are pure Vault-operator jargon with no explanation, and shows nothing
  until the viewer manually clicks "List" — a dead-end-shaped empty state for this audience.
- `/governance/secrets/mounts` names raw Vault internals ("cubbyhole", "sys/ — system endpoints used
  for control, policy and debugging") with no gloss.
- Did not screenshot-verify (code-only): `/governance/policies/[destination]` detail,
  `/governance/guardrails/[destination]` detail, `/governance/access/[id]/[userId]` detail,
  `/governance/teams/[id]` detail. Routes exist and are wired per source inspection; recommend a
  follow-up shoot with a concrete id from each tenant.

## Appropriateness findings summary

- **Cross-tenant leakage: CONFIRMED** on `/governance/evidence/audit` (see BLOCKER #1) — the worst
  finding in the audit.
- **Secret values**: correctly never shown as plaintext in the console UI for existing secrets
  (`/governance/secrets/keys` shows only key names/folders; `redactSecretForViewer()` exists and is a
  sound pattern) — EXCEPT that `DynamicDbPanel`'s "Generate creds" would return a **freshly minted
  real username/password to the viewer** if it weren't blocked server-side (it is, 403 confirmed) —
  this is a near-miss, not a live leak, but is the same shape as the connectors-API incident named in
  the brief and should be guarded client-side too (BLOCKER #2).
- **Vault infrastructure**: confirmed exposed (BLOCKER #5) — hostname, port, cluster id, version,
  unseal threshold, shares, mount internals (cubbyhole/sys).
- **OSS engine names**: confirmed exposed twice on-screen (BLOCKER #3: llm-guard, OpenSearch) plus
  once as a raw version string (BLOCKER #4: OPA).
- **Seeded PII**: clean. All names/emails across both tenants use the reserved `.example` TLD
  (`@surakshalife.example`, `@bharatunion.example`) — correct convention, nothing reads as real PII.
  Fairness-evidence sensitive attributes (religion, caste, gender) are attribute *names* used to
  describe what's tested, never actual per-person values — appropriate.
- **Connectors-class leak (adjacent, Data module, flagged for cross-referral)**: `GET
  /api/v1/admin/connectors` on the insurer session returns `endpoint` strings like
  `postgres://coreins@127.0.0.1:5433/suraksha` and `mysql://policyadmin@127.0.0.1:3307/suraksha` — no
  password (today's named leak is fixed), but loopback host + specific internal port per service is
  still infra detail. Out of this section's direct scope (Data owns `/data/connectors`) but the same
  systemic class as BLOCKER #5, so flagged for the Data reviewer.

## What is genuinely strong here (be honest — point at these)

- `/governance/posture` — real, non-decorative stat tiles with an actual flagged risk (1 source
  without lawful basis, shown in red) and a full "inside governance" tile map.
- `/governance/evidence/audit` — 200 real events with genuine `blocked`/`redacted` outcomes, real
  model/token/cost columns, real filters. This is what "evidence, not decoration" looks like — modulo
  the cross-tenant bug in how it's scoped.
- `/governance/evidence/retention` — thoughtful, honest DPO-facing copy ("a limit is only a setting
  until a sweep runs... the record proves the deletion rather than asserting it").
- `/governance/evidence/fairness` — honest "UNTESTED rather than clear" framing under small sample
  sizes; explains the four-fifths rule in plain English.
- `/governance/trust` and `/governance/trust/regulatory` — an honest, partial (55%/63%/70%) posture
  against real framework citations (GDPR articles, ISO 42001 Annex A, NIST AI RMF functions), not a
  fabricated 100%. Best "is this real" evidence in the whole section.
- `/governance/trust/reports` — regulator packs correctly localized to the persona (IRDAI, DPDP/MeitY,
  CERT-In, RBI for the insurer).
- `/governance/teams` — realistic insurer business-unit modeling (Claims/Policyholder
  Service/Underwriting) with real domain language, not generic placeholder teams.
- `/governance/guardrails` — correct use of the jargon mapper ("Built-in pattern detection" rather
  than "Presidio"), proof the pattern works when applied.
- Seed data hygiene: `.example` TLD used consistently for all seeded people across both tenants.

## LATER

- `/governance/policies` and `/governance/guardrails` overview pages are thin (two small cards on an
  otherwise empty 1600px canvas) — not wrong, just under-filled; low priority next to the blockers above.
- `access-reviews` "Certify" flow bottom area (below the fold in the screenshot) not fully verified —
  recommend a full-page scroll capture on a future pass.
- `run/verify` on Provenance is a legitimate "prove it live" interaction for this exact audience
  (cryptographic re-verification) but is blocked for viewers because it writes an audit-log row as a
  side effect; not recommending loosening the write gate, but note the missed opportunity — a
  side-effect-free "preview" verify could be added later.

