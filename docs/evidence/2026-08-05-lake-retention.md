# Live proof — retention bound to what runs WRITE, and the store cap it exposed

**Date:** 2026-08-05 · **Box:** on-prem console (S1) · **Tenant:** `org_suraksha` (Suraksha Life)

The retention surface covered database record classes and its own note said lake purging "stays with
the data engine and is reported as deferred". That was honest while nothing the console ran wrote to
the lake. Apps can now write there (`sink: lake`), so the deferral had become a hole: a governed run
could accumulate files that no policy bounded, while the console still claimed a retention limit.

## The binding

`lake_objects` is a retainable class in the SAME sweep as app runs and indexed text — not a second
retention screen. Enforcement is pushed down to each destination bucket's own schedule rather than a
delete loop here: the store already expires objects, and a second clock in the console would only hold
the promise while our process happens to be running.

Destinations are **derived from the apps that write there**, never configured. A hand-maintained list
is wrong the first time somebody adds an output step, and the failure is silent.

## 1. A window the store can hold

```
── APPLY 200 days ──
["Retention proof output (suraksha-retention-proof/assessments/): nothing bounded how long files are
  kept here. Now kept 200 days, matching policy."]

── RETENTION SWEEP outcome for lake files ──
{"recordClass":"lake_objects","action":"delete","affected":0,"remaining":0,
 "detail":"1/1 destinations keep files 200 days. Retention proof output
   (suraksha-retention-proof/assessments/): kept 200 days, matching policy."}
```

Re-applying is a no-op, and an operator's own rule on a different prefix survived — applying the
policy merges rather than replacing, because a deleted retention rule means data living longer than
someone intended, which is the failure this feature exists to prevent.

## 2. THE FINDING — the store silently wraps the day count to one byte

Measured directly:

| Window set | Read back | |
| --- | --- | --- |
| 30 days | 30 | ok |
| 365 days | **109** | 365 − 256 |
| 3650 days | **66** | 3650 − 14×256 |

Our XML was correct and our parser was correct — verified by round-tripping the document with no store
involved. The store encodes the expiry-day count in a single byte and **wraps silently, downward**.

**This is the most dangerous shape a bug can take here.** BFSI retention windows are 2555 days (bank)
and 3650 (life insurer) — the console's own retention rules already use exactly those numbers. So the
values a regulated customer actually needs are precisely the ones that break, and they break by
deleting records years early while every surface reports the policy as applied.

## 3. So the policy REFUSES to apply a window the store cannot hold

```json
{"before":{"state":"unrepresentable","expected":3650,"wouldBecome":66},
 "after":null,"applied":false,
 "line":"Retention proof output (…/assessments/): this store cannot keep files for 3650 days — it
   would silently reduce that to 66 days and delete them early, so NO retention rule was set here.
   Files are kept until something removes them.",
 "error":"this store cannot hold a 3650-day window (it would become 66 days)"}
```

Summary: `0/1 destinations keep files 3650 days; 1 could NOT be set.` — and the bucket was left
untouched.

Between a false compliance claim that destroys records and an honest gap, the honest gap is correct.
An unbounded bucket is a compliance gap someone can act on; early deletion is irreversible.

## A second defect this proof caught

The first run reported **"No workflow writes files to the object store"** while one demonstrably did.
Cause: retention derived its destinations from `listApps`, which hides `[autotest]` apps on demo
tenants for presentation. **A presentation filter had reached a governance calculation** — and an app
hidden from a list still runs, still reads data and still writes files. Now uses
`listAppsForGovernance`, unfiltered, with the reason recorded at the call site.

## What remains, and it is not ours

A window beyond 255 days cannot be enforced by this store. Options, none of them console-side:
run a store that holds the window, or add a console-side sweep for long windows (a second clock, with
the honesty cost that entails). Logged as **G-209**. Until then `upstream` on
`seaweedfs/lifecycle-versioning` is `partial`, deliberately, so the count does not call this row
leveraged for a customer whose window is 3650 days.

## Reproducing

Give a published app an `output` step with `sink: lake` pointing at an s3 data domain, set a
`lake_objects` retention rule, and run the sweep from Governance → Retention.
