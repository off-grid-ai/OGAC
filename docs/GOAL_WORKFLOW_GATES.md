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

### Added 2026-08-05, after working all six clusters — 6 more that are NOT build work

Each of these says, in its own gap text, to keep privileged administration deployment-owned. They were
being counted as open work because nobody had promoted that sentence into a decision. Same precedent as
the OpenTelemetry and Presidio entries above.

| Item | Why it is not open build work |
| --- | --- |
| `opensearch/cluster-snapshots-security` | "Keep privileged administration deployment-owned." A browser-triggered cluster snapshot or security-config change is not a capability worth having. |
| `warehouse/cluster-operations` | "Retain fleet ownership." Privileged ClickHouse administration from a web session is a blast radius, not a feature. |
| `jaeger/storage-retention-admin` | Retention and topology of the all-in-one deployment are deploy flags. The console reads and reports them; writing them is the deployment's. |
| `lancedb/versioning-index-tuning` | "Keep these deployment-owned." Table-version rollback and compaction are destructive and irreversible. |
| `victoriametrics/retention-backup-cluster` | Retention is now READ and reported (2026-08-05). Backup/restore/cluster stay deployment-owned deliberately. |
| `victorialogs/retention-alerts-tenancy` | Retention is now read and reported honestly. Writing it is a deploy flag; per-tenant retention does not exist on a single-node topology. |

**The pattern worth naming:** across all six clusters, a large share of what looked like a backlog was
either already built (a stale gate), owned by the deployment on purpose, or blocked on something outside
this repo. That is not an excuse — it is the finding. **Twelve of the rows examined had a gate claiming
something absent that already existed, or a root cause different from the one the gap named.**

**So the genuinely buildable subset is ~28 of the 41**, and clusters 1 and 2 (11 items) carry most of the
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

**2026-08-05 — cluster 1 CLOSED. All three steps done, proven live.**
Evidence: [`docs/evidence/2026-08-05-stream-trigger-live.md`](evidence/2026-08-05-stream-trigger-live.md).
A published Suraksha app consumes `insurance.claim-events` and drives a governed run per record.
17 historical records were NOT replayed; offset 20 produced `apprun_483326a5` with the feed named in
its provenance; a hand-rewound cursor was redelivered and refused (`dup=1`, run count unchanged).

`streaming/consumer-groups-offsets` workflow → `yes`. **Only that one.** The two
`enterprise-source-kafka` rows were deliberately NOT promoted: they are about the Data Sources
CONNECTOR catalogue, and their own gap text warns "do not reuse an admin proof as a source adapter".
A stream trigger is not a data-source connector. Promoting them would be exactly that mistake.

What the live proof caught that no test would have: **every run in the product recorded
`trigger: on-demand`** — the schema default — because no code path had ever written the run's
trigger. A run an inbound email or a schedule began was indistinguishable from one a person clicked.
Fixed at the seam (`initState` takes it, `upsertAppRunState` writes it insert-only, every entry point
declares its own) and threaded onto the durable path too, since the WORKER creates the run row.

Also found, and NOT fixed here: 14 capability rows claim four `yes` gates while their gap text says
otherwise — logged as **G-208** in `docs/GAPS_BACKLOG.md`. The map test is red because of it.

**2026-08-05 — cluster 2, `seaweedfs/lifecycle-versioning`: adapter and ui closed, workflow open.**

Verifying first paid for itself: the adapter gate said the port "does not manage bucket lifecycle
policy" and it already did. Three real defects surfaced while proving it, none visible from the code:
clearing a rule was a PUT of an empty document that SeaweedFS accepts and IGNORES (so "remove"
reported success and changed nothing); the response parser read a `<Transition><Days>` as an EXPIRY,
so the panel would have said "deleted after 1 day" about data meant only to move, and saving would
have made it true; and a bucket whose objects live in folders rendered "Empty bucket." All fixed.

`RetentionPanel` on `/data/lake` is the ui gate. **workflow stays `no`, and that is the honest
remaining work:** nothing binds a retention policy to the buckets the console itself writes to. A
person sets it per bucket, so a bucket created any other way keeps everything forever — which is not
a retention policy, it is a retention screen.

**2026-08-05 — `enterprise-source-minio/object-read-write`: CLOSED, all four gates.**
Evidence: [`docs/evidence/2026-08-05-governed-object-io.md`](evidence/2026-08-05-governed-object-io.md).
Two of the three gates were stale again (S3 was already `ready` with a dialect, and the create form
already existed). The write half genuinely did not exist; `sink: lake` is it, and it names a DATA
DOMAIN rather than a bucket, because a connector's keypair usually reaches the whole store.

**The hole the proof found:** the pipeline hard ceiling gated READS only, so the new sink was a way
out of it — a run whose output domain had been revoked still wrote the object. Fixed through the same
`enforceDataAccess` the read uses, re-proven in both directions. **84 of 196 fully leveraged.**

**2026-08-05 — `enterprise-source-minio/bucket-discovery`: CLOSED, all four gates.**
The S3 data-rule form lists a source's real buckets and folders instead of asking someone to type
them. Verified live (real buckets and folders in the picker, screenshot confirmed) plus four negatives:
`missing-credential`, `not-object-store`, `unknown-source` for a foreign tenant, `unreachable` for a
down store — never an empty list. Discovery never accepts an endpoint from the caller and never returns
object content. **85 of 196 fully leveraged.**

**2026-08-05 — `seaweedfs/lifecycle-versioning` workflow: CLOSED. And it found G-209.**
Evidence: [`docs/evidence/2026-08-05-lake-retention.md`](evidence/2026-08-05-lake-retention.md).
`lake_objects` is a class in the SAME sweep as app runs, destinations derived from the apps that write
there, enforcement pushed down to each bucket's own schedule. Proven live: a 200-day policy applied and
filed `1/1 destinations keep files 200 days`.

**The store truncates the expiry day count to one byte** — 3650 becomes 66. The sector needs 2555 and
3650, so the required windows are exactly the ones that wrap, downward, scheduling records for deletion
years early. The policy now refuses any window over 255 days and leaves the bucket unbounded, which is
an actionable gap rather than irreversible loss. `upstream` dropped to `partial`, so this row counts as
**upstream cannot** rather than leveraged — correct for a customer whose window is 3650 days.

It also caught a governance defect: destinations were derived from `listApps`, which hides `[autotest]`
apps *for presentation*. A presentation filter had reached a compliance calculation.

**2026-08-05 — `seaweedfs/topology-repair`: adapter + ui closed, workflow PARTIAL and honestly so.**
The console could say the store was UP, which is the least interesting thing about it. `/data/lake` now
leads with "if a disk fails, what happens to these files?" — and on this deployment the answer is that
replication is `000`, one copy, losing a disk loses it. Shown in red with a needs-attention badge, not
a green tick. `workflow` stays `partial` because the row is topology, replication **and repair**, and
rebalancing/EC repair are destructive operations that stay native until ownership and rollback
boundaries exist. Observing is bound; acting is not.

**2026-08-05 — `enterprise-source-minio/versioning-retention-events`: state surfaced, acting deferred
ON PURPOSE.** Measured before building, and the store DOES support versioning (`status: Suspended`), so
this is not an upstream-cannot. The bucket panel now says previous versions are NOT kept — overwriting a
file there is permanent — which is the more surprising of the two retention truths and nothing said it
before. Turning versioning on, object lock, and bucket events stay deployment-owned: privileged, partly
irreversible, and this store is already measured to truncate a lifecycle window over 255 days (G-209),
so a compliance control on it needs measuring per operation before it can be believed. Gates say
`partial` with the reason rather than `yes`.

**Cluster 2 is now worked through.** Four rows closed on all gates; two carry honest `partial`s naming
what is deliberately not built; one (`lifecycle-versioning`) is `upstream cannot` because of G-209.

**2026-08-05 — cluster 3, the five Evidently rows: ONE root cause, now fixed.**
The sidecar accepted only `reference`/`current` and always constructed `DataDriftPreset`, so the preset,
the stat-test method and the per-column overrides the console had been sending for months were silently
discarded — and the console then printed `Evidently ran "<selection>"`, a claim about work that never
happened. It also fell back to a local PSI with the same response shape, so an approximation was
indistinguishable from a real verdict.

Every response now names the engine, the preset really executed, and the test really applied per column
(using Evidently's own `stattest_name` — evidence, not intent). Live: `method=ks` → `K-S p_value`
threshold 0.05; two columns `score=psi`/`latency=ks` → `PSI 14.2504` and `K-S p_value 1.0`;
`data_summary` honestly reports it ran `data_quality` because 0.4.40 has no such preset.

`data-quality`, `psi-method` and `stat-tests` closed on all four gates. `data-summary` is `upstream
partial` (the preset does not exist in 0.4.40). `column-overrides` is `workflow partial` — the contract
and engine both apply overrides, but the product drift flow compares ONE column, so closing it needs a
multi-column drift source, not more adapter work. **88 of 196 fully leveraged.**

Also found: `drift_by_columns` lives on the SECOND metric of a preset expansion. Reading `metrics[0]`
gave every column `drifted=false` while the dataset beside it said 100% drifted.

**2026-08-05 — cluster 4, gateway routing: `load-balance-failover` CLOSED, `proxy-guardrails`
reclassified as deliberate.**
Evidence: [`docs/evidence/2026-08-05-gateway-failover-drill.md`](evidence/2026-08-05-gateway-failover-drill.md).
A dead peer was added under a live model name at runtime; requests came back with `attempted-retries`
1–2 AND the healthy deployment as the server — the router trying the dead one and finishing elsewhere.
Pool restored.

**The first drill was invalid and that is in the evidence.** Six identical prompts all returned 200,
one of them naming the DEAD deployment as its server — impossible, because response caching is enabled
and Redis was answering. A green drill that proves nothing is worse than no drill: it would have entered
the ledger as evidence. Any routing or latency drill on this proxy must defeat the cache.

**G-210:** failover is real in the proxy and INERT in practice — every model has one deployment, so
there is nothing to fail over to. That is a second inference host, so it belongs to the fleet.

`proxy-guardrails` is now recorded as an ownership choice, not a gap awaiting code: splitting governance
between the pipeline spine and the proxy would leave two places to configure, two to audit, and no single
answer to "what governed this run". **89 of 196 fully leveraged.**

**2026-08-05 — cluster 6 groundwork: credential rotation PROVEN on the MySQL fixture.**
Evidence: [`docs/evidence/2026-08-05-credential-rotation.md`](evidence/2026-08-05-credential-rotation.md).
Vaulted the inline password, rotated it, and **observed the stale vault entry being REFUSED** before
updating it — a rotation never seen failing has not been shown to do anything. Restored and re-verified.

**G-211:** every seeded fixture connector keeps its password inline in the endpoint URL, `secret_ref:
null`. The vaulted shape works (`con_f5c959` uses it); the seeds do not.

**The drill broke the fixture on its first run**, and the lesson is in the evidence: the restore was in
`catch`, not `finally`, so an abort between changing the database password and updating the vault left
the shared MySQL user unusable — and the restore that did run put back the console row while leaving the
database changed. A restore must be unconditional and must restore the FAR side.

Only the MySQL row moved. Postgres, MSSQL and REST share the mechanism but were not drilled, so they
stay `partial` rather than borrowing the evidence.

**2026-08-05 — cluster 5, the retention half: metric and log store windows now STATED.**
Most of cluster 5's rows say in their own gap text to keep privileged administration deployment-owned —
backup, restore, cluster topology, snapshots. That is a boundary, not a backlog. The part that WAS
missing is that the console could not say how long these stores keep data, which is the compliance claim
the roadmap says cannot stay open.

`/governance/evidence/retention` now reports it per store beside the database sweep, and keeps three
answers apart that a dashboard would flatten into one number: **confirmed** by the store, **assumed**
from a built-in default nobody chose, and **unknown**. A failed read is none of them and certainly not
"no limit". One unconfirmed store blocks the deployment-wide claim, because a retention statement is
about all the data.

**The reading is the finding:** metrics report `-retentionPeriod="3"` → 3 months, confirmed. The LOG
store — the one holding the audit trail — sets **no retention flag at all**, so it runs on the built-in
7-day default. Reported as ASSUMED, saying nobody chose it. Screenshot verified.

**2026-08-05 — G-208 CLOSED. The ledger no longer contradicts itself, and the count went DOWN.**
Fourteen rows claimed four `yes` gates while their own gap text named unfinished work. Twelve were a
closure narrative or a cross-reference in the wrong field — moved into the gate evidence. **Three were
demoted rather than tidied**, because the remaining work was real (jaeger exporter-failure state, the
per-process cache counters, and failover's missing redundancy → `upstream partial`, G-210). One had
drifted the other way: a `partial` gate with an EMPTY gap, the same dishonesty inverted.

**Fully leveraged fell 89 → 85.** That is the point. `test/service-capability-map.test.ts` is green for
the first time in this work.

**2026-08-05 — the two LanceDB attribution rows: code fixed, rows kept PARTIAL on purpose.**
`collection` was Qdrant-only and null for everything else, so a LanceDB retrieval recorded which provider
ran but not what it read — making "the port selected LanceDB" unfalsifiable. Now named per provider, from
the Brain's own exported constant so a rename cannot desync it.

**I could have closed both off the unit tests. The live check is why I did not:** a real retrieval on the
box returns `providerId=qdrant collection=offgrid-brain`, because `OFFGRID_ADAPTER_RETRIEVAL=qdrant`.
This deployment does not select LanceDB, so there is no live LanceDB retrieval here to attribute. Same
shape as G-210 — a configuration boundary, measured rather than assumed.

**2026-08-05 — `opensearch/index-lifecycle`: reading closed, and it found G-212.**
Retention on the search index is an ISM POLICY, not a flag. Reading it returned `total_policies: 0` —
**no lifecycle policies at all**, so the `security-auditlog-*` indices accumulate forever. That is the
"unbounded audit store" the roadmap calls a promise we cannot keep, and it is the audit trail, so it is
the one store a compliance reader asks about first.

Surfaced as `unbounded` on the retention page, and it now blocks the deployment-wide claim: **1 of 3
stores confirms a limit, 1 keeps data forever, 1 relies on a default nobody set.** Read through the
console's own vaulted bearer credential — asking an operator for an OpenSearch login would itself be the
defect. Authoring a policy is still absent, so the row stays `partial`.

### Next up — the rest of clusters 3–6

- `enterprise-source-minio/versioning-retention-events` — versioning and bucket events genuinely do
  not exist. The gap says keep privileged lifecycle deployment-owned until tenant-safe rollback and
  audit boundaries exist; **read the entry before building**, it may be deliberate. Note also that the
  deployed store cannot even hold a retention window over 255 days (G-209), so object-lock and
  versioning claims on it would need measuring before they are believed.
Then clusters 3 (data quality, 6), 4 (gateway routing, 3), 5 (retention/alerting, ~10), 6 (CDC, 2).

**Running tally:** cluster 1 closed (1 item); cluster 2 closed object read/write, bucket discovery and
lifecycle (all gates), plus topology observability — only `versioning-retention-events` is untouched,
and `topology-repair`'s acting half stays deliberately partial. 85 of 196 fully leveraged from 83, with
two rows correctly reclassified as **upstream cannot** rather than counted as ours. Three defects found by proving
things live that no test would have caught: runs never recorded their trigger, the data ceiling gated
reads but not writes, and a presentation filter had reached a compliance calculation.

**Verify before building — it has now paid off four times in two clusters.** Every row picked up so
far had at least one gate claiming something absent that was already there. Reproduce the gap live
first; the gates rot faster than the code.

**Two standing traps this session hit, worth reading before the next slice:**
- A live proof needs the WORKER restarted, not just the console — `app-worker.mts` bundles its
  workflow at startup, and three deploy rounds were spent before that was the answer.
- The dev server on the box issues `__Secure-` cookies for the production host, so a browser refuses
  them over `http://127.0.0.1:3005`. Start it with `AUTH_URL=http://127.0.0.1:3005` to screenshot
  an authed page.

## Measuring it

Only the script counts. Re-run it after every merge; it fails if the buckets stop reconciling to 196.
Do not retype the number into a document — that is exactly how the previous count was wrong three
different ways (70, then 82, then 124, against a truth of 83 and 111).
