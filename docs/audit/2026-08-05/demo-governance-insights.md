# Governance + Insights/Quality — CONFERENCE DEMO audit

Lens: stage demo at a conference. No live customers. Severity = DEMO-BLOCKER / DEMO-RISK / POST-DEMO.
Scope: `src/app/(console)/governance/**` (36 pages), `src/app/(console)/insights/**` + `src/app/(console)/solutions/quality/**` (40 pages).
Method: re-scored the two correctness audits (`governance.md`, `insights.md`) through the demo lens, plus
screenshots of every headline route judged as a projected 16:9 image.
Status: **in progress** (appended as confirmed).

---

## GOVERNANCE

### G1 [DEMO-BLOCKER] `/governance/policies` — the second nav item and the landing page's own CTA — renders a BLANK page
**Screen:** `/tmp/audit/demo-gov/governance_policies.dark.png`
**What the audience sees:** He clicks **"Open policies"** (the second CTA button on the Governance
landing page) or **Policies** in the rail. The header renders — "Overview / Policy posture and
actions." — and then **an entirely empty white content area**, ~900px of nothing, with the sub-rail
(Overview / Rules / Templates / Modules / Decisions / History) sitting beside it. No skeleton, no
spinner, no empty state. It reads as an unbuilt page.
**Why:** `/governance/policies` `redirect()`s to `/governance/policies/overview`
(`src/app/(console)/governance/policies/page.tsx:19`), which renders `PolicyOverview()`
(`.../policies/[destination]/page.tsx:95`). That awaits `readPolicyStatus()`
(`src/lib/policy-view.ts:130-146`), which awaits the OPA health `ping()` — a `fetch` with a **2500 ms**
`AbortSignal.timeout` (`src/lib/adapters/services.ts:19`). The whole body is behind that await with no
`loading.tsx` / Suspense fallback, so a redirect hop plus a cold-compile plus an unreachable policy
engine = several seconds of blank content. Even once it lands, the payload is two thin cards
("Policy engine · reachable/unreachable", "Active policy set" = a 2-row table) — not a screen that
justifies the click.
**Demo cost:** the first obvious click off the Governance landing page. Neither prior audit caught
this because it is a render/latency defect, not a correctness one.
**Cheapest fix:** add a `loading.tsx` for the policies module, and make Overview render the rules
count + recent decisions it already has locally *without* waiting on the engine ping (ping in a
`<Suspense>` island). Or repoint the "Open policies" CTA and the rail default at
`/governance/policies/rules`, which has real content.

### G2 [DEMO-BLOCKER] The Governance landing page's five headline tiles are three warnings and a zero
**Screen:** `/tmp/audit/demo-gov/governance.dark.png`
**What the audience sees:** the flagship screen for "Set controls once and inherit them everywhere"
opens with: `CLOUD EGRESS — **Allowed**`, `PEOPLE WITH ACCESS — 3`,
`SOURCES WITHOUT A LAWFUL BASIS — **5**` (red border), `ACCESS CERTIFIED — **Never**` (red border),
`TEAMS — **0**`. Two red-bordered tiles, one hard zero, and the headline control reading "Allowed" on
a product positioned as *private* AI. A CISO in row 10 reads those four words before anything else and
concludes the demo system is ungoverned.
**Notes:** `Allowed` is factually the state of the shared deployment-global policy row
(`src/lib/store.ts:425-438`) and the copy underneath even says "when leashed, cloud routes are blocked
everywhere" — so the tile is technically honest and rhetorically fatal. `TEAMS 0` is a real empty
table (teams RBAC is built and demoed elsewhere). `SOURCES WITHOUT A LAWFUL BASIS 5 / of 5` means
**every** data source lacks a lawful basis.
**Cheapest fix (seed data + one toggle, no code):** set cloud egress to **leashed** on the demo org,
record a lawful basis on the 5 data sources, create 2 teams (e.g. *Claims Operations*, *Underwriting*),
and run one access certification so the tile reads a date instead of "Never". That converts 4 negative
tiles into 4 green ones on the section's opening screen.

### G3 [DEMO-BLOCKER] `PII masking (A9) — GAP` (red) on the compliance pack, while masking is enforcing
**Screens:** `/tmp/audit/demo-gov/governance_regulatory.dark.png`, crop `_crop_reg2.png`
**Re-score of:** governance.md BLOCKER 1 (default-tenant compute) — **confirmed visually, and worse
than the report implies because the red badge is on screen at 16:9.**
**What the audience sees:** `OVERALL POSTURE **63%**`, and five framework cards each carrying a row of
status pills. Red pills: **`PII masking (A9)`** on *DPDP Act 2023 (India)* and on *GDPR*;
**`Input guardrails (C2)`** on *EU AI Act*, *ISO/IEC 42001* and *NIST AI RMF*. Amber:
`Access control / RBAC (C5)` on all five, `Identity / SSO (C4)`, and `Right-to-erasure (A12a)` on GDPR.
Framework scores 70% / 63% / 60% / 63% / 63%.
**Why it is fatal, not merely honest:** he will demo PII masking working (8 rules enforcing on the
insurer tenant, value-stable pseudonyms) and then open the regulator pack, which says masking is a
**GAP** — because `computeControls()` reads `listMaskingRules()` with no orgId and lands on
`DEFAULT_ORG`, which has **0** rules (`src/lib/compliance.ts:68-73`). The demo contradicts itself on
stage, on the one surface whose purpose is proof. Same for the downloadable "regulator-ready" pack.
**Also visible:** `Right-to-erasure (A12a)` renders **green** on the DPDP card and **amber** on the
GDPR card — the identical control id, two different statuses, two cards apart on the same screen.
That is the single fastest thing for a compliance buyer to spot.
**Cheapest fix:** thread `currentOrgId()` into `computeCompliance()`/`buildExport()` (4 store reads),
and demo on a tenant whose 8 masking rules then turn A9 green. If that is too much before the
conference, demo on the **default** org and seed 8 masking rules + audit events there so the pack is
green — the numbers are computed for `default` regardless.

### G4 [DEMO-BLOCKER] Two of the pills are hardcoded green, and the 63% is built on them
**Re-score of:** governance.md BLOCKER 2. **Stays a blocker for the demo**, because the number on
screen is a percentage the audience is asked to trust.
**What the audience sees:** `Egress / DLP (C16)` renders **green** on the DPDP card. It is a literal
`'satisfied'` (`src/lib/compliance.ts:100-104`) that never reads `getEgressPolicy(orgId)` — and its
evidence string is inverted, so it prints "cloud egress allowed (leashed)". `erasure` is likewise a
literal (`:118`) with evidence "DSAR endpoint available". The `OVERALL POSTURE 63%` and every framework
percentage are averages over that set.
**The stage risk is a question, not a click:** "so if I turn egress protection off, does that pill go
red?" — the honest answer is no. And the Governance landing page one route away says egress is
**Allowed**, directly beside a green Egress/DLP pill. Two screens in the same section contradict.

### G5 [DEMO-RISK] `/governance/posture` shows `PEOPLE WITH ACCESS — Unavailable · Users did not respond` (red)
**Screen:** `/tmp/audit/demo-gov/governance_posture.dark.png`
**What the audience sees:** the same tile that read **3** on `/governance` one click earlier reads
**Unavailable** with a red border on `/governance/posture`. Non-deterministic — the identity read
(Keycloak) timed out on this shot and not the previous one. To the audience it is a red failure tile on
a governance screen, and the two adjacent routes visibly disagree.
**Credit where due:** this is the *correct* failure-vs-emptiness behaviour (it does not claim 0 users).
It is only a demo risk because it is a coin flip he cannot rehearse away, and because it is styled as
an alarm rather than a soft "checking…".
**Cheapest fix:** warm the identity read (or raise its timeout) and style the unreadable state as
neutral-muted rather than destructive-red.
**Also note:** `/governance/posture` renders the *identical* page as `/governance` — same
"Set controls once and inherit them everywhere" hero, same five tiles. Two nav destinations, one
screen. If he clicks Posture expecting depth, the audience sees him go nowhere.

### G6 [DEMO-BLOCKER] `/governance/evidence/retention` renders a completely WHITE page — twice
**Screens:** `/tmp/audit/demo-gov/governance_evidence_retention.png` and `.dark.png` — **both are a
blank 1600×1000 white rectangle. No sidebar, no header, nothing.**
**Reproduced two ways:** two independent navigations both produced an empty document; and a direct
fetch of the route returned **200 in 34.0 s / 368 KB** on the shared dev server. The markup *is* in
that payload (it contains a `destructive` badge reading **"kept forever"** from
`src/components/governance/StoreRetentionPosture.tsx:117-148`), so the page is not broken — it is
**slow enough to blow a 30 s navigation timeout**, and there is no loading fallback below
`src/app/(console)/governance/loading.tsx`, so the interim state is a white screen rather than a
skeleton.
**What the audience sees:** he clicks **Evidence → Retention** and the projector goes white for half a
minute. Worst possible failure mode on stage — indistinguishable from a crash.
**Caveat, stated honestly:** this is `next dev` on a server shared with five other reviewers, so the
34 s is not a production number. **Re-time this route against `npm run build && next start` before the
conference.** The structural facts are production-relevant regardless: the route awaits several live
service reads serially with no Suspense island, and the only loading boundary in the whole Governance
subtree is at the section root.
**Same class, same evidence:** `/governance/guardrails`
(`/tmp/audit/demo-gov/governance_guardrails.png`) was still showing its **skeleton** — four grey stat
placeholders and eight grey table rows — after networkidle + 3.5 s. It at least has a skeleton;
Retention and Policies do not.
**Cheapest fix:** add `loading.tsx` to `governance/evidence/`, `governance/policies/` and
`governance/guardrails/`, and pre-warm those three routes in the browser before he goes on stage.

### G7 [DEMO-RISK] Provenance is the section's best screen — and its `Signature` column is empty on every row
**Screen:** `/tmp/audit/demo-gov/governance_evidence_provenance.png`
**Good news first, and it matters:** this is the strongest governance screen in the product.
`SIGNED RECORDS 29 / VERIFIED 29 / UNVERIFIED 0`, a `Signing key` card with `Rotate signing key`, a
`Verify all (29)` button, "29 of 29 records can be re-verified on demand against the active signing
key", and a ledger where every row carries a green `verified` badge and a per-row `Verify` action.
**Re-score of** governance.md BLOCKER 4 ("a failed read renders as 0 signed records"): live it reads
**29/29/0**, so the three-zeros screen is **not** what he will show — this drops to DEMO-RISK (it only
fires if the DB read fails during the demo, in which case the tamper-evidence page claims nothing is
signed). Likewise governance.md BLOCKER 3 (cross-tenant provenance) has **no visible symptom on the
default demo org** — the run ids just look like run ids to an audience.
**What IS visibly wrong, and it is on the money screen:** the **`Signature` column shows `–` on every
single row.** A table whose purpose is to prove signatures has an empty Signature column. Beside it,
`Signer` is a truncated PEM (`Ed25519 · -----BEGIN PUBLI…`) repeated 29 times, `Subject` is raw
internal ids (`agent_system_ai_quality_judge · run_3c5a7892`, `agent_30e80f87 · run_9c99cd82`), and the
`ACTIVE PUBLIC KEY` card prints a raw PEM blob. From row 10 the table reads as three columns of
identical grey noise and one empty column.
**Cheapest fix (copy only, no logic):** render a short signature fingerprint (first 12 chars) instead
of `–`; collapse `Signer` to `Ed25519` and drop the truncated PEM; and put the app/agent's *display
name* in `Subject` with the id as a tooltip. Same screen, and it then reads as evidence rather than
a dump.

### G8 [DEMO-BLOCKER] `/governance/access` — an unresolved `Loading…` spinner over an empty page
**Screen:** `/tmp/audit/demo-gov/governance_access.dark.png`
**What the audience sees:** `Users / People with console access.`, a `Search users…` box, an
`+ Add user` button — and a spinner reading **"Loading…"** that had still not resolved after
networkidle + 3.5 s. Below it, ~600 px of empty page: the content occupies the top 400 px of a
1600 px-wide screen and the rest is blank. Even when the list does arrive it is 3 users
(per the `PEOPLE WITH ACCESS 3` tile) in a card that consumes a quarter of the viewport.
**Why:** the user list is a client fetch against the identity service, and this is the same read that
produced the red `Unavailable` tile in G5 — it is the slowest/flakiest read in Governance.
**Demo cost:** "Access" is the first place a security buyer asks to see, and the honest answer today
is a spinner. Combined with G1 (blank Policies) and G6 (white Retention), **three of the eight
Governance rail items do not have their content on screen when a person looks at them.**
**Cheapest fix:** server-render the list from the console `users` table (which is fast and already
org-scoped) and reconcile with the identity service in the background; fill the empty right-hand two
thirds with the roles/sessions summary that already exists one tab over.

