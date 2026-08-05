# Live proof — governed object read AND write through a product workflow

**Date:** 2026-08-05 · **Box:** on-prem console (S1) · **Tenant:** `org_suraksha` (Suraksha Life)
**Store:** SeaweedFS S3 · **Bucket:** `suraksha-claim-lake` · **Pipeline:** `…fraud-screening`

The capability row asked for "an S3 connector port with bucket/key scoping, streaming limits,
provenance, and real read/write evidence". Two of the three gates on it were **stale**: they claimed
S3 was coming-soon with no dialect and that connector creation was disabled. Both were false — the
port, the dialect and the create form all existed. What genuinely did not exist was the WRITE half.

## 1. The read half already worked — and the scope is real

`queryGovernedObjectSource` against a domain scoped to `suraksha-claim-lake/intimations`:

```json
{"key":"CLM-2026-88431.json","size":110,
 "content":"{\"claimId\":\"CLM-2026-88431\",\"policyNo\":\"SL-LIFE-4471902\",…}",
 "provenance":{"connectorId":"con_1b29a2","domainId":"dom_f5754016-bfe",
   "bucket":"suraksha-claim-lake","key":"intimations/CLM-2026-88431.json",
   "etag":"06f03c…","sha256":"70d535f1b930588f9f1fb27f5814d537e15b2afb343db83fe2dd1542776e2f58"}}
```

Per-object `etag` + `sha256`, so what a run read is reproducible. Three negatives, all refused:

| Attempt | Result |
| --- | --- |
| Payroll-scoped domain reading the same bucket | sees only `payroll/` — one object, not the claims |
| Claims scope asking for `../payroll/salaries-2026.csv` | `scope-denied` — "Object key must stay inside the approved prefix." |
| `org_bharat` reading `org_suraksha`'s source | `unknown-source` — not "denied", *not found* |

## 2. A registered app consumes it — the workflow gate

An app with a `connector-query` step bound to the domain. First run **failed**, correctly:

```
data access denied by pipeline: "dom_f5754016-bfe" is OUTSIDE the pipeline data allowlist
  (hard ceiling) — denied
```

After a pipeline owner approved the domain, `apprun_cd297a95` → `done`:

```
Claim intimations (lake) (suraksha-claim-lake/intimations): 2 row(s).
refs: ["con_1b29a2:suraksha-claim-lake/intimations"]
```

## 3. The write half — new, and deliberately not configurable

Every other sink names its own destination. An object store cannot work that way: the connector's
keypair usually reaches the whole store, so a bucket taken from step config would let anyone who can
edit an app write anywhere that keypair reaches — **including over the app's own source data**. So the
step names a DATA DOMAIN and a bare file name, and the bucket and prefix come from the domain binding.

An app that reads `intimations/` and writes to a *separate* `assessments/` domain, run `apprun_f7c36c00`:

```
sink: lake — saved to Claim assessments (lake) as
  assessments/assessment-apprun_f7c36c00.json (PII masked before send); receipt retained
```

The object is really there. Masking is not incidental: an object PERSISTS, and whatever PII lands in
it is read by every later consumer of that bucket.

## 4. THE HOLE THIS PROOF FOUND — the ceiling gated reads but not writes

With the sink first wired, a run whose output domain had been **revoked** from the pipeline's
allowlist still wrote the object. The read path was ceiling-checked; the write path was not, so the
new sink was a way *out* of the hard ceiling — an app could be edited to write into a domain its
pipeline was never approved for.

Fixed in `deliverGovernedSink`, through the same `enforceDataAccess` and the same domain matcher the
read uses, so the two cannot drift. Proven in **both** directions afterwards:

| Ceiling | Run | Result |
| --- | --- | --- |
| revoked | `apprun_eee51b30` | `error` — `save denied by pipeline: "dom_e633d22e-348" is OUTSIDE the pipeline data allowlist (hard ceiling) — denied`; **no object written** |
| approved | `apprun_f7c36c00` | `done` — object written, receipt retained |

A passing unit test would not have found this. The check that mattered was asking "what happens if I
take the permission away?" — and the first answer was: nothing.

## Reproducing

An `s3` connector (endpoint + keypair, via Data → Connectors), a data domain whose resource is
`bucket/prefix`, and that domain on the pipeline's data allowlist. Then a `connector-query` step to
read, and an `output` step with `sink: lake`, `config.domain`, `config.filename`.
