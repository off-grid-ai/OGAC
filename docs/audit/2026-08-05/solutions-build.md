# Audit — Solutions + Build (the app builder) — 2026-08-05
## LENS: CONFERENCE DEMO READINESS (re-framed mid-audit per `demo-lens.md`)

Severity scale: **DEMO-BLOCKER** (breaks / embarrasses / lies on stage) · **DEMO-RISK** (survives the
rehearsed path, fails one click off-script) · **POST-DEMO** (real, but invisible on stage — one line only).

Why this section matters most: *"a non-technical person in a department builds a governed AI workflow in
plain language"* is the headline claim of the whole product, and this section is where it is proved.
He will almost certainly build one live.

Scope: `src/app/(console)/solutions/**` (48 pages), `src/app/(console)/build/**` (40 pages),
`src/lib/app-*`, `*builder*`, `*solution*`, `*template*`, `*trigger*`, `src/components/build/**`,
`src/app/api/v1/admin/apps/**`.

**Critical environment fact, verified — do not re-derive:** `127.0.0.1:3005` is an SSH forward to the
BOX (`ssh -f -N -L 3005:127.0.0.1:3005 offgrid-tunnel`, pid 46157). The console runs from
`/Users/admin/offgrid/console` on the box against the BOX Postgres. **The local dev Postgres is test
residue and is NOT what the demo shows** — an early draft of F4 below was wrong because it read the
local DB. Query the box (`node -e` + `pg`, read-only) for anything data-shaped.

## Coverage so far
- [x] `docs/APP_AS_PRODUCT.md` read
- [x] 88 pages under solutions/ + build/ enumerated; `/build/**` confirmed 308→`/solutions/**` + `/runtime/pipelines` (`src/modules/route-migrations.mjs:61-71`) — the dual file tree is NOT a dual-URL problem
- [x] Screenshots: `/solutions/apps`, `/solutions/apps/new`, `/build` (404), `/solutions/agents`, `/runtime/pipelines` → `/tmp/audit/build/`
- [x] Live box DB: every app, trigger kind, publish state, waiting-case count per app
- [x] Trigger substrate (`triggers.ts`, `trigger-dispatch.ts`, `app-builder.ts`, `app-model.ts`) traced end to end
- [x] Live describe→refine build drive (`scratchpad/drive-build.mjs` → `/tmp/audit/build-flow/`)
- [x] App detail + lifecycle tabs, real box app id `app_e8b19b50` → `/tmp/audit/build3/`
- [ ] Blueprints/Templates/Deployed detail pages judged as projected images (shots pending)

---

## DEMO-BLOCKERS

### B1 — The trigger card offers "Email" and "WhatsApp" as ordinary equal choices, and they are not wired
Screen: the builder's refine phase, right-hand column, card **"How is it triggered?"**.
File: `src/components/build/AppBuilder.tsx:121-136`.

Six choices render as identical selectable rows, each with a hint that ASSERTS it works:

| row | hint shown on stage | reality |
| --- | --- | --- |
| On demand | "A person runs it from a form" | works |
| Webhook | "An inbound HTTP call starts a run" | works — but "Webhook" and "inbound HTTP call" is engine-speak (see B4) |
| Schedule | "Runs on a recurring cron" | **"cron"** on screen; and no cron field exists in the builder (B2) |
| Live data feed | "Each record on a feed starts a run" | works on this box; asks for a raw topic name (B3) |
| **Email** | "An incoming email starts a run (on-prem)" | **NOT WIRED** |
| **WhatsApp** | "An incoming WhatsApp message starts a run (on-prem gateway)" | **NOT WIRED** |

`src/lib/triggers.ts:33` — `COMING_SOON_TRIGGER_KINDS = ['email','whatsapp']`.
`src/lib/trigger-dispatch.ts:218 triggerAvailability()` is a pure per-deployment gate that already
returns the exact honest sentence for each. **It is called by nothing in production** — verified:

```
grep -rn "triggerAvailability" src test
  src/lib/triggers.ts          (a comment)
  src/lib/trigger-dispatch.ts  (its own definition)
  test/trigger-dispatch.test.ts
```
Same for `validateTrigger` / `normalizeTrigger` (`triggers.ts:61,109`) — zero production callers. The
builder never imports `@/lib/triggers`.

**Why it costs the room:** "work arrives from the channels your business already uses — email, WhatsApp"
is the most compelling thing on this card, and it is the one thing that cannot be demonstrated. If a
prospect says *"show me one triggered by email"* he has no answer, and there is no badge to explain why.
Worse: nothing stops him clicking Email on stage and saving — it saves clean (B2).

### B2 — Choosing "Schedule" on stage saves an app that can never run, silently
Screen: same card, then the Save bar.

`setTrigger(s, 'schedule')` (`src/lib/app-builder.ts:346-353`) writes `{kind:'schedule'}` with **no
config**, and the builder renders a configuration panel for the `topic` kind **only**
(`AppBuilder.tsx:717-725`). There is no cron field, no "every morning at 9" picker, nothing.

Nothing catches it downstream:
- `validateAppSpec` (`src/lib/app-model.ts:144,158`) checks only that `trigger.kind` is a member of a
  hard-coded list. It never calls `validateTrigger`, so `comingSoon` and the missing cron are both discarded.
- `POST /api/v1/admin/apps:47` takes `body.trigger ?? {kind:'on-demand'}` verbatim — no normalization.
- `normalizeTrigger` WOULD have thrown `'schedule trigger: valid config.cron required'`. Not called.

So: pick Schedule → **"Everything is wired. You're ready to save."** (`AppBuilder.tsx:446`) → Save →
green toast → the app exists and will never fire. On stage that is a lie the audience cannot see, and a
trap if he then tries to show it running. Same for Email and WhatsApp.

### B3 — The one trigger that IS configurable asks a business audience for a Kafka topic name
Screen: builder refine, "How is it triggered?" → **Live data feed** → the inline panel.
File: `src/components/build/AppBuilder.tsx:1135-1164` (`TopicTriggerFields`).

A single **free-text monospace `<input>`** labelled **"Which feed?"**, placeholder `claims.submitted`.
No picker, no list of feeds that exist, no validation.

This is `docs/APP_AS_PRODUCT.md` GAP 0 verbatim (*"why is this free text? all of the data is already in
the organization right?"*) reintroduced on the trigger, and it is the failure mode the code's own comment
predicts (`trigger-dispatch.ts:227-230`: *"the failure would look like an app that simply never runs"*).
On a projector, a monospace box asking for `claims.submitted` reads as a developer config file in the
middle of the "no code, plain language" story.

### B4 — Platform jargon on the two screens he will definitely project
`docs/APP_AS_PRODUCT.md` §5 item 7 ("Language pass — pipeline / guardrail / eval / provenance / policy
must not reach a department reader") is **open**, and the residue sits on the builder's own chrome.

**Screen: `/solutions/apps/new`** — screenshot `/tmp/audit/build/build_studio_new.png`.
`src/components/build/InheritanceBanner.tsx:12-41` renders the banner directly under the h1:
> `THIS APP INHERITS  ⟨8 connectors⟩ ⟨5 data domains⟩ ⟨0 tools⟩ ⟨0 KB docs⟩ ⟨guardrails on⟩ ⟨policy v10⟩`
> *"Every step runs through your org's governed pipeline — policy, guardrails, routing, and provenance
> are applied automatically. You don't wire any of it."*

Nine platform terms in a strip: *connectors, data domains, tools, KB docs, guardrails, policy v10,
pipeline, routing, provenance*. **Two of the six chips are `0`** — `0 tools`, `0 KB docs` — so the
"you're not starting from zero" banner literally shows zeros, at 11px grey, from row 10. The surface
directly below it (`build/studio/page.tsx:56-59`) carries a comment saying this exact mistake was already
fixed once on the Apps page (*"WAS SIX PLATFORM TERMS IN ONE SENTENCE"*); the builder was not swept.

**Screen: builder refine, "Runs on" card** — `AppBuilder.tsx:787-790`:
> *"The governed pipeline this app runs on — its model gateway, data ceiling, policy and guardrails."*

and its first selectable row (`:794-797`) is literally **"No pipeline (unbound)"** — *"Runs without a
governing pipeline."* A business audience is shown an opt-out of governance, in jargon, ten inches below
a banner promising governance is unconditional and automatic. A CISO in the room reads that
contradiction faster than anything else on the screen.

Also on the same banner: the chip is computed `guardrails.on ? 'guardrails on' : 'guardrails off'`
(`InheritanceBanner.tsx:39`, from `org-context.ts:196`). An org with no active rule projects
**"guardrails off"** two lines above *"guardrails … are applied automatically."*

### B5 — Five of the eleven live apps are published on the dead `email` trigger, and each one tells its reader work arrives automatically
This is B1 already realised in the demo data, on the two customer-facing tenants.

Live box DB (read-only):
```
bhapp_kyc     | org_bharat   | KYC & Re-KYC Verification    | published | {"kind":"email"}  |  5 waiting
bhapp_loan    | org_bharat   | Personal Loan Underwriting   | published | {"kind":"email"}  |  2 waiting
bhapp_reimb   | org_bharat   | Reimbursement Approval       | published | {"kind":"email"}  | 12 waiting
app_14940314  | org_suraksha | Death-Claim Assessment       | published | {"kind":"email"}  |  2 waiting
app_c38d2c5e  | org_suraksha | Policy Underwriting Assist   | published | {"kind":"email"}  |  2 waiting
```
Box env: **`OFFGRID_REDPANDA_BROKERS` is the only trigger env set.** No IMAP, no WhatsApp gateway ⇒
`triggerAvailability('email', env)` = `state:'coming-soon', enabled:false`.

And each of those five app front doors renders, as its arrival sentence
(`src/lib/app-work-queue.ts:81-82`):
```ts
case 'email':
  return 'New cases arrive by email, and are picked up automatically.';
```
**On stage:** open Reimbursement Approval on the bank tenant — the most natural app to open, it has the
most waiting cases — and the screen states as fact that cases arrive by email automatically. The very next
question from the audience is *"so if I email an invoice right now, it appears here?"* and the answer is no.

The guard exists and was applied to the wrong branch. Eleven lines down, same function
(`app-work-queue.ts:92`): *"An unrecognised trigger must not claim work arrives automatically when we
cannot confirm it."* `arrivalSentence` takes no availability argument at all, so the honest answer is not
reachable from its signature.

Cheapest demo fix: **flip those five apps' trigger to `on-demand`** (one UPDATE) so the screens read
*"Somebody starts each case here when it is needed"* — true, and it matches the "run it live" demo he
wants anyway. Do NOT leave them on `email`.

### B6 — "9 cases are waiting for a person" on the Apps screen, and only 5 exist to open
Screen: **`/solutions/apps`** — the section's front door and almost certainly his first slide.
Screenshot: `/tmp/audit/build/build_apps.png` (1600px, `dev@offgrid.local` → `default` org).

The stat band reads **WAITING FOR A PERSON = 9**. The four cards below badge **2 + 1 + 1 + 1 = 5**.
Both numbers come from the same `waiting` map, on the same screen, ~200px apart.

Live DB explains it exactly:
```
awaiting_human runs, org 'default':
  app_0c240abc 1 · app_16ad7e53 1 · app_e8b19b50 1 · app_bdd24eab 2   = 5   (apps that exist)
  app_4108cf57 2 · app_d9f008e3 2                                    = 4   (NOT in the apps table)
```
`build/studio/page.tsx:84-88` sums every `awaiting_human` run in the org; `AppsList` badges only apps
`listApps` returns. On a non-demo tenant `listAppRunsView` deliberately does not filter to visible apps
(`src/lib/app-runs-view-reader.ts:83-87` — gated on `isDemoTenantOrg`), so **4 cases orphaned by two
deleted apps inflate the headline number with no card to open.**

A visibly wrong figure, on the first screen, on the exact metric the story is about. Fix by deleting the
two orphaned apps' runs, or by scoping the sum to `apps` (one line).

Secondary, same code: the sum reads `listAppRunsView(undefined, orgId, 300)` — capped at 300 runs. An app
whose waiting cases fall outside that window badges **0**.

### B7 — Bare `/build` is a chromeless full-page 404 that dumps him out of the console
Screenshot: `/tmp/audit/build/build.png`.

Every child of `/build` is redirected (`route-migrations.mjs:61-71`) but **bare `/build` is not**, so it
renders the global not-found: a centred magnifier, **"Page not found"**, and *"That route doesn't exist,
or the module isn't enabled for this deployment."* — **no sidebar, no header, no breadcrumb.** The only
control is "Go to overview".

Two demo problems: (a) `/build` is the most guessable URL in the section (it prefixes every file path and
every pre-migration bookmark), and one mistyped or stale link on stage blanks the whole console; (b) the
copy conflates "doesn't exist" with "your deployment doesn't have this" — if he demos a restricted role,
a *permission* outcome is presented as a broken product.

---

## DEMO-RISKS

### R1 — The plain-language compile can silently fall back to keyword matching, with identical wording
`src/lib/app-compile.ts:186` — `await deps.modelDecompose(desc, domains).catch(() => null)`. On any model
failure `planFromModel` returns null and compile uses the heuristic path. Either way the author sees the
same toast, *"Carved a step skeleton — resolve anything flagged, then save."* (`AppBuilder.tsx:291`).

On stage this is the moment everything rests on. If the model call flakes, the steps he gets are the
keyword heuristic's — thinner, possibly missing the human-approval step that is the whole governance
story — and neither he nor the audience is told, so he cannot recover by retrying. **Rehearse the exact
description he will type, and have a saved app ready as a fallback.**

### R2 — Every list on the app surfaces renders an outage as "you have nothing"
The repo-dominant defect, concentrated here. Demo-relevant instances only (a swallowed read on stage
looks like an unbuilt product, which is worse than an error):

| file:line | swallowed | what the projector shows |
| --- | --- | --- |
| `build/studio/page.tsx:25` | `listApps(orgId).catch(() => [])` | **"Your apps"** with nothing under it — on the front door |
| `solutions/apps/[id]/page.tsx:166` | `listAppRuns(id, orgId, 50).catch(() => [])` | app front door: no queue, no dashboard, and the source-health banner that exists to warn about failed reads goes **silent**, because it is computed from the same swallowed `rows` |
| `build/studio/new/page.tsx:25-26` | `listManagedAgents`, `listPipelines` | builder shows **no pipelines to pick**, steering him to "No pipeline (unbound)" (B4) |
| `build/apps/[id]/quality/page.tsx:62,80,81,138` | four reads | the Quality tab reads "no evidence" — indistinguishable from "could not read it" |
| `solutions/apps/[id]/dashboard/page.tsx:27` | `listAppRuns(…,500)` | owner dashboard: "this app has done nothing" |

~20 more of the same shape across `solutions/agents/**`, `solutions/quality/**`, `solutions/tools/**`,
`build/pipelines/**`, `build/apps/[id]/layout.tsx:32-33`. (`req.json().catch(() => ({}))` excluded — a
malformed body is legitimately empty.)

### R3 — `[autotest]` app in a customer-facing tenant
`app_topicproof | org_suraksha | "[autotest] Claim event feed" | published`, holding **4 waiting cases**.
`listApps` hides `[autotest]` titles on demo tenants (`apps-store.ts:406-409`), so it should not appear in
the Apps grid — but it is published, it is the only `topic`-triggered app on the box, and its 4 waiting
cases are real. Any surface reading runs rather than apps can surface the literal string `[autotest]`, and
if he demos the stream trigger this is the app he would have to open. Rename it (e.g. "Claim event feed")
or unpublish it before the talk.

### R4 — The builder's back link says "Studio", a name the product no longer uses
`src/app/(console)/build/studio/new/page.tsx:49-56` renders `← Studio` → `/solutions/apps`. The sidebar
row, the destination `<h1>` and the breadcrumb there all say **"Apps"**. Confirmed on
`/tmp/audit/build/build_studio_new.png`: sidebar highlights "Apps", back link says "Studio". A retired
internal name (`/studio` is a 308, `route-migrations.mjs:18`) as the only way back off the build screen.

### R5 — "Create a custom blueprint" is a `<details>` toggle, invisible until clicked
`src/app/(console)/solutions/library/page.tsx:36-42`. The blueprint create form hides inside a collapsed
`<summary>`. Off-script, if a prospect asks "can I define my own?", the answer is a small `+` row that
looks like a disclosure triangle, not a call to action. Also not URL-addressable, so he cannot deep-link
to it from a slide. Same page's intro copy — *"Reusable BFSI contracts define the owner, requirements,
outcome hypothesis, and evidence"* — is jargon for a business room ("outcome hypothesis").

---

## Out of scope for the demo (POST-DEMO, one line each)
- `src/lib/app-run-store.ts:79` — `currentPolicyVersion(orgId).catch(() => 0)` writes "policy version 0" into the run's audit row on a failed read; invisible on any demo screen.
- DRY: trigger validity implemented twice (`app-model.ts:144` kind-membership, which runs, vs `triggers.ts:61` real per-kind rules, dead) — the correctness half of B1/B2, no separate visible symptom.
- `orgId: string = DEFAULT_ORG` default params across `app-run-store.ts`, `app-versions-store.ts`, `app-run-controls-store.ts`, `app-runs-view-reader.ts`, `webhook-triggers.ts` — every call site inspected passes an explicit org; no visibly wrong number found.
- `/build/pipelines/**` (11 pages) is source under a fully-redirected path, re-exported by `/runtime/pipelines/**` — confusing for engineers, invisible to a viewer.
- `/solutions/catalogue` correctly redirects to `/solutions/library` (`catalogue/page.tsx:1-9`) — the doc's claim it was collapsed is accurate; not a defect.
- Width discipline: **clean**. No `mx-auto max-w-{2,3,4}xl` page roots anywhere in the section; `PageFrame` is `w-full`. Do not "fix" this.
