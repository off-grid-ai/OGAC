# Governance + Insights/Quality — CONFERENCE DEMO audit

Lens: a stage demo at a conference. No live customers. Severity = DEMO-BLOCKER / DEMO-RISK / POST-DEMO.
Scope: `src/app/(console)/governance/**` (36 pages), `src/app/(console)/insights/**` +
`src/app/(console)/solutions/quality/**` (40 pages).
Method: re-scored the two correctness audits (`governance.md`, `insights.md`) through the demo lens,
then shot 15 routes on the shared dev server (`127.0.0.1:3005`, an SSH tunnel to the box — so the data
is the box's real data) and judged every PNG as a projected 16:9 image. Screenshots in
`/tmp/audit/demo-gov/`, harness output `/tmp/audit/demo-gov/report.json`.
Status: **complete.** 12 findings.

## Evidence caveat — READ BEFORE ACTING ON G1

The `:3005` dev server I shot against was **sharing its `.next` directory with the production
`next start` on the same box**, and it emptied `.next/BUILD_ID` while running. Two consequences for this
report:

1. **A screenshot may be showing older compiled code than what is on disk.** A sibling team proved this
   independently (a currency fix present byte-identical in the source still rendered the old symbol on
   screen). So wherever a screenshot and the code disagree, **the screenshot may be stale** — I have
   marked below which findings are corroborated by reading the code and which rest on the image alone.
2. **All latency evidence in G1 is suspect and must be re-measured.** A `next dev` server that is
   simultaneously clobbering a production build directory is a sufficient explanation for 90 s
   network-idle timeouts and for `net::ERR_EMPTY_RESPONSE`. The *structural* half of G1 (five `layout.tsx`
   files with no sibling `loading.tsx`, so the interim state is a void rather than a skeleton) is a
   code-reading finding and stands regardless.

**Corroborated in code, safe to act on now:** G3 (`compliance.ts:68-73` — no orgId), G4
(`compliance.ts:100-104`, `:118` — literal `'satisfied'`), G6 (root-caused to the hex guard in
`provenance-view.ts:46-52`), G7 (`guardrails/[destination]/page.tsx:176-187` — `=== 'presidio'`), I1
(`insights/ai/overview/page.tsx:39` — `traces.error` never read), I3 (`adapters/evals.ts:319` —
`const passed = 0`), I4 (`drift/page.tsx:128-129`, `DriftCatalog.tsx:157,245`, `drift-run.ts:90`), I5
(`adapters/drift.ts:172-175` — row-offset windows), I6 (three `redirect()`-only stub files;
`insights/evals/[id]/page.tsx:51-52` — raw `run.score`), and the *structural* half of G1.

**Rests on the screenshot alone — re-check after the production rebuild:** G1's timings and the
white/blank renders; G2's tile values and the activity-row identities; G5's `Unavailable` flap.

**Not verified at all, and I am not guessing:** `/governance/evidence` (no PNG was produced),
`/governance/guardrails/overview` (only the skeleton was captured, so G7's "Built-in pattern detection /
4 entity types" is code-read but **never seen on screen**), and every `/solutions/quality/*` detail route
(`runs/[id]`, `evaluators/[id]`, `golden-cases/[id]`, `drift-monitoring/[id]`) — the server went away
before I could resolve a real id and shoot them. The step-3 run-detail beat in the Governance/Quality
demo scripts below is therefore **unshot**: open it once on the rebuilt console before rehearsing it.

---

## Verdict per section — blunt

**Governance is NOT demo-ready, and the reason is not the correctness bugs the other team found — it is
that half the section does not put its content on screen.** Six of the ten Governance routes I shot
never reached network-idle inside 90 s; `/governance/evidence` produced **no screenshot at all**;
`/governance/evidence/retention` returned an **empty response** and photographed pure white twice;
`/governance/policies` and `/governance/secrets` photograph as a header over a blank void; and
`/governance/access` photographs as an unresolved `Loading…`. On the same run, the same server, **all
five Insights/Quality routes loaded with zero problems** — so this is not machine load, it is those
routes. On top of that the section's opening screen leads with four negative tiles and the
regulator-facing pack carries a red **`PII masking (A9)`** GAP badge for a control that is demonstrably
enforcing. The one screen that is genuinely excellent is Evidence → Provenance.

**Insights/Quality is closer to demo-ready in shape and further away in substance.** The routes are
fast, the layouts are full-width and well-composed, and some of the copy is the best in the console
(the "Answer quality" and "Where quality alerts go" cards are outcome-language done right). But the two
screens he would actually show say the wrong thing about the product: `/insights/ai/overview` is a red
error banner over **five zero tiles, `$0.0000` and two empty charts**, and
`/solutions/quality/performance` announces that the product's own AI is **`degraded`, `32.5%`, `−28.3
pts`** with **six 0% rows** — all of it an artifact of recording "not measured" as zero. A quality
surface that says the AI is bad is worse than no quality surface.

**Which to take on stage:** Governance's *provenance + regulatory* story, with the two fixes in G1 and
G3. Quality's *drift-catalog + answer-quality* story, avoiding the performance screen until the zeros
are excluded. See `## Demo readiness`.

---

## GOVERNANCE

### G1 [DEMO-BLOCKER] Half the Governance rail does not show its content — blank voids, a white screen, an unresolved spinner
**Screens:** `governance_policies.dark.png` and `governance_secrets.png` (header + ~900 px of nothing),
`governance_access.dark.png` (unresolved `Loading…`), `governance_evidence_retention.png` + `.dark.png`
(**pure white, no sidebar**), `governance_guardrails.png` (skeleton), and `/governance/evidence` —
**no PNG was produced at all.**

**Measured, from `report.json` (one run, one server):** navigation never reached network-idle within
90 s on `/governance/regulatory`, `/governance/policies`, `/governance/guardrails`,
`/governance/evidence`, `/governance/access`, `/governance/secrets` — **six of ten**.
`/governance/evidence/retention` failed with **`net::ERR_EMPTY_RESPONSE`**. In the *same run*,
`/insights`, `/insights/ai/overview`, `/solutions/quality`, `/solutions/quality/performance` and
`/solutions/quality/drift` all recorded **zero problems**. Load is not the explanation.

**Root cause for the *blank* ones — structural and independent of latency:** `governance/policies/`,
`governance/secrets/`, `governance/access/`, `governance/evidence/` and `governance/trust/` each
introduce their own `layout.tsx` (which paints the destination header + sub-rail) and **none of them has
a sibling `loading.tsx`**. The only loading boundary in the subtree is
`src/app/(console)/governance/loading.tsx`, which sits *above* those layouts. So the header paints
instantly and the body is an empty hole until the server component resolves. `governance/guardrails/`
has **no** `layout.tsx` — which is precisely why it is the one route that photographs as a proper
skeleton instead of a void. The markup itself is fine: a direct fetch of
`/governance/secrets/overview` returned 200 with the correct "Secrets store … sealed" copy in it, and
`/governance/evidence/retention` returned 200 with its `destructive` **"kept forever"** badge in it.

**The worst instance is the one he is most likely to click.** `/governance/policies` is the second nav
item *and* the target of the **"Open policies"** button on the Governance landing page. It
`redirect()`s to `/governance/policies/overview`, whose body awaits `readPolicyStatus()`
(`src/lib/policy-view.ts:130-146`) → the OPA health `ping()`, a `fetch` with a 2500 ms timeout
(`src/lib/adapters/services.ts:19`). Redirect hop + no fallback + a service ping = a blank content area
on the first obvious click. And when it does land, the payload is two thin cards ("Policy engine ·
reachable", "Active policy set" = a 2-row table) — not a screen that earns the click.

**Honest caveat — now stronger than when I wrote it.** The wall-clock numbers come from a `next dev`
server that was concurrently overwriting the box's production `.next` (its `BUILD_ID` was emptied). That
is on its own a sufficient explanation for 90 s timeouts and an empty response, so **treat every timing
in this finding as not-verified** and **re-time these six routes against a clean
`npm run build && next start`** — the single highest-value pre-flight check in this report. What survives
regardless is the code-read structural half: the missing `loading.tsx` decides whether the interim state
is a skeleton or a white screen, at any latency.

**Cheapest fixes:** (1) add `loading.tsx` to those five directories; (2) repoint the "Open policies"
CTA and the Policies rail default at `/governance/policies/rules`, which has real content; (3) move the
OPA ping into a `<Suspense>` island so the Overview cards render without waiting on it; (4) pre-warm
every route on the demo path in the browser before he walks on.

### G2 [DEMO-BLOCKER] The Governance landing page opens with three warnings and a zero
**Screen:** `governance.dark.png`
**What the audience sees** on the flagship screen for *"Set controls once and inherit them
everywhere"*: `CLOUD EGRESS — **Allowed**` · `PEOPLE WITH ACCESS — 3` ·
`SOURCES WITHOUT A LAWFUL BASIS — **5**` (red border) · `ACCESS CERTIFIED — **Never**` (red border) ·
`TEAMS — **0**`. Two red-bordered alarm tiles, one hard zero, and the headline control reading
"Allowed" on a product sold as *private* AI. A CISO in row 10 reads those four words before anything
else and concludes the demo system is ungoverned. "5 of 5 data sources do not record why we are
permitted to process them" is spelled out underneath.
**Also on the screen:** Recent activity lists four identical `qwen3-vl-8b` rows attributed to
`chat:codex-dlp-c5e8e01e@getoffgridai.co` — an identity that reads as an autotest artifact, not a
customer.
**Cheapest fix — pure seed data and one toggle, zero code:** set cloud egress to **leashed** on the
demo org; record a lawful basis on the 5 data sources; create two teams (*Claims Operations*,
*Underwriting*); run one access certification so the tile shows a date instead of "Never"; and give the
activity rows human actors. That converts four negative tiles into four green ones on the first screen
of the section.

### G3 [DEMO-BLOCKER] `PII masking (A9) — GAP` in red on the regulator-facing pack, while masking is enforcing
**Screens:** `governance_regulatory.dark.png`, crop `_crop_reg2.png`
**Re-score of** governance.md BLOCKER 1 — **confirmed visually, and worse than the write-up implies,
because the red badge is on a projected screen.**
**What the audience sees:** `OVERALL POSTURE **63%**` beside a `Download` button for a *"regulator-ready"*
pack, then five framework cards (DPDP 70%, EU AI Act 63%, ISO/IEC 42001 60%, GDPR 63%, NIST AI RMF 63%)
each carrying a row of status pills. **Red pills: `PII masking (A9)`** on DPDP *and* GDPR;
`Input guardrails (C2)` on EU AI Act, ISO 42001 and NIST. Amber: `Access control / RBAC (C5)` on all
five, `Identity / SSO (C4)`, `Right-to-erasure (A12a)` on GDPR.
**Why it is fatal rather than merely honest:** he will demo PII masking working — 8 rules enforcing,
value-stable pseudonyms — and then open the compliance pack, which calls masking a **GAP**, because
`computeControls()` reads `listMaskingRules()` with **no orgId** and lands on `DEFAULT_ORG`, which has
**0** rules (`src/lib/compliance.ts:68-73`). The demo contradicts itself on the one surface whose entire
purpose is proof, and the same wrong content is inside the downloadable pack.
**Second visible contradiction, two cards apart:** `Right-to-erasure (A12a)` renders **green** on the
DPDP card and **amber** on the GDPR card. Identical control id, two different statuses, side by side.
That is the single fastest thing for a compliance buyer to spot from row 10.
**Cheapest fix:** thread `currentOrgId()` into `computeCompliance()`/`buildExport()` (four store reads)
and demo on the tenant whose 8 masking rules then turn A9 green. If that is too much before the
conference: **seed 8 masking rules + audit events into the `default` org** — the pack is computed for
`default` regardless of who is signed in, so seeding there makes the screen correct with no code change.

### G4 [DEMO-RISK] Two of those pills are hardcoded green, and the 63% is an average over them
**Re-score of** governance.md BLOCKER 2. Demoted from BLOCKER to DEMO-RISK **only** because nothing
visibly wrong appears until someone asks — but the ask is the obvious one.
**On screen:** `Egress / DLP (C16)` renders **green** on the DPDP card. It is a literal `'satisfied'`
(`src/lib/compliance.ts:100-104`) that never reads `getEgressPolicy(orgId)`, and its evidence string is
inverted so it prints "cloud egress allowed (leashed)". `erasure` is likewise a literal (`:118`) with
evidence "DSAR endpoint available" — endpoint existence, not one erasure record. `OVERALL POSTURE 63%`
and all five framework percentages are averages that include them.
**The stage risk is a question, not a click:** *"if I turn egress protection off, does that pill go
red?"* — no. And one route away, the Governance landing page says egress is **Allowed** while this page
shows Egress/DLP **green**. Two screens in the same section, contradicting each other, both reachable in
the same two minutes.

### G5 [DEMO-RISK] The same tile reads `3` on one route and red `Unavailable` on the next
**Screen:** `governance_posture.dark.png`
`PEOPLE WITH ACCESS` reads **3** on `/governance` and **`Unavailable · Users did not respond`** with a
**red border** on `/governance/posture` — a coin flip on the identity read that he cannot rehearse away.
Two adjacent routes visibly disagree, and the unreadable state is styled as an alarm.
**Credit:** this is the *correct* failure-vs-emptiness behaviour — it does not claim 0 users. Style it
muted-neutral rather than destructive-red and it stops looking like a fault.
**Also:** `/governance/posture` renders the **identical page** as `/governance` — same hero, same five
tiles. Two nav destinations, one screen. If he clicks Posture expecting depth, the audience watches him
go nowhere.

### G6 [DEMO-RISK] Provenance is the section's best screen — and its `Signature` column is empty on every row
**Screen:** `governance_evidence_provenance.png`
**Good news first, because it matters:** this is the strongest governance screen in the product.
`SIGNED RECORDS 29 / VERIFIED 29 / UNVERIFIED 0`, a `Signing key` card with `Rotate signing key`, a
`Verify all (29)` button, the sentence *"29 of 29 records can be re-verified on demand against the
active signing key"*, and a ledger where every row carries a green `verified` badge and its own `Verify`
action. **Demo this.**
**Re-score of** governance.md BLOCKER 4 ("a failed read renders as 0 signed records"): live it reads
**29/29/0**, so the three-zeros screen is *not* what he will show — this drops to DEMO-RISK, firing only
if the read fails on stage, in which case the tamper-evidence page would claim nothing is signed.
governance.md BLOCKER 3 (cross-tenant provenance) has **no visible symptom** on the demo org.
**What IS visibly wrong, on the money screen:** the **`Signature` column shows `–` on all 29 rows.** A
table built to prove signatures has an empty Signature column. Beside it, `Signer` is a truncated PEM
(`Ed25519 · -----BEGIN PUBLI…`) repeated 29 times, `Subject` is raw ids
(`agent_system_ai_quality_judge · run_3c5a7892`), and the `ACTIVE PUBLIC KEY` card prints a raw PEM
blob. From row 10 it reads as three columns of identical grey noise and one empty column.
**Root-caused in code (so this is not a stale-build artifact):** the cell renders `r.sha256Short`
(`ProvenanceLedger.tsx:178`), which comes from `shortSha()` in `src/lib/provenance-view.ts:46-52`:
```
if (!/^[0-9a-fA-F]+$/.test(hex)) return '—';
```
and it is fed `p.signature.replace(/^sig_/, '')` (`:125`). **Ed25519 signatures are base64** — they
contain non-hex characters — so the hex guard rejects every real signature and returns `'—'` for all 29
rows. The column can never display a value as written.
**Cheapest fix (three lines):** hex-encode, or accept base64url in `shortSha`, and print the first 12
chars. Also collapse `Signer` to `Ed25519` and put the app/agent **display name** in `Subject` with the
id in a tooltip.

### G7 [DEMO-RISK] Guardrails Overview understates the detector that is actually running
**Re-score of** governance.md MAJOR. Kept as a risk because it is one click into the Guardrails module
and it *undersells* the product to exactly the person who cares.
Both branches at `governance/guardrails/[destination]/page.tsx:176-187` test
`view.engine === 'presidio'`. The live engine is `llm-guard`, so Overview prints
**"Detection: Built-in pattern detection"** and **"Supported entity types: 4"**. A CISO concludes the
platform detects four PII types with a regex. The "not configured" warning badge is also suppressed for
this engine, so a misconfigured detector shows no warning. Separately, the Test panel asserts *"Custom
recognizers, deny lists, and thresholds apply exactly as they do to a real request"* while
`llmGuardPii.scan` reads only `listGuardrailRules` — so if he sets a threshold on stage and re-runs the
test, nothing changes. **Do not set a threshold live.**

---

## INSIGHTS / QUALITY

### I1 [DEMO-BLOCKER — the worst screen in either section] `/insights/ai/overview`: a red error banner, five zeros, `$0.0000` and two empty charts
**Screen:** `insights_ai_overview.png`
**Top to bottom:** `TRACE RECORDS **0**` · `GOVERNED RUNS **100**` · `REGISTRY RECORDS **102**` ·
`ONLINE SCORING **configured**` → a full-width **red banner**: *"Tracing store unreachable: The
operation was aborted due to timeout — showing zeros."* → `TRACED COST (WINDOW) **$0.0000**` ·
`TRACED TOKENS **0**` · `TRACES **0**` · `SCORED METRICS **0**` → two chart cards, both empty:
*"No eval scores in this window."* / *"No cost data in this window."*
One screen: a red failure banner, five zeros, `$0.0000` and two blank charts. It is the **default
destination of Insights → AI behavior**, i.e. two clicks from the section landing. If it goes on the
projector, nothing he says afterwards about measurement lands.
**Credit:** the banner is honest — it says "unreachable … showing zeros" instead of faking a quiet
system. The problem is purely that the honest state is the one on screen.
**Re-score of** insights.md BLOCKER 4: **half-fixed.** The banner exists. The unfixed half is 200 px
above it — `TRACE RECORDS 0` carries **no** error state, because `insights/ai/overview/page.tsx:39`
renders `traces.traces.length` and never reads `traces.error`. The page states "0 traces" as a fact and
"we could not read traces" as an error, simultaneously.
**Also visible:** `GOVERNED RUNS 100` is `listAgentRuns(100).length` — a page-size cap shown as a total;
it will read exactly `100` forever. `REGISTRY RECORDS 102` is three lists each capped at 100.
`ONLINE SCORING configured` is a config flag sitting in a row of measurements.
**Cheapest wins:** (a) get the trace store answering — one fix turns five tiles and both charts from
zeros into content; (b) if it cannot be made reliable by the conference, **change the AI-behavior
module's default destination away from this route and keep it off the demo path**; (c) label the two
capped counts "recent 100", as `insights/page.tsx:25-26` already does correctly.

### I2 [DEMO-BLOCKER] The Insights landing page's evidence is internal test scaffolding
**Screen:** `insights.png`
The hero is strong — *"Prove business impact, quality, and ROI"* — and the tiles read `RECENT RUNS 50`,
`COMPLETED 29`, `ERRORED 0`. Then **Recent activity**, the biggest block on the page, lists:
`One sentence: what is answer-quality drift?` · `Answer the question` (×4) ·
**`CONTEXT FROM PRIOR STEPS: — [agent] No question was provided`** — each subtitled with a raw id
(`agent_system_ai_quality_judge · done`, `agent_30e80f87 · done`).
**Why it is fatal:** the section's front door promises to prove business impact, and the evidence on
display is four rows of "Answer the question", one row of leaked prompt scaffolding that literally reads
**"No question was provided"**, and internal agent ids. Not one claim number, policy id, PAN, INR figure
or Indian name — nothing that looks like an enterprise using the product. It reads as a developer's test
harness.
**Second visible problem:** `50` runs, `29` completed, `0` errored — 21 runs in neither bucket, and the
three tiles sit side by side inviting exactly that question. `RECENT RUNS 50` is also the
`listAgentRuns(50)` limit (`insights/page.tsx:17`) presented as a count.
**Third — an off-script click that leaves the section:** both stat tiles are links. `COMPLETED` →
`/insights/quality` → `/insights/quality/scorecards` → `/solutions/quality/performance` (**three**
redirect hops); `ERRORED` → `/insights/drift` → `/insights/quality/drift` → `/solutions/quality/drift`.
Either click moves the sidebar highlight from **Insights** to **Solutions** and the URL to a different
section — he loses his place in the rail mid-demo, and "Errored runs" landing on a *drift* page is a
non-sequitur.
**Cheapest win — the highest-value seed job in either section:** replace those six activity rows with
six insurer-shaped runs (*"Assess claim CLM-2024-8871 against policy terms"*, *"Summarise the
underwriting file for PAN ABCDE1234F"*, *"Reconcile premium receipt ₹42,300 to policy LI-778201"*) under
named apps instead of `agent_30e80f87`. Data, not code — and it fixes the section's first screen.

### I3 [DEMO-BLOCKER] The flagship quality screen tells the room the product's own AI is **degraded, 32.5%, and falling**
**Screen:** `solutions_quality.png` = `solutions_quality_performance.png`
(`/solutions/quality` redirects here, so this is what "Quality" means in the Solutions rail)
**What the audience sees:** `PERFORMANCE **degraded**` (red) · `LATEST SCORE **37%**` ·
`CURRENT MEAN **32.5%**` · `CHANGE **−28.3 pts**`. Then **Score history**: a healthy 90–100 band for the
first ~14 points, then a **sawtooth crashing to zero six times** across #16–#30. From row 10 that chart
says one thing — the AI fell off a cliff. Then **Recorded executions**, where **6 of the 13 visible rows
read `0%`**: `eval_c004b1 0% 0/10`, `eval_d6d646 0% 0/10`, `eval_e28680 0% 0/10`, `ed_run_2e1e03 0% 0/1`,
`ed_run_32486c 0% **0/0**`, `eval_1d5502 0% **0/0**`.
**None of it is true.** This is insights.md BLOCKERs 2 and 3 rendered: a run where the engine returned
nothing persists `score = 0` (`src/lib/adapters/evals.ts:319`, `const passed = 0`), and `eval_runs.score`
mixes 0–1 with 0–100 scales *and* mixes lower-better metrics (a `pii_leakage` score of 0 is a **perfect**
result) with higher-better ones. `buildQualityPerformance` averages them into `32.5%` and stamps
`degraded`. **This is the most expensive screen in the demo:** the pitch is "we measure whether your AI
is any good", and the product's answer about itself is *no*.
**Also on the same screen:** `0/0` printed twice as a result. The Engine column half-translates —
`quality checks` and `golden` are fine but **`faithfulness:heuristic`** and
**`faithfulness:quality checks`** render verbatim, and the second is a *mangled* label (the `:ragas`
suffix was mapped to "quality checks" and the raw metric prefix stayed), so it reads as a rendering bug.
The vendor name also leaks through the **id** column, which `publicLabel` cannot reach: the top row's
run id is **`ragas_mrua3ogg`**. `seedeval_5` reads as seed data. `ONLINE SCORING configured and enabled`
is a config flag among four measurements, with a link labelled *"Drift engine evidence"* pointing at
`/operations/services/evidently` — the vendor name is in the URL, visible in the status bar on hover.
The `Score history` card leaves ~300 px of dead space under a short plot.
**Cheapest wins, in order:** (1) exclude `degraded`/zero-metric runs from the mean, the trend and the
verdict and render them **"not measured"** — this alone flips the badge off `degraded`, lifts the mean,
and removes six zeros from both the chart and the table; (2) never average across metrics of differing
direction; (3) route `faithfulness:*` through `publicLabel`; (4) rename `golden` → "Reference answers".

### I4 [DEMO-BLOCKER] Engine and library names are the primary vocabulary of the drift screen
**Screen:** `solutions_quality_drift.png`
**Re-score of** insights.md MAJOR ("engine names are the primary vocabulary") — **promoted to
DEMO-BLOCKER**, because the vendor name is not in a tooltip, it is **the value of a headline stat tile.**
**Rendered verbatim on one screen:** `ENGINE` tile = **`evidently`**; the evidence card's description =
**`Evidently ran "data_drift".`**; the "Engine availability" card = *"**Evidently** is selected and
configured…"* / *"**Evidently** is not the verified active path. Checks run with the built-in eval-score
**PSI** and mean-degradation fallback…"* (`drift/page.tsx:128-129`); the search placeholder =
**"Search drift tests (e.g. PSI, K…"** (`DriftCatalog.tsx:157`); and every preset card carries a mono
badge of its raw class name — **`DataDriftPreset`**, **`DataSummaryPreset`**, **`DataQualityPreset`**
(`:245`). `src/lib/drift-run.ts:90` hardcodes `engineLabel: 'Evidently' | 'Off Grid PSI'` — the label
helper *is* the leak, and three competing label helpers exist.
**Plus raw statistics as the reader-facing vocabulary:** the table headed "Metric or feature" lists
`share_drifted` = `1` and `score (K-S p_value)` = `0.0004`, both badged red `drift`, with no unit, no
direction and no threshold band — while `src/lib/quality-plain.ts:19-33` already holds a written
plain-English sentence for every one of those ids and this page does not import it.
**And the demo data is visibly test data:** the Answer-quality table's first row is
**`agent:agent_scores_probe` *(no longer exists)*** — the word "probe" plus a tombstone annotation, on
screen. Below it, `Where quality alerts go` shows **`no destination — alerts are off`**.
**Credit, and it is real:** the *Answer quality* and *Where quality alerts go* cards are the best copy in
the console — *"This watches what your people actually read: every governed answer is scored, and each
app is compared against its own earlier runs, so a slide shows up here before your users start noticing
it."* And the preset cards' green **`Full test suite ready`** badge is exactly the right vocabulary —
sitting one line above `DataDriftPreset`. Someone did this translation properly and stopped half way.
**Cheapest wins, all copy-only:** replace the two Evidently sentences with *"Full statistical test
suite"* vs *"Built-in approximation — reduced confidence"*; change the `ENGINE` tile to that same
outcome language; change the placeholder to *"Search drift tests…"*; drop the `*Preset` mono badges;
route the three metric ids through `checkDescription()` + `passingRule()`; delete or rename the
`agent_scores_probe` row.

### I5 [DEMO-RISK, high] `Verdict: drift` is an artifact of which evaluator happened to run
**Screen:** `solutions_quality_drift.png` — `VERDICT **drift**` (red), `BASELINE WINDOW 15`,
`CURRENT WINDOW 15`.
**Re-score of** insights.md BLOCKER 1. Held at high DEMO-RISK rather than BLOCKER for one reason: a red
"drift detected" verdict is a plausible thing to show *on purpose* ("look — we caught it"), so it does
not by itself lose the room. It becomes fatal on the **first follow-up question, which is always "what
drifted?"** — and the honest answer is *"a different set of evaluators ran."* The drift signal is
`listEvalRuns(40).map(r => r.score)` split by **row offset, not time**
(`src/lib/adapters/drift.ts:172-175`), over the same broken score column as I3. Live, the baseline mean
was 90.3 on a `{ragas, golden, geval}` mix and the current 32.3 on a
`{ragas, golden, faithfulness:heuristic, faithfulness:ragas}` mix. Nothing about the model changed; 3 of
4 retained runs are persisted `status=drift` with `engineProven=true`, so the provenance badge certifies
which code computed a meaningless input.
**If asked "can I set my own test?"** — insights.md's catalog finding is the trap: the catalog offers
per-column, per-type tests (`Numerical` / `Categorical` / `Text`, per-column overrides, a drift-share
threshold) but what ships to the collector is a single unnamed series of aggregate eval scores. On
screen right now `share_drifted = 1` — i.e. "100% of columns drifted", over 2 synthetic metrics.
**Don't configure a custom drift test on stage.**

### I6 [DEMO-BLOCKER] `Insights → Quality` has no working nav: three tabs, all redirect stubs, all landing in another section
**Re-score of** insights.md MAJOR — **promoted**, because the visible symptom is a broken nav on a
surface he will click.
The Insights rail advertises a **Quality** module with three destinations — `Scorecards`, `Drift`,
`Thresholds` (`src/lib/insights-routes.ts:40-59`). **Every one is a `redirect()`-only file** pointing at
`/solutions/quality/{performance,drift,release-gates}`, and `/insights/quality` itself redirects to the
first — so the URL goes `/insights/quality` → `/insights/quality/scorecards` →
`/solutions/quality/performance`: three hops ending in a **different top-level section**, with the
sidebar highlight jumping from Insights to Solutions. The `insights-quality` shell can therefore never
render and `isInsightsQualityEntityDetailPath` guards a path that no longer resolves. On stage it looks
like the console losing track of where it is.
**Still live behind the 308:** `src/app/(console)/insights/evals/[id]/page.tsx` (137 lines) renders
`{run.score}%` **raw** at `:51` with `<Progress value={run.score}>` at `:52`, so a stored `0.087` prints
**"0.087%"** with an empty bar, while `/solutions/quality/performance` shows the same run as `9%` — two
pages, two numbers, one run. `/insights/finops` and `/insights/copilot` are likewise unreachable and
unreferenced.
**Cheapest fix:** retire the `insights-quality` module from the nav (one edit —
`src/modules/contextual-navigation.ts:529-535`) so Quality lives only under Solutions, or repoint
`INSIGHTS_QUALITY_DESTINATIONS` straight at the `/solutions/quality/*` routes so it is one hop.
**Do not type or click any `/insights/quality/*` or `/insights/evals/*` URL on stage.**

---

## Demo readiness

### The story — Governance (2 minutes)
**"Provable governance, on your own hardware."** Route order, and nothing else:

1. **`/governance`** — the five-tile posture board. *Only after the G2 seed fix*, so it opens on
   "leashed / certified / 2 teams" rather than "Allowed / Never / 0". Line: *"every control is set once
   here and inherited by every app, model call and data flow."*
2. **`/governance/regulatory`** — five frameworks with live coverage and a **Download** button for the
   regulator pack. *Only after the G3 fix*, so `PII masking (A9)` is green. Line: *"this is generated
   from the live control plane, not maintained in a spreadsheet."* Click **Download** — a real artifact
   coming out of the console is the strongest single beat in the section.
3. **`/governance/evidence/provenance`** — **the payoff.** `29 signed / 29 verified / 0 unverified`,
   then press **`Verify all (29)`** live. Line: *"every answer the system produced is signed, and you can
   re-verify all of it against the active key, right now, in front of me."* This is the most convincing
   screen in either section — end here.

Optional fourth beat if the room is technical: **`/governance/guardrails/masking-rules`** to show the
8 rules enforcing — which is also what makes step 2 honest.

### The story — Quality (2 minutes)
**"We measure whether the AI is any good, continuously."** Deliberately *not* the performance screen:

1. **`/solutions/quality/golden-cases`** — the reference answers a department owns. Line: *"quality
   starts with what your own experts say a good answer is."*
2. **`/solutions/quality/drift`**, scrolled to the **Answer quality** card and **Where quality alerts
   go** — the two best-written cards in the console. Line, straight off the screen: *"every governed
   answer is scored, each app is compared against its own earlier runs, and a slide shows up here before
   your users start noticing it."* *Only after the I4 copy fix*, so the top-left tile does not read
   `evidently`.
3. **`/solutions/quality/runs/<a good run id>`** — a single execution's detail: which checks ran, what
   they scored, and the retained attribution proving *how* it was produced. **Pick the run id in advance
   and check it is not a `0%` one.** Line: *"and every one of those scores is an immutable record you can
   open."*

### What to avoid on stage
- **`/insights/ai/overview`** — red banner, five zeros, `$0.0000`, two empty charts (I1). Highest-cost
  single screen in the console. Also means: **do not click "AI behavior" in the Insights rail**, it is
  that route's parent.
- **`/solutions/quality/performance`** (= `/solutions/quality`, = the "Quality" rail item under
  Solutions) — `degraded`, `32.5%`, `−28.3 pts`, a chart crashing to zero, six `0%` rows (I3). This is
  the **default** destination of Solutions → Quality, so navigate straight to `drift` or `golden-cases`
  instead of clicking the group header.
- **`/governance/policies`** and the **"Open policies"** button on the Governance landing page — blank
  void (G1).
- **`/governance/evidence/retention`**, **`/governance/evidence`**, **`/governance/secrets`**,
  **`/governance/access`** — white screen / no content / unresolved spinner (G1). Reach Provenance by
  typing the full URL or from a bookmark, not by clicking **Evidence** and drilling.
- **`/insights` stat tiles** — clicking `COMPLETED` or `ERRORED` teleports him into Solutions after three
  redirects (I2, I6). And do not scroll the Insights landing page to Recent activity —
  "No question was provided" is down there.
- **Any `/insights/quality/*` or `/insights/evals/*` URL** (I6).
- **Setting a guardrail threshold live** and re-running the Test panel — the setting does not reach the
  engine, so nothing changes (G7).
- **Configuring a custom drift test** from the catalog — the selection is ignored by the data path (I5).
- **`/governance/posture`** — it is the same page as `/governance`; clicking it looks like a dead click.
- **Demo from a production build, not `next dev`.** Several screenshots carry the red **`1 Issue ✕`**
  dev-overlay badge in the bottom-left corner; on a projector that reads as an error in the product.

### Cheapest wins, ranked
1. **Seed the demo org (data only, no code).** 8 masking rules + audit events into `default` so
   `PII masking (A9)` goes green (G3); egress → **leashed**; a lawful basis on the 5 data sources; two
   teams; one access certification (G2); and six insurer-shaped run rows to replace
   `Answer the question` / `No question was provided` / `agent_scores_probe` (I2, I4). This one pass
   fixes the *first screen* of both sections plus the compliance pack.
2. **Exclude unmeasured runs from the quality mean, trend and verdict** — render them "not measured"
   instead of `0%` (I3). One rule change; it flips `degraded` off, lifts `32.5%`, and deletes six zeros
   from the chart *and* the table *and* the drift baseline.
3. **A copy pass on the two quality surfaces** (I4): `evidently` → "Full statistical test suite" /
   "Built-in approximation — reduced confidence" in the ENGINE tile, the evidence description and the
   availability card; drop the `*Preset` badges; fix the placeholder; route `faithfulness:*` through
   `publicLabel`; `golden` → "Reference answers"; the three metric ids through
   `checkDescription()` + `passingRule()`. All strings.
4. **Add `loading.tsx` to the five Governance sub-modules, and re-time those six routes on a production
   build** (G1). Turns four white/blank screens into skeletons, and tells him before the conference
   whether the latency is a dev-server artifact or real.
5. **Either fix the trace store or take `/insights/ai/overview` off the AI-behavior module's default
   destination** (I1), and print a signature fingerprint instead of `–` in the provenance ledger (G6) —
   the two smallest edits that most improve the two screens he most wants to show.

---

## Out of scope for the demo (one line each, no further effort)
- Deployment-global policy bundle / cross-tenant egress writes (governance.md BLOCKER 5) — no visible
  symptom on a single-tenant demo.
- Unscoped Keycloak user mutations / cross-tenant account takeover (governance.md BLOCKER 6) — a real
  security defect, invisible on screen.
- Cross-tenant provenance and compliance *audit-event* leakage (governance.md BLOCKERs 1, 3) — the wrong
  *masking* verdict is in G3 because it is visible; the leaked ids are not.
- Creating a user on a non-default tenant silently lands them in the default org (governance.md MAJOR).
- The guardrail tester puts typed PII in the URL query string (governance.md MAJOR).
- `/governance/egress`, `/governance/policies/decision-logs`, `/governance/policies/bundles` unreachable
  from nav (governance.md MAJOR) — invisible unless he types the URL, which he should not.
- "Performance degradation fires by construction under two days of traffic" and p95 blending cache hits
  (insights.md BLOCKER 6) — the banner did not fire on the demo data.
- One threshold compared against whichever quantity the last engine produced (insights.md MAJOR) — no
  breach rendered on the current data.
- Hydration-mismatch console errors on `/governance`, `/governance/regulatory`, `/governance/access`,
  `/solutions/quality/drift` (`report.json`) — console-only, no visible symptom.
- `OpenBao` / `Vault is sealed` / `OFFGRID_KEYCLOAK_*` env-var copy in the Secrets and Access empty
  states (governance.md MAJOR) — genuine rule-5 violations, but they live on the four surfaces he is
  already avoiding per G1.
