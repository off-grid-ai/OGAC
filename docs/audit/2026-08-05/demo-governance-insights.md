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

