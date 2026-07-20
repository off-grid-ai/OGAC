# Flagship capability closure

This is the smallest evidence-backed closure plan for three flagship BFSI journeys: insurance
indemnity/FNOL, lender delinquency intervention, and bank cross-sell. It is derived from the 151
audited capability items and the product outcome in `docs/founder-freehand.md`: use the enterprise's
existing data and systems to make material work faster, better, or cheaper in a reliable, governed,
auditable environment.

This is not a live-deployment report. Gate states are the retained canonical audit state. `A/I/UI/W`
means Available / Integrated / UI exposed / Used in a workflow. For a stale audit, `A=N` means the
selected immutable deployment identity is not current—not that the capability is necessarily absent.

## Product-contract status (2026-07-20)

The catalog contract gap is closed in code without inflating proof:

- `lending-delinquency-intervention` now has an exact published App/pipeline seed over declared
  `loan accounts` and `repayment history` domains;
- `insurance-indemnity-fast-track` has an exact published App/pipeline seed over declared
  `claim documents` and `policies` domains; and
- `bank-rm-cross-sell` is a reusable outcome contract backed by an exact seeded runtime and a
  mandatory relationship-manager decision.

`adoptable` is now derived per tenant from the real published App graph, exact published pipeline,
hard data ceiling, required capabilities, and declared tenant domains. It is no longer granted by a
catalog checkbox. The three contracts still have `proof.status:unverified`: the runtime/action/evidence
gaps below remain release blockers for any production-proof claim.

## Minimum closure set

The minimum union is **12 audited capability items**, one unaudited runtime seam (`app-worker`), and
three first-party solution contracts. Fully evidenced foundations such as Presidio text protection,
Postgres storage, data-quality checkpoints, Jaeger trace inspection, and core streaming proof are not
relisted.

### Common governed execution spine

All three journeys require these seven audited items.

| Service / capability ID           | A/I/UI/W | Current evidence                                                                            | Blocking gap                                                                                     |
| --------------------------------- | :------: | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `gateway/authenticated-inference` | N/Y/Y/Y  | Credentialed adapter, Runtime UI, completion, and invalid-token evidence are retained.      | Re-pin and reverify the selected Gateway release.                                                |
| `gateway/request-governance`      | N/Y/Y/Y  | Policy, guardrail, credential, traffic, and audit paths exist; denial evidence is retained. | Re-pin and reverify the selected Gateway release.                                                |
| `opa/policy-decisions`            | N/Y/Y/Y  | Real policy adapter, decision UI, and governed-denial evidence exist.                       | Record the immutable selected OPA image and reverify.                                            |
| `temporal/durable-dispatch`       | N/Y/Y/Y  | App/agent/chat adapters, run UI, and durable-run evidence exist.                            | Record the selected Temporal digest and prove worker compatibility.                              |
| `qdrant/points-search`            | Y/Y/Y/P  | Real upsert/search adapter and retrieval UI exist.                                          | Retain provider, collection, and query correlation for the real journey.                         |
| `qdrant/payload-filtering`        | Y/P/P/P  | Organization/source filters are sent.                                                       | Complete selected-provider evidence, payload-index lifecycle, query planning, and management UI. |
| `marquez/openlineage-events`      | Y/Y/Y/P  | Event adapter and lineage graph exist.                                                      | Retain service-attributed run-event delivery and failure evidence for every flagship path.       |

`app-worker` has no canonical capability audit or item IDs. Its A/I/UI/W state is **unknown**, not
absent. Before release, its denominator must cover artifact identity, task queue/poller readiness,
governed step execution, human pause/resume, failure recovery, and output persistence.

### Workflow-specific data and action seams

| Workflow                   | Service / capability ID                     | A/I/UI/W | Current evidence                                                                             | Blocking gap                                                                                                           |
| -------------------------- | ------------------------------------------- | :------: | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Indemnity/FNOL             | `enterprise-source-policyadmin/sql-read`    | N/Y/Y/Y  | Bounded MySQL reads, Data Sources UI, and retained policy-operation evidence exist.          | Pin the mutable source and repeat schema/count/read evidence.                                                          |
| Indemnity/FNOL             | `enterprise-source-minio/object-read-write` | Y/N/P/N  | The pinned service provides S3 APIs; only source ontology is visible.                        | Implement governed bucket/key-scoped claim-document read/write with limits, provenance, and workflow proof.            |
| Delinquency and cross-sell | `enterprise-source-corebank/sql-read`       | N/Y/Y/Y  | Bounded PostgreSQL reads, Data Sources UI, and retained lender/claims lookup evidence exist. | Pin the mutable source and repeat schema/count/read evidence.                                                          |
| Delinquency and cross-sell | `enterprise-source-crm/rest-read`           | N/Y/Y/Y  | Bounded CRM reads, UI journeys, and retained customer/cross-sell lookup evidence exist.      | Pin the mutable source and repeat discovery/read evidence.                                                             |
| Delinquency and cross-sell | `enterprise-source-crm/write-sync-webhooks` | N/P/P/N  | Only bounded GET behavior is implemented and partly visible.                                 | Add typed pagination, governed writes, incremental state, rate-limit handling, and verified webhook/workflow evidence. |

## Insurance indemnity / FNOL

### Must-have

- The seven common-spine IDs.
- `enterprise-source-policyadmin/sql-read`.
- `enterprise-source-minio/object-read-write`.
- An audited `app-worker` human-review/resume seam.
- Retain live evidence that `insurance-indemnity-fast-track` resolves adoptable for the insurer
  tenant after the exact seed is applied; `proof.status` remains `unverified`.
- Add a governed claim-disposition/write-back contract. No item in the 151-capability denominator
  currently proves writing the decision into the policy/claims system. A report alone is decision
  support, not complete orchestration.

### Ordered implementation

1. Pin Policy Admin and implement the tenant-safe S3 claim-document connector.
2. Add idempotent claims decision/write-back with authority limits and audit evidence.
3. Audit/stamp `app-worker`; make the exact indemnity App, pipeline, and required domains adoptable.
4. Reverify Gateway, OPA, and Temporal against immutable selected versions.
5. Add Qdrant provider/filter correlation and per-run OpenLineage receipts/failure state.
6. Prove FNOL intake → policy/document checks → grounded recommendation → claims-officer decision →
   system write-back/report.
7. Attach actual claims/day, cycle-time, straight-through-rate, leakage, and cost evidence.

### Later breadth

- `presidio/image-redaction` (**Y/N/N/N**) for scanned/image claim evidence.
- Kafka-triggered claim events, advanced anonymizers, multilingual protection, ongoing drift
  monitoring, and automated recovery drills.

## Lender delinquency intervention

### Must-have

- The seven common-spine IDs.
- `enterprise-source-corebank/sql-read`.
- `enterprise-source-crm/rest-read` and `enterprise-source-crm/write-sync-webhooks`.
- An audited `app-worker` human-review/resume seam.
- Retain live evidence that `lending-delinquency-intervention` resolves adoptable for the bank
  tenant after the exact seed is applied; `proof.status` remains `unverified`.

### Ordered implementation

1. Pin Core Banking and CRM source identities.
2. Implement bounded CRM task/action write-back so intervention becomes work, not merely advice.
3. Bind the adoptable blueprint to loan-account and repayment-history domains and its exact pipeline.
4. Audit/stamp `app-worker`; reverify Gateway, OPA, and Temporal.
5. Add attributed collections-playbook retrieval and complete lineage delivery evidence.
6. Prove cohort selection → prioritization → compliant recommendation → human approval → CRM
   task/write-back → outcome observation.
7. Measure 30+ DPD roll rate, cure rate, promise-to-pay performance, collector capacity, and avoided
   loss.

### Later breadth

- `enterprise-source-kafka/source-produce-consume` (**Y/N/P/N**) for real-time events; the first
  flagship can use scheduled/batch detection.
- Incremental CDC, multichannel outreach, Evidently drift, and Ragas/Langfuse regression gates.

## Bank cross-sell

### Must-have

- The seven common-spine IDs.
- `enterprise-source-corebank/sql-read`.
- `enterprise-source-crm/rest-read` and `enterprise-source-crm/write-sync-webhooks`.
- An audited `app-worker` seam with an RM acceptance/rejection step to control mis-selling risk.
- Retain live evidence for the reusable `bank-rm-cross-sell` contract. Its App and pipeline remain
  seeded runtime fixtures; seeded run counts are not workflow or ROI proof.

### Ordered implementation

1. Define the exact data domains, eligibility constraints, RM decision, write-back, and outcome
   contract.
2. Pin Core Banking and CRM; implement CRM opportunity/task write-back.
3. Add the RM review step and audit/stamp `app-worker`.
4. Reverify Gateway, OPA, and Temporal; retain Qdrant product-rule attribution.
5. Retain lineage from holdings/product rules through recommendation, RM decision, and CRM outcome.
6. Prove customer context → eligible next-best action → cited rationale → RM acceptance/rejection →
   CRM update.
7. Measure conversion, incremental revenue, RM book coverage, recommendation time, and prevented
   compliance exceptions.

### Later breadth

- Privacy-first on-device opportunity signals where only derived intelligence reaches the enterprise.
- Streaming CRM events, experimentation/variants, LiteLLM failover, advanced personalization, and
  portfolio dashboards.

## Consolidated delivery order

1. **Product contracts (code complete):** apply the catalog/runtime seed and retain tenant-scoped
   adoptability evidence for indemnity, delinquency, and cross-sell.
2. **Action seams:** S3 claim documents, claims write-back, and CRM write-back.
3. **Runtime proof:** audit `app-worker`; pin/reverify Gateway, OPA, Temporal, and source identities.
4. **Evidence spine:** Qdrant provider/filter attribution and Marquez delivery receipts.
5. **Three tenant journeys:** real human decisions and system write-back, not seeded counters.
6. **ROI proof:** canonical run observations with baseline, outcome, cost, and capacity evidence.

This order makes each journey usable first, consumable through its business decision, and sellable
through justified ROI. Later breadth must not delay the minimum action-and-proof loop.
