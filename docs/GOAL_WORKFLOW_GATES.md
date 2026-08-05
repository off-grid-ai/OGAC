# GOAL — bind the primitives into product workflows (the `workflow` gate)

**Baseline, derived not asserted** (`npx tsx scripts/count-capability-gates.mts`):

```
services 49 · items 196 · fully leveraged 83 · under-leveraged 111 · upstream cannot 2
per gate  adapter 122 yes / ui 118 yes / workflow 103 yes, 51 partial, 42 no
```

`workflow` is the weakest column by a distance. That is the whole finding: adapters and UIs largely
exist, and what is missing is capabilities **bound into something a person actually uses**. This goal is
that binding — not more adapters.

> **Correction to my own number:** I said "42 workflow gates". 42 is the count of `workflow: no`, but one
> of those also has `upstream` not `yes`, so it is not ours. **41 are ours.** Get the list with
> `--json` rather than trusting this sentence — that is the lesson of the last one.

## Definition of done, per item

A gate goes to `yes` when **a governed product workflow uses the capability and leaves a retained
artefact** — not when a probe succeeds. The Redpanda lesson is the reference: I ran a full
create → configure → produce → consume → delete drill, and it closed nothing, because the gap text said
*"no general pipeline output uses this adapter"*. Proving a primitive is not binding it.

And per the entity-consumption invariant: the binding must run **agent/app → pipeline → gateway → model**,
with no step skipped.

## The 41, clustered by what the work actually is

### 1. Streaming as a product I/O path — 6 items · HIGHEST VALUE
Redpanda (consumer groups/offsets; ACLs, users, quotas; partition movement + tiered storage) and
Kafka-compatible Events (source produce/consume; topic + schema discovery; offsets/ACLs/source ops).

The outbound half is **done** — a `topic` sink publishes a governed app output with masking applied. What
is missing is the **inbound** half: a registered source pipeline that consumes a topic and drives a
governed run. That completes triggers-in → governed run → sinks-out, which is the consumption
architecture, so this is worth more than its item count.

### 2. Object storage as governed data movement — 5 items
S3-compatible Data Lake (governed object read/write; bucket + object discovery; versioning, retention,
policies, events) and Object store (lifecycle + versioning; volume topology, replication, repair).
SeaweedFS is running and serving. Nothing governed reads or writes through it.

### 3. Data quality and drift — 6 items
Drift monitoring (data summary preset; data quality preset; statistical test selection; per-column method
overrides) and Data Quality (expectation suite lifecycle; data sources, profiling, validation history).
Bind these to the pipeline that already produces the data, so a failing expectation stops or flags a run.

### 4. Gateway routing depth — 3 items
LiteLLM: load balancing/retries/failover; fleet and cloud provider pools; proxy guardrails and policy
hooks. **Caveat:** the proxy-guardrails item is arguably *deliberate* — the entry says governance stays in
the Off Grid pipeline spine, and moving it into the proxy would split it. Read the entry before building.

### 5. Store administration and retention — ~10 items
VictoriaMetrics (alerts + recording rules; retention/backup/cluster ops), VictoriaLogs (retention, alerts,
tenant ops), Jaeger (storage, retention, service admin), Search index (cluster, snapshots, security admin),
Analytics warehouse (partitions, replicas, quotas), LanceDB (versions + index tuning), Marquez
(namespaces, tags, ownership).

Lowest product value of the buildable clusters, but retention is a **compliance** claim, not a
convenience — an unbounded audit store is a promise we cannot keep.

### 6. Connector CDC — 2 items
Policy Administration and Finance ERP: schema discovery, CDC, database administration. Pairs with the
streaming work above — CDC is the other way real enterprise data arrives.

## NOT build work — do not burn time here (7 of the 41)

Being explicit so nobody "closes" these by building the wrong thing:

| Item | Why it is not open build work |
| --- | --- |
| OpenTelemetry Collector — receiver/processor/exporter config; sampling/filtering/redaction/routing (2) | The entry says keep committed YAML deployment-owned and **do not expose a raw editor**. Current state is best. |
| Presidio — language selection and multilingual analysis (1) | Measured 2026-08-04: English is the only language this deployment serves, and the scan is fail-closed. A picker would cause outages. The validation shipped; the picker deliberately did not. **This gate needs reclassifying as deliberate, not building.** |
| Feature Flags — lifecycle; progressive rollout and variants (2) | Needs an admin token that does not exist, and **Unleash SSO/OIDC is Enterprise-only** — so it can never be Keycloak-fronted. Console-only access per `IDENTITY_ONE_DOOR.md`. |
| Device Management — host/software inventory; live queries and compliance policies (2) | Needs a host actually enrolled. Operator work. |
| BI & Dashboards — advanced SQL and chart authoring (1) | Blocked behind Superset embed registration; the real fix is the Superset OIDC cutover, which deletes the stored credential too. |
| Identity & SSO — federation and MFA policy (1) | Sequenced behind `IDENTITY_ONE_DOOR.md`; doing it before that is rework. |

**So the genuinely buildable subset is ~34 of the 41**, and clusters 1 and 2 (11 items) carry most of the
product value.

## Order of work

1. **Inbound streaming source** (cluster 1) — completes triggers-in → governed run → sinks-out.
2. **Governed object read/write** (cluster 2) — the data-movement half nothing uses yet.
3. **Superset OIDC cutover** — unblocks BI, and removes a static credential.
4. **Data quality bound to a live pipeline** (cluster 3).
5. **Retention and alerting** (cluster 5) — a compliance claim, so it cannot stay open indefinitely.

## Progress log

**2026-08-05 — cluster 1, policy layer landed.** `src/lib/topic-trigger-policy.ts` + 12 tests (49 pass
across the trigger suite). `topic` is a registered `TriggerKind`, validated and normalised through that
one policy by both `validateTrigger` and `normalizeTrigger`, and **deliberately gated as coming-soon
with a test asserting it stays gated** until a consumer exists. The gate is still `no` — correctly.

**Do not rebuild what is already there.** Before writing the consumer, read
`src/lib/kafka-enterprise-source.ts`: it already provides the governed read path —
`parseKafkaSourceReadRequest`, `validateResolvedKafkaSourceBinding`, `authorizeKafkaSourceRead`,
`kafkaConsumerGroup`, `resolveKafkaPartitionWindows`, `KafkaSourceRecord` and a provenance record with
`consumerGroup` / `consumedAt`. The consumer is a LOOP over that existing seam plus the delivery
semantics in `topic-trigger-policy.ts` — not a new client. Duplicating it would be exactly the DRY
defect the merge gate rejects.

Remaining to close this gate, in order:
1. A consumer loop in the worker (workers run `src/` via tsx — rsync + restart, not a `.next` deploy):
   poll → `dispositionFor` → dispatch a governed run → persist → **only then** commit the offset.
2. Move `topic` from `COMING_SOON_TRIGGER_KINDS` to `CONFIGURED_TRIGGER_KINDS` **in the same change**,
   and update the guard test that currently asserts it is gated.
3. Live proof on the box: produce a record → a governed run appears with its provenance → the offset
   advances → replay the same offset and confirm it does NOT run twice. Retain the artefact.

Only after step 3 does the gate move to `yes`. A passing consumer test does not close it — see the
acceptance bar above.

## Measuring it

Only the script counts. Re-run it after every merge; it fails if the buckets stop reconciling to 196.
Do not retype the number into a document — that is exactly how the previous count was wrong three
different ways (70, then 82, then 124, against a truth of 83 and 111).
