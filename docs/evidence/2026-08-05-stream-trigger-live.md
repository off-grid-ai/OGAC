# Live proof — a record on a data feed starts a governed run

**Date:** 2026-08-05 · **Box:** on-prem console (S1) · **Tenant:** `org_suraksha` (Suraksha Life)
**Topic:** `insurance.claim-events` · **App:** `app_topicproof` (`[autotest] Claim event feed`,
bound to pipeline `pl_seed_org_suraksha_fraud-screening`)

The capability-map gap for stream consume was never "unproven primitive" — produce/consume was
drilled on 2026-07-20. It said *no registered source pipeline does it*. This is that binding.

## 1. Turning the trigger on is not a backfill

```
[topic-trigger] starting — polling every 10s
[topic-trigger] app_topicproof insurance.claim-events: read=0 ran=0 dup=0 parked=0 failed=0 initialised=1 lost=0
```

The topic held 17 records. `read=0`, `initialised=1`: the consumer started at the live edge and
replayed none of them. Seventeen historical claim intimations did not become seventeen governed runs.

## 2. A record arrives → a governed run, with the feed named in its provenance

Produced offset 20, key `CLM-2026-93006`:

```
[topic-trigger] app_topicproof insurance.claim-events: read=1 ran=1 dup=0 parked=0 failed=0
```

```json
{ "id": "apprun_483326a5", "org_id": "org_suraksha", "app_id": "app_topicproof",
  "status": "running",
  "trigger": { "kind": "topic",
               "config": { "topic": "insurance.claim-events",
                           "groupId": "offgrid-app-topic-proof" } } }
```

The run's input carries the record as both parsed fields and the raw text:

```json
{ "input": "Death claim intimation received for policy SL-LIFE-5510288. Assess and route.",
  "recordKey": "CLM-2026-93006",
  "body": { "claimId": "CLM-2026-93006", "policyNo": "SL-LIFE-5510288",
            "claimantName": "Kavya Reddy", "panMasked": "QWEPR****T", "amountInr": 1375000 },
  "raw": "{\"claimId\":\"CLM-2026-93006\",…}" }
```

It ran on the app's bound pipeline through `submitAppRun` — the same governed entry point the
webhook and email triggers use. No stream-specific shortcut around policy, guardrails or signing.

### A defect this proof caught

The first two runs recorded `trigger: {"kind":"on-demand"}`. Not a stream-trigger bug — **no**
trigger had ever been persisted; every run in the product recorded the schema default, so a run an
inbound email or a schedule began was indistinguishable from one a person clicked. "Did a human ask
for this?" is the first question of any incident review. Fixed at the seam (`initState` takes the
trigger, `upsertAppRunState` writes it insert-only) and every entry point now declares its own. It
also had to be threaded onto the durable path, because the WORKER creates the run row and anything
the dispatch site knows but does not thread there is lost. A green consumer test would never have
found this.

## 3. The cursor advances only behind durable work

```
CURSOR [{ "partition": 0, "next_offset": "21" }]
LEDGER  insurance.claim-events/0/17 → ran (apprun_fb63bad8)
        insurance.claim-events/0/18 → ran (apprun_2ba9ffc9)
        insurance.claim-events/0/19 → ran (apprun_628055b2)
        insurance.claim-events/0/20 → ran (apprun_483326a5)
```

## 4. Replay does NOT re-run

Rewound the cursor to 20 by hand — exactly the state a crash between the run and the commit leaves
behind, where the broker redelivers a record whose run already exists.

```
RUNS BEFORE REPLAY 5
CURSOR REWOUND TO 20
[topic-trigger] app_topicproof insurance.claim-events: read=1 ran=0 dup=1 parked=0 failed=0
RUNS AFTER REPLAY 5
CURSOR [{ "partition": 0, "next_offset": "21" }]
insurance.claim-events/0/20 → duplicate, run_id apprun_483326a5 (the ORIGINAL run, still traceable)
```

The record was redelivered, recognised, and refused. The run count did not move, the cursor
recovered, and the ledger still points at the run the record actually caused. At-least-once
delivery, effectively-once execution.

## Why the cursor is ours and not the broker's

Broker auto-commit acknowledges a record when it is **delivered**. A crash between that and the run
leaves the record gone from the queue with no run recorded — enterprise work destroyed, and the
symptom is silence. Run-then-commit can duplicate instead, which §4 shows is suppressed, and which is
recoverable in a way a lost customer instruction is not.

## Reproducing

```bash
npm run trigger:topic          # OFFGRID_REDPANDA_BROKERS + DATABASE_URL required
```

Give a published app a `topic` trigger naming a feed; produce a record to it.
