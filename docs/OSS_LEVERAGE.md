# Are we leveraging the OSS we already run?

**Goal:** every integrated OSS service used to the best state it can be.

Measured against `SERVICE_CAPABILITY_AUDITS` on **2026-08-04**. The map records four gates per capability
(`upstream` / `adapter` / `ui` / `workflow`), so "under-leveraged" has an exact definition: **the upstream
service says YES and one of ours says NO.**

## The measurement

**31 of 196 capabilities are under-leveraged** — the OSS supports it, we do not yet use it.

Split by which gate fails:

| Failing gate(s) | What it means | Count |
| --- | --- | --- |
| `workflow` only | Adapter and UI exist; never proven end to end on the deployment | ~11 |
| `ui` / `ui+workflow` | Adapter works; no console surface owns it | ~9 |
| `adapter…` | Code we have to write | ~8 |
| all three | Host-owned or a deliberate ownership choice | ~3 |

The `adapter`-only ones are the real backlog, because the others are mostly deploy-config or a conscious
decision to keep something in its own surface (Superset authoring, LiteLLM guardrails — governance stays in
the Off Grid pipeline spine, which is a valid choice and is recorded as one rather than as a gap).

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

**Prove it on a scratch pipeline that permits cloud egress. Do NOT relax a live tenant's PII routing rule
to manufacture the evidence** — weakening a real control to produce a test artefact is the worst trade
available here.

### OpenTelemetry Collector — trace correlation per app run

`correlationIds` already derives a deterministic trace id from a run id — better than storing one, since it
cannot drift — but it was only ever used on the agent path. From an APP run's console record there was no
way to reach its trace except searching Jaeger by time and hoping. `traceLookup` closes that.

The honesty half matters as much as the link: a trace that is not there can mean nothing was exported **or
that the export failed**, and presenting "no trace" as if it settled the question is the
failure-presents-as-emptiness defect. The caption says both. **Still open:** recording exporter-failure
state per run, which needs instrumentation inside the OTLP path rather than a caption.

## Next, in value order

1. **App cloud-egress DLP proof on a scratch cloud-permitted pipeline** — the one remaining unproven seam
   in the entry above. Never by loosening a live tenant's routing.
2. **Exporter-failure state per run** — so a missing trace is distinguishable from a failed export.
3. **Vector index — payload-index lifecycle** (create/drop Qdrant payload indexes). Real query-performance
   headroom we own the adapter for.
4. **Redpanda / LanceDB / Feature Flags / Device Management** — adapters exist, no end-to-end proof on the
   deployment. Each is a drill, not a build.

## The pattern across all of this

Three of the four things touched today were **not** missing features. Presidio's "add a language setting"
would have broken PII protection; the cloud-egress entry understated coverage by 21 events; the persistence
gap was a silent `catch`. The map's `gap` text is a hypothesis written at audit time, and the work is to
measure it before building to it — twice today that measurement inverted the prescription.
