# Audit — Solutions + Build (the app builder) — 2026-08-05

Team: non-technical department user (PRIMARY), full-stack engineer, AI engineer, principal UX/QA.
Scope: `src/app/(console)/solutions/**`, `src/app/(console)/build/**`, `src/lib/app-*`, `*builder*`,
`*solution*`, `*template*`, `*trigger*`, `src/components/build/**`, `src/app/api/v1/admin/apps/**`.
Bar: `docs/APP_AS_PRODUCT.md` — **done means a non-technical person in a department can use the surface
unaided.**

Status: IN PROGRESS — findings appended as confirmed.

## Coverage so far
- [x] Read `docs/APP_AS_PRODUCT.md`
- [x] Enumerated 88 pages under solutions/ + build/
- [ ] Screenshots
- [ ] Builder describe→refine flow
- [ ] App detail + lifecycle tabs
- [ ] Defect-shape hunt (`catch { return [] }`, `withTimeout(..., [])`, DEFAULT_ORG)
- [ ] Governance claims vs enforcement

## Findings

### F1 — BLOCKER — The trigger picker offers channels that cannot work, and the honest gate that would say so is called by NOTHING
Personas: non-technical department user (primary), AI engineer, QA.

`src/components/build/AppBuilder.tsx:121-136` hard-codes six equal-weight trigger choices, each with a
hint that ASSERTS it works:
- `email` → *"An incoming email starts a run (on-prem)"*
- `whatsapp` → *"An incoming WhatsApp message starts a run (on-prem gateway)"*
- `topic` → *"Each record on a feed starts a run"*
- `schedule` → *"Runs on a recurring cron"*

But `src/lib/triggers.ts:33` declares `COMING_SOON_TRIGGER_KINDS = ['email','whatsapp']`, and
`src/lib/trigger-dispatch.ts:218 triggerAvailability()` is a PURE, per-deployment gate that already
returns exactly the sentence the author needs (e.g. *"Stream triggers are disabled — set
OFFGRID_REDPANDA_BROKERS…"*, `imapConfigFromEnv().reason`).

**`triggerAvailability` is never called from any production code path.** Verified:
```
grep -rn "triggerAvailability" src test
  src/lib/triggers.ts        (a comment)
  src/lib/trigger-dispatch.ts (its own definition)
  test/trigger-dispatch.test.ts
```
Same for `validateTrigger` and `normalizeTrigger` (`src/lib/triggers.ts:61,109`) — **zero production
callers.** The builder does not import `@/lib/triggers` at all.

Consequences, each independently reproducible from the builder UI:
1. **Email / WhatsApp save clean and never fire.** `validateAppSpec`
   (`src/lib/app-model.ts:144,158`) checks only that `trigger.kind` is a member of the list; it never
   calls `validateTrigger`, so `comingSoon` is discarded. `POST /api/v1/admin/apps` takes
   `body.trigger ?? {kind:'on-demand'}` verbatim (`src/app/api/v1/admin/apps/route.ts:47`) with no
   normalization. A claims officer picks "Email", saves, publishes, and waits forever with no signal.
2. **Schedule saves with NO cron.** `setTrigger(s,'schedule')`
   (`src/lib/app-builder.ts:346-353`) writes `{kind:'schedule'}` with no config, and the builder
   renders a config panel for `topic` ONLY (`AppBuilder.tsx:717-725`). `normalizeTrigger` would have
   thrown `'schedule trigger: valid config.cron required'` — but it is not called. The app persists in a
   state that can never run.
3. **DRY defect / two sources of truth.** Trigger validity is implemented twice —
   `app-model.ts:144` (kind-membership only, the one that actually runs) and `triggers.ts:61`
   (the real per-kind rules, dead). The dead one is the correct one.

This is the worst possible place for it: the promise is made to a non-technical author at the moment
they choose how work reaches their app.

### F2 — BLOCKER — The builder tells a department author "governance is applied automatically", then offers them "No pipeline (unbound)" two cards below
Personas: non-technical department user, principal UX, AI engineer.

`src/components/build/InheritanceBanner.tsx:63-66` (the FIRST thing on the builder, every phase):
> *"Every step runs through your org's governed pipeline — policy, guardrails, routing, and
> provenance are applied automatically. You don't wire any of it."*

`AppBuilder.tsx:794-799` (`BuilderPipelinePicker`) then offers, as a selectable row:
> **"No pipeline (unbound)"** — *"Runs without a governing pipeline."*

Three problems in one screen:
- **Self-contradiction.** One says governance is unconditional; the other says you can opt out of it.
  A non-technical reader cannot resolve this and has no basis for the choice.
- **It violates the governing entity-consumption invariant** (app → pipeline → gateway → model, no
  skips). `setPipeline(spec, null)` (`app-builder.ts:368`) is a supported, reachable state and
  `pipelineId` is optional in the model (`app-model.ts:124`).
- **The banner's own chip contradicts its paragraph.** The chip renders
  `guardrails.on ? 'guardrails on' : 'guardrails off'` (`InheritanceBanner.tsx:39`, computed at
  `org-context.ts:196` as "at least one active rule"). An org with none gets **"guardrails off"**
  sitting inches from *"guardrails … are applied automatically."*

Compounding: a sibling audit today PROVED there is **no egress enforcement** — the on-prem/cloud class
feeds badges only. So "routing … applied automatically" and the picker's *"its model gateway, data
ceiling, policy and guardrails"* (`AppBuilder.tsx:788-790`) are claims about governance the platform
does not enforce, shown to the reader least able to check them.

### F3 — MAJOR — The one trigger that IS configurable asks a tax officer for a Kafka topic name, in free text
Personas: non-technical department user, principal UX.

`AppBuilder.tsx:1135-1164` `TopicTriggerFields` renders a single free-text `<Input>` labelled
**"Which feed?"**, monospaced, placeholder `claims.submitted`. There is no picker, no list of feeds
that exist, and no validation feedback in the builder.

This is the same defect class as GAP 0 in `docs/APP_AS_PRODUCT.md` ("why is this free text? all of the
data is already in the organization right?"), reintroduced on the trigger. A department author cannot
know a broker topic name; if they type one that does not exist, nothing arrives and — per
`triggerAvailability`'s own reasoning quoted in `trigger-dispatch.ts:227-230` — *"the failure would
look like an app that simply never runs."* The code comments there anticipate exactly this and the UI
does not act on it.

