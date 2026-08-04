# Are we leveraging the OSS we already run?

**Goal:** every integrated OSS service used to the best state it can be.

Measured against `SERVICE_CAPABILITY_AUDITS` on **2026-08-04**. The map records four gates per capability
(`upstream` / `adapter` / `ui` / `workflow`), so "under-leveraged" has an exact definition: **the upstream
service says YES and one of ours says NO.**

## THE COMPLETE ASSESSMENT — all 196 items, classified (2026-08-04)

Earlier passes sampled. This is every item, classified from its own gap text and gate evidence:

| Class | Items | Share | What it means |
| --- | --- | --- | --- |
| **Fully leveraged** | **70** | 36% | all four gates `yes` — nothing to do |
| Open build work | 73 | 37% | ours to build, no external dependency |
| Needs a proof run | 26 | 13% | adapter + UI exist; never exercised end-to-end on this deployment |
| **Deliberate — current state IS best** | **17** | 9% | the entry itself says keep it deployment-owned / don't expose an editor / governance stays in the spine |
| Blocked on an operator | 8 | 4% | a credential to mint, a host to enrol, sudo on the box |
| Upstream doesn't support it | 2 | 1% | not our gap at all |

**At their best possible state today: 89 of 196 (45%)** — the 70 fully leveraged, plus the 17 where the
architecture deliberately declined, plus the 2 upstream cannot do.

**Genuinely actionable by us: 99** (73 build + 26 proof runs). **8 need an operator.**

### What that means for the goal as written

"All to the best possible state" is reachable for **99 items** and *already true* for **89**. It is **not**
reachable for the 17 deliberate ones without building what the architecture rejected — an OTel config
editor the entry says not to expose, LiteLLM guardrails that would split governance away from the Off Grid
spine, Superset authoring pulled out of its own authenticated surface. Driving those to `yes` would make
the product worse while making the map greener, which is the definition of a metric gamed.

So the honest statement of this goal is: **89 are at their best state, 99 are executable work, 8 need an
operator, and 17 are already correct as they stand.** That is the whole of 196, assessed — not sampled.

### The 26 proof runs are the cheapest real progress

They need no code: enrol a host, produce and consume a record, create-to-archive a flag, run a drill. Each
is an afternoon with the box, and each converts a `partial` into a `yes` with a retained artefact. Two were
done today (the vault restore drill; the Redpanda produce/consume) and one of those revealed that the *gap
text* had been wrong for months.

## The measurement — and a correction to it

> **I got this number wrong four times before checking it properly.** I first reported "31 of 196", and
> repeated it in four summaries. The 31 was the number of rows that survived `tail -60` on my own
> diagnostic — I read a truncated list as the total. **The real figure is 126 of 196** (64%), not 31 (16%).
> Recounted after today's promotions: **124**.
>
> The lesson is the one this session kept teaching in other forms: a number that arrives from a pipe you
> did not bound is not a measurement. It is what fitted on the screen.

**124 of 196 capabilities are under-leveraged** — the upstream service supports it and one of our gates
does not.

A large share are `partial` on `adapter` or `workflow` for reasons the entries themselves record as
deliberate: OTel collector configuration says *"keep committed YAML deployment-owned … do not expose a raw
editor"*; LiteLLM guardrails say governance stays in the Off Grid pipeline spine; Superset authoring stays
in its own authenticated surface. For those, the current state **is** the best state, and counting them as
debt would be theatre. What the number does honestly say is that most capabilities are proven as
primitives and not yet bound into a product workflow — which is exactly what the Redpanda item turned out
to be.

## Closed on 2026-08-04

### Presidio — language selection and multilingual analysis

The map asked for "supported-language discovery, validation, and an org or pipeline setting". **Half of
that would have broken the tenant's PII protection.** Measured against the deployed analyzer:

```
/supportedentities?language=en  → 200
/supportedentities?language=hi  → 500  "No matching recognizers were found to serve the request"
ta, mr, es                      → 500  likewise
```

English is the **only** language this deployment serves. A language picker offering Hindi would send `hi`,
the analyzer would 500, and this scan is **fail-closed by design** — so it would refuse every governed
call. Adding the setting without the validation converts a working control into an outage. **So the
validation shipped and the picker did not.**

`presidioLanguages()` discovers support by probing (Presidio has no list-languages endpoint; a served
language answers 200, an unserved one 500), cached 10 minutes. `resolveAnalyzerLanguage` never returns a
language the service cannot serve and states why it substituted — a scan that quietly ran in the wrong
language is a scan whose misses nobody can account for.

**The measurement that matters for an Indian tenant**, and the reason not to panic about English-only:

```
analyze("ग्राहक का पैन ABCDE1234F और आधार 2345 6789 0123 है", language: "en")
  → PERSON, IN_PAN, IN_AADHAAR     (engine=presidio, status=applied)
```

The Indian identifier recognizers are **pattern-based**, so PAN, Aadhaar, voter ID, card and account
numbers and email are found whatever script surrounds them. Only names and places in non-Latin script are
matched less reliably, and `describeLanguageReach` says exactly that rather than implying multilingual
cover we do not have.

### App Worker — output and run-state persistence

`persistState` was `try { … } catch { /* DB unreachable — degrade to no-op */ }`. The comment is right that
the workflow state is authoritative — the **run** is not lost. What was lost is the **console's view** of
it, which is what every person and every audit reads: a completed run whose final write failed showed
whatever the last successful write said, with no error anywhere.

Now: bounded exponential retry (total under a second — an activity that retries for a minute stalls the run
it is trying to record), then a loud `APP_RUN_PERSIST_FAILED` line carrying run/org/status/attempts and the
error **cause** (Drizzle wraps the real reason there; a bare message reads "Failed query" and diagnoses
nothing). It cannot be recorded in the database we just failed to reach, so it goes to the worker log —
and without the run id the alarm is unactionable, because the repair is "re-persist THIS run".

A **terminal** run's lost write is `console.error` (nothing later will correct it); a mid-run write is
`console.warn` (the next step's write supersedes it). Treating them the same would either cry wolf or bury
the permanent case.

### AI Gateway — cloud egress DLP: the entry was understated, and now says what is true

I first corrected this from code reading and refused to promote the gate, which was right. Then I went and
measured the ledger, which is what the bar actually requires:

- **24** retained `gateway.egress.dlp` events, **every one carrying a run id**.
- **21 come from the AGENT path.** Sampled `run_8efafec2` / `run_e0949b61` / `run_14e9b52a` — all resolve to
  `agent_runs` rows, `status=done`, `org_bharat`, `outcome=redacted`, dated 2026-08-03/04.
- 3 from chat. Outbound sinks mask via `maskTextForSend` before the body crosses the boundary.

So the old text — "agent and app model calls, cloud tools, and outbound sinks do not enter it" — was wrong
about agents and sinks. The audit entry now states the measured numbers instead.

**What is genuinely unproven, and the gate stays `partial` for it:** the APP model call on a
cloud-permitted pipeline. **0** app-spawned agent runs carry a DLP event — because every app run on this
tenant is forced on-prem by the pipeline routing rule `pii-local`, so there is no cloud egress to screen.
That is the leash working, not a hole, but it leaves the app cloud-egress seam without a live artefact.

**Probed it properly (2026-08-04), and the answer is sharper than "unproven".** Two scratch runs through
`runAgent` — the exact function an app's agent step calls — with no live tenant config touched:

| Contract | `runEgress` | DLP event | Why |
| --- | --- | --- | --- |
| no routing rules | not cloud | 0 | nothing to screen |
| real pipeline overlay incl. `pii-local` | **`local`** | 0 | **the leash sent it on-prem** |

`runEgress = modelVerdict.egress`, and `egressDlpRunDemand` only demands masking for a **cloud-permitted**
run. A locally-routed run skips the hook *because nothing leaves the building* — that is the control
working, not a hole. Both probes also had their PII masked at the input guardrail regardless
(`PAN ABCDE1234F` → `[PAN]`, verified in the run's own checks) and neither leaked the raw PAN into the
answer.

So the app path cannot produce a cloud-egress artefact **on this deployment** without routing governed app
runs to a cloud provider — which is a deploy-level change to a box whose entire promise is the opposite.
The 21 agent-path events remain the evidence that the hook fires when a run *is* cloud-permitted.

**Do NOT relax a live tenant's PII routing rule to manufacture the evidence** — weakening a real control to
produce a test artefact is the worst trade available here. If this must be closed, it needs a separate
cloud-permitted pipeline on a scratch org, not an edit to `pl_seed_org_bharat_*`.

### OpenTelemetry Collector — trace correlation per app run

`correlationIds` already derives a deterministic trace id from a run id — better than storing one, since it
cannot drift — but it was only ever used on the agent path. From an APP run's console record there was no
way to reach its trace except searching Jaeger by time and hoping. `traceLookup` closes that.

The honesty half matters as much as the link: a trace that is not there can mean nothing was exported **or
that the export failed**, and presenting "no trace" as if it settled the question is the
failure-presents-as-emptiness defect. The caption says both. **Still open:** recording exporter-failure
state per run, which needs instrumentation inside the OTLP path rather than a caption.

### Vector index — payload-index lifecycle

Measured on the deployed collection (`offgrid-brain`): **no payload indexes at all**, while *every* governed
retrieval filters on `org_id` — the tenant isolation boundary, applied on every single query in `qdrant.ts`.
Qdrant answers an unindexed filter by scanning: invisible at three points, and the thing that falls over
first as a corpus grows.

`listPayloadIndexes` / `createPayloadIndex` / `dropPayloadIndex` on the port, with the judgement pure:
`recommendPayloadIndexes` only ever suggests fields **we actually filter on** (an index costs memory and
write time, so recommending one nobody queries is a cost with no return), and reports them even on a tiny
collection with `smallForNow` set — a recommendation that appears once the store is already slow arrives
after the problem.

Fixed on the live deployment, not just in code:

```
BEFORE  indexes: []            → recommends org_id:keyword, text:text  (not urgent yet)
AFTER   indexes: [org_id keyword (3 points), text text (3 points)]
        recommends: none  →  "Every field this platform filters on is indexed (2 indexes)."
```

`validateIndexRequest` refuses a field name before it reaches a REST path (`"org id"`, `"org/../id"`,
64+ chars) and names the valid types on a bad one. 9 tests, built on the real `payload_schema` shapes the
deployment returned before and after.

## Next, in value order

1. **App cloud-egress DLP proof on a scratch cloud-permitted pipeline** — the one remaining unproven seam
   in the entry above. Never by loosening a live tenant's routing.
2. **Exporter-failure state per run** — so a missing trace is distinguishable from a failed export.
3. **Redpanda / LanceDB / Feature Flags / Device Management** — see the correction below. Redpanda is a
   product-binding job, not a drill. Feature Flags needs an admin token nobody has minted. Device
   Management needs a host enrolled.
4. ~~A console surface for payload indexes~~ **DONE 2026-08-04** — `PayloadIndexManager` on the collection
   detail page, beside snapshots. Recommendations are one-click *with the type the rule already decided*:
   making an operator retype `keyword` is how the field that matters most ends up indexed as the wrong
   type. Full CRUD round-trip verified live (GET → DELETE `text` → recommendation returns → POST → gone
   again; a malformed field name answers 400).

## The pattern across all of this

Three of the four things touched today were **not** missing features. Presidio's "add a language setting"
would have broken PII protection; the cloud-egress entry understated coverage by 21 events; the persistence
gap was a silent `catch`. The map's `gap` text is a hypothesis written at audit time, and the work is to
measure it before building to it — twice today that measurement inverted the prescription.

## A correction I owe: I misread the Redpanda gaps

I described Redpanda / LanceDB / Feature Flags / Device Management as "drills, not builds — they need an
operator at the box". Then I ran the Redpanda drill from here to prove the point, and it worked:

```
CREATE     topic offgrid.drill.capability-proof            present: true
CONFIGURE  retention.ms = 600000                           read back
PRODUCE    partition 0, offset 0, errorCode 0
CONSUME    matched by correlationId corr-1785830119        full JSON round-tripped
DELETE     topic gone: true                                nothing left behind

Schema Registry:  register {"id":4} → read v1 → compatibility {"is_compatible":true}
                  → soft + hard delete → back to the original 3 subjects
```

**But that closes nothing, and I nearly promoted four gates on the strength of it.** Reading the entries
properly, their `workflow` gap does not say "never proven". It says:

- produce → *"no general pipeline output uses this adapter"*
- consume → *"no registered source pipeline does"*
- schema registry → *"production streams do not enforce console-managed schemas"*
- topic lifecycle → *"no application provisioning lifecycle is registered"*

And a fifth entry, `bfsi-stream-proof`, is **already `yes` on all four gates** — the primitives were proven
on 2026-07-20. My drill was a sixth proof of a primitive that was never in doubt.

**The gap is production BINDING, not proof.** Closing it means a governed pipeline output actually
publishing to a topic and a registered source actually consuming one — product work, not an operator at a
terminal. Two of my characterisations were wrong in the same breath: these are builds, and they are builds
*here*, not on the box.

Feature Flags is a genuine credential gap (Unleash answers 401; no admin token exists in the deployment
env). Device Management genuinely needs a host enrolled. Those two are operator work; Redpanda and LanceDB
are ours.

## Redpanda producer: the binding, closed properly (2026-08-04)

Having established the gap was **binding**, not primitives, I built the binding: a `topic` outbound sink,
registered in the existing `SINK_REGISTRY` so a governed app output step publishes its outcome to a stream
topic through the *same* sequence every other sink runs (egress leash → PII mask → deliver → honest
record). No parallel path, no governance logic in the new file.

Air-gapped, like the on-prem WhatsApp gateway — the broker is on the customer's own network — and it never
auto-creates a topic: a sink that conjures its destination hides a misconfigured app.

Proven live:

```
registry     {"kind":"topic","transport":"air-gapped","label":"stream record","destinationField":"topic"}
no topic     ok:false configured:false  "this step names no topic to publish to"
unknown      ok:false configured:true   "This server does not host this topic-partition"   (no auto-create)
PUBLISH      ok:true  partition:0 offset:"0"                                (the broker's own receipt)
CONSUMED     key=apprun_bindproof_… runId matched, full JSON round-tripped
```

And the governance property that mattered, checked against the **real** `pl_seed_org_bharat_*` contract:
`sinkMaskingRequired` is true and the raw PAN is replaced with `[PAN]` before the record is published.
Internal is not unprotected — a topic is durable and multi-consumer, unlike a point-to-point message.

### A governance gap found while testing it

`effectiveGovernance` merges by iterating the **org catalogue**, so a pipeline guardrail overlay naming a
control the org never declares contributed **nothing, silently**. A pipeline reading "PII masking: locked
ON" while doing nothing is the worst kind of wrong. It now returns `ignored: string[]` so a surface can say
the setting has no effect. Not reachable through the overlay UI today (it offers only declared controls),
but reachable by seed SQL or API — which is how the demo pipelines were configured.

### Three of my own errors in this one slice, for the record

1. I asserted topic records are masked using a scan shaped `{ sanitized }`. `PiiScanLike` uses `redacted`.
   The malformed scan meant no substitution happened and my test "found" a hole that was mine.
2. I built test contracts with a guardrail **overlay** and no org default — which contributes nothing (see
   above). Three wrong shapes before I read the merge.
3. I dropped the cloud half of the detector-outage test rather than ship an assertion I could not state
   confidently. The suite that owns sink governance already covers it.

## Content guardrails: two claims corrected, the rest are real

Memory said the guardrail entries had once been stale-pessimistic, so I checked all six. **Four are
precise and genuinely open** — the deployed shard runs 4 of 15 input classifiers, the output scanner set is
limited, Console scanner rules are not reconciled into the upstream static YAML, and there is no telemetry
adapter. Those are real work, correctly described.

**Two claims were wrong**, and both are the same defect this session kept finding — an "it is hidden"
assertion that was no longer true:

- *"Its optional-shard degradation header is discarded by the Console adapter"* — it is not.
  `guardrail-provider` parses `x-offgrid-guard-degraded` and `x-offgrid-guard-answered`, and `checks.ts`
  folds them into the retained check detail.
- *"An optional classifier outage is hidden from the normal path"* — it is not. **Ten** agent runs already
  carry it, e.g. `run_658c93b8`, `run_cc73dcf2`, `run_f9208926` on `org_bharat`, each retaining
  `coverage degraded: unavailable classifiers; answered by pii` — and one of those runs was **blocked**.
  A governed run whose classifier shard was down says so rather than reading clean.

What remains true in that entry is narrower and now stated as such: `/healthz` proves only the aggregator
process, `/readyz` is not consumed, and per-shard readiness has no surface.

This is the fourth time in this session that a `gap` line asserted something was invisible when it was
already recorded. The instrument drifts pessimistic as the product moves, and reading it without measuring
produces work that is either unnecessary or actively wrong.

## The forwards were dead, and that had been distorting the map (2026-08-04)

Chasing the three "forwarder not repo-owned" items found something much worse than a reproducibility gap.
Two LaunchDaemons existed on the host but not in the repo, each running `gost` as root against a
**hard-coded 192.168.1.65** — g5's address when they were written. g5 is now `192.168.1.29`:

| | via the forward | direct to g5 |
| --- | --- | --- |
| `:4000` LiteLLM | **000** | 200 |
| `:9428` VictoriaLogs | **000** | 200 |
| `:16686` Jaeger | **000** | 200 |

**Because the ports were bound, nothing detected them as down.** A listener is not a route. Every console
surface over the model router, the log store and the trace store was talking to a dead port.

Fixed by folding all three into the repo-owned `tcp-forward.js`, which resolves `.local` names per
connection — the rule at the top of that file exists precisely so a DHCP lease change cannot break a
forward. Verified after cutover: all three answer 200; LiteLLM returns its model list; Jaeger reports 5
services including `offgrid-console`.

**This probably distorted several capability assessments.** Entries for VictoriaLogs ingestion, Jaeger
service dependencies, OTel trace export and the LiteLLM surfaces were audited while their transport was
silently dead — so some of those `partial`/`no` gates may be describing a broken forward rather than
missing work. **Re-audit that cluster before building against it**, which is the same
verify-before-building rule this document keeps re-learning.

### What the fixed forward made provable

A live round-trip through the LiteLLM proxy: `POST /v1/chat/completions` with `onprem/qwen3-vl-8b` returned
the requested string, and `/spend/logs` attributed it (47 rows today, newest matching the request).
Impossible before the fix.

**Deliberately not claimed:** console chat and governed pipeline runs still go through the aggregator on
`:8800`, not the proxy. Repointing them is a deployment change. So the proxy is proven *reachable and
attributing*, not proven as the serving path — and the entry says exactly that.