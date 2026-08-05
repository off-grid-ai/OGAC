# Viewer-demo audit brief — READ THIS FIRST, IT REPLACES ANY OTHER LENS

## Who is looking, and how

The founder is sending **public links + shared read-only credentials** to **investors, angels and
other founders**. They will open it **alone, unguided, with nobody presenting**. There is no script,
no rehearsed path, and no one to say "ignore that bit".

Two consequences that change everything about how you audit:

1. **EVERY route is on the demo path.** Last pass we could triage by "would he show this screen?".
   That escape hatch is gone. A stranger clicks the nav, clicks the first row, clicks the obvious
   button. If it is reachable from the nav in three clicks, it is being seen.
2. **They are signed in as a READ-ONLY VIEWER.** They can read everything, including admin surfaces,
   and can write nothing. A write is rejected with 403. So:
   - **A write control that looks live and then fails is a top-severity defect.** Buttons, forms, and
     destructive actions must be visibly unavailable-and-explained to a viewer, not armed-then-403.
     `useViewerMode()` exists in `src/components/ViewerModeProvider.tsx` and currently has ZERO
     consumers — assume nothing is disabled until you see it disabled in a screenshot.
   - **A surface that only becomes interesting after you create something is empty forever** for
     this audience. "Click New to get started" is a dead end, not an empty state.

## The accounts and hosts — DO NOT AUDIT ANY OTHER TENANT

The org is resolved from the **HOST**. A loopback/localhost base has no tenant and silently falls
back to `default`, the scratch org — auditing that produced a whole worthless pass last time.

    node scripts/audit-shoot.mjs --demo=insurer --out=<your dir>/insurer --routes=...
    node scripts/audit-shoot.mjs --demo=bank    --out=<your dir>/bank    --routes=...

`--demo=insurer` → Suraksha Life (a life insurer) · `--demo=bank` → Bharat Union Bank. The harness
carries the credentials and prints the confirmed role + org; if it does not say the demo account and
the demo org, stop and fix that before judging anything. Audit your section on **both** tenants where
the section is tenant-shaped — a screen that is populated for the insurer and empty for the bank is a
finding, because both links are being sent out.

## THE ONLY QUESTION

> A stranger who could fund this opens this screen with no one explaining it.
> **Does it make them more confident that this is a real, working product, or less?**

## Severity

- **BLOCKER** — costs credibility on sight, unguided. An empty table or zeroed stat tile on a
  populated tenant. A 404, an error banner, a spinner that never resolves. A visibly wrong or
  nonsensical number. A button that 403s. A screen that looks unbuilt or unstyled. Jargon or an OSS
  engine name a business reader cannot parse. Placeholder/test data (`test`, `foo`, `[autotest]`,
  `probe`, lorem). Anything that fails on the first obvious click.
- **RISK** — survives the first look but fails the second click, or reads as thin/unfinished on
  inspection. Inconsistency between two panels. A detail view much weaker than the list that led to it.
- **LATER** — a real defect with no visible symptom to this audience. One line, at the bottom, move on.

## Also in scope, specifically for this audience — APPROPRIATENESS

You are auditing something being handed to strangers. Flag on sight:

- **Any other tenant's data** visible from this tenant. Cross-tenant leakage is the single worst
  finding available; if you can even suspect it, prove it.
- **Credentials, secret values, tokens, connection strings.** (One was live today: the connectors API
  returned `postgres://user:password@host` in plaintext. Assume there are more.)
- **Internal infrastructure on screen** — private IPs, hostnames, ports, container names, env var
  names, vault cluster ids, raw uuids where a name belongs.
- **OSS engine names** anywhere a business reader sees them: Ragas, LLM Guard, Evidently, OpenSearch,
  Langfuse, Presidio, Redis, Kafka/Redpanda, SeaweedFS, LiteLLM, OPA, Marquez, Qdrant, LanceDB,
  ClickHouse, Kestra, Temporal, vmalert, OpenBao/Vault. `publicLabel()` in `src/lib/lineage-labels.ts`
  is the mapper. An engine name in a tooltip is acceptable; on the face of the screen is not.
- **Seeded PII that reads as real** — a real-looking person's PAN/Aadhaar/phone is worse than a
  fictional one. Indian BFSI fiction is the convention and is correct; a leak of anything that looks
  genuinely personal is not.

## Method — SCREENSHOTS, NOT JSX

Reading the code tells you what was intended. **Opening the PNG tells you what a stranger gets, and
the gap between those two is where every defect in this repo has been found.** So for every route in
your section: shoot it, **open the image, and judge it as a projected/shared screen**. `report.json`
flags geometry and console errors and cannot see whether the screen makes sense.

Judge width too: this is a desktop console and the most repeated design defect here is a narrow
column with dead gutters at 1600px.

## Write your progress DURABLY, as you go

Your findings file is the deliverable and the only thing that survives you dying mid-run (three agents
were killed by a session limit today). Write to
`docs/audit/2026-08-05-viewer/<your-section>.md` **after every route or two**, never in one dump at
the end. Append; do not buffer.

Structure it as:

    # <Section> — viewer-demo audit
    ## Verdict for this section  (one paragraph: would this build or cost credibility?)
    ## BLOCKERS   (each: route · what a stranger sees · why it costs credibility · the screenshot file · smallest fix)
    ## RISKS
    ## Appropriateness findings   (exposure/leakage/jargon)
    ## What is genuinely strong here   (be honest — we need to know what to point at)
    ## LATER (one line each)

Ranked **cheapest-first** inside BLOCKERS: favour seed data, copy and empty-state fixes over refactors.

## Do not fix anything

You are auditing. Do not edit `src/`. Report, with the screenshot path as evidence, so the fixes can
be sequenced by value.
