# Service capability expansion status

This is the resume-safe execution ledger for the 48-entry service capability map. Read it before
starting service discovery. Update it after every committed audit or UI projection. Detailed
capability facts remain owned by `src/lib/service-capability-map.ts` and its family registries; this
file records progress and handoffs without creating a second capability denominator or implying a
live deployment.

## Current checkpoint

| Field                       | State                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------- |
| Updated                     | 2026-07-23                                                                            |
| Release branch              | `main`                                                                                |
| Registry checkpoint         | Cloud-egress DLP live proof captured from deployed `c5e8e01e1852da63a7094ca99745fb0830af7710` |
| Logical inventory           | 48 entries: 42 platform services + 6 enterprise sources                               |
| Versioned capability audits | 39 records: 24 current, 15 stale                                                      |
| Audited denominator         | 171 capability items / 684 four-gate assessments                                      |
| Audit backlog               | 9 entries have no versioned denominator yet                                           |
| Readiness evidence          | Live-probed per request; not frozen into this source ledger                            |
| Live verification           | S1 exact-SHA releases retain cloud-egress and receipt-correlated outcome proof         |

`not-audited` is an honest state, not 0% capability. A service moves to `current` only after its
pinned upstream denominator and all four gates have evidence. A mutable tag must remain explicit.

### Live cloud-egress DLP verification — `c5e8e01e1852da63a7094ca99745fb0830af7710`

S1 served the exact stamped Console SHA with `BUILD_ID=offgrid-onprem`, one `admin`-owned listener on
`:3000`, and HTTP 200 on `/signin`. An authorized, temporary Bharat Union chat submitted synthetic PAN
`ABCDE1234F` and a synthetic email on the default `public` data class. Routing selected the configured
cloud provider model `compat:openai/gpt-4o-mini`. The provider-produced answer contained only
`PAN: [REDACTED]` and `Email: [REDACTED_EMAIL_ADDRESS_3]`; the raw values remained confined to the
local user bubble. The tenant-scoped `/governance/egress` ledger retained two
`gateway.egress.dlp` decisions for `org_bharat`, both `masked` / `redacted`, with the same cloud model.

The live capability map reported the canonical **48 entries, 24 current audits, 15 stale audits, and
9 pending audits**. Cloud-egress DLP is now workflow-verified for the chat cloud-model seam. Its
integration gate remains `partial` because agent/app model calls, cloud tools, and outbound sinks do
not yet share this final DLP boundary. Evidence is retained in
`docs/screenshots/capabilities/egress-dlp-cloud-response-c5e8e01e.png` and
`docs/screenshots/capabilities/egress-dlp-ledger-c5e8e01e-wide.png`.

### Retrieval and lineage evidence-spine delta

This source checkpoint closes the narrow correlation blind spot without promoting any live gate.
The governed agent path now persists the selected retrieval provider, Qdrant collection, search
mode, tenant/metadata/ACL filter shape, and the OpenLineage adapter delivery outcome against the
canonical agent-run id. Marquez distinguishes `accepted`, `rejected`, `unreachable`, and
`not-configured`; a non-2xx response can no longer be reported as delivered.

| Evidence slice                         | Source state | Retained source proof            | Still required before live verification                                                                 |
| -------------------------------------- | ------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Qdrant provider/filter correlation     | code-wired   | `1eef2699`, `002d9c18`           | Run each flagship journey with Qdrant selected and retain the persisted run step plus matching query.   |
| Marquez delivery receipt/failure state | code-wired   | `ced84501`, `002d9c18`           | Retain one accepted delivery and one controlled rejection/unreachable result for each flagship family. |

No Qdrant or Marquez A/I/UI/W gate changes at this checkpoint: focused tests and typecheck prove
the code contract, not the selected live deployment or a completed BFSI workflow.

### Governed Action Plane live-verified delta

The first bounded Action Plane slice is live on Console `16fa96443c79`. App authors can
select one of three catalogued CRM mutations, bind an approved internal CRM connection and a prior
Human review step, complete purpose-specific fields, and see a plain-language impact preview. The
runtime requires the exact approved human ancestor, derives the replay key from the run and step,
intercepts all mutations in shadow mode, delegates live execution to the existing tenant-scoped CRM
task/opportunity adapters, and retains the reviewer decision, impact, changed resource, and signed
provider receipt on the run.

| Evidence slice                    | State         | Retained proof                                                                 | Remaining breadth                                                                                       |
| --------------------------------- | ------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Action catalogue and builder      | live-verified | Wide 1600px visual QA, zero horizontal overflow, explicit narrow-screen handoff | Retain the same usability bar as new action families are added.                                         |
| Approval, shadow, and CRM runtime | live-verified | `apprun_5e715894`, `apprun_71da60a4`, Console `16fa96443c79`                    | Add typed pagination, incremental sync, rate-limit handling, webhooks, and broader audited CRM CRUD.    |

The live bank journey paused at `rm-review`, retained `service@offgrid.local` as the authenticated
reviewer, changed CRM task count exactly `0→1`, and persisted an on-prem impact plus signed provider
receipt. Repeating approval returned `409`; replaying the same provider command returned `200` with
`x-idempotent-replay: true`, leaving the count at `1`. Shadow run `apprun_71da60a4` completed with no
receipt and no CRM mutation. `enterprise-source-crm/write-sync-webhooks` is therefore `N/P/P/P`:
the stale mutable source identity keeps Available at `no`, while the broad pagination/sync/webhook
denominator remains only partially integrated, exposed, and used.

### Outcome Observation Plane live-verified delta — `f5338085e2ae86e0018a645187cbe02791aeab26`

S1 served the exact Console SHA through the Console-only release scope with one listener and HTTP 200
on `/signin`. Backup `/Users/admin/offgrid/backups/20260723-000547/console.sql.gz` (6,273,842 bytes,
gzip-valid) was verified before migration
`0012` (`43694143dadeabcf036391ff9ea0ccce02e5bffa59f4a4e82543904cd969ecd9`); the deployed database
reported the 22-column observation table, 10 validated constraints, and six indexes. The server
resolves the canonical receipt from the active tenant's App run, so browser input cannot supply or
replace receipt identity.

| Evidence slice                        | State         | Retained proof | Remaining breadth |
| ------------------------------------- | ------------- | -------------- | ----------------- |
| Contract and evidence lifecycle       | live-verified | `org_bharat/app_d07ab6a9/apprun_5e715894/create-follow-up`, canonical receipt `action:40ebe5a69ca94a8e461e0a129314e8fbe2c2ce57a1f55957012a5561c66de279`; all four snapshots matched byte-for-byte and App/run foreign keys remained `RESTRICT` | Automate governed system/import capture. |
| Nontechnical run-to-result journey    | live-verified | Accepted HTTP 201 `aout_f0092c463fcb4a289afd`; converted HTTP 201 `aout_b87f8c14147a4f3399f6` with INR 10,000 baseline and INR 25,000 result. Exact candidate passed create → detail → Back at 1600×1000 and 768×1024 without horizontal overflow; 390×844 showed the intended larger-screen handoff without overflow. | Add portfolio baseline-versus-result reporting. |
| Audit retention and replay guarantees | live-verified | Replay returned HTTP 200, `replayed:true`, and the same accepted id; correction `aout_a0311b31bdf14dc79eaa` changed accepted → rejected, while withdrawal `aout_c65fa282e33045be948b` terminated the converted fact. Four rows remain, with no duplicate source keys. Cross-tenant detail returned 404 and App deletion with evidence returned 409. | Extend the lifecycle to additional enterprise action families. |

This live Outcome slice does not inflate the broader capability denominator. The canonical
`enterprise-source-crm/write-sync-webhooks` item stays `N/P/P/P`: the source identity is still
mutable, while automatic CRM/system ingestion, portfolio reporting, pagination, incremental sync,
rate-limit handling, webhooks, and broader CRM CRUD remain partial or absent.

### Enterprise Context and Catalogue-driven Builder live-verified delta — `df60a318847b7669296e428f0ecfa22b96b1bba1`

The Builder now consumes one tenant-safe Enterprise Context and Permission Resolver contract across
guided creation, saved-App editing, conversational Forge, data/tool/pipeline/action pickers, compile
preview, and POST/PATCH/publish validation. Hidden cross-tenant resources are omitted; unavailable or
denied resources remain non-selectable; approval-required resources stay visible with the approval
step; saved choices that later become unavailable remain visible and removable instead of trapping
the operator.

| Evidence slice | State | Retained proof | Remaining boundary |
| --- | --- | --- | --- |
| Resolver contract and tenant envelope | live-verified | Bharat returned 53 visible resources: 45 ready, four approval-required, three unavailable and one denied; source retains pure projection, real Postgres route, failed-slice and `private,no-store` tests | Extend the same contract to later Builder-owned surfaces |
| Nontechnical catalogue experience | live-verified | Authenticated 1600×1000 describe → compile → pipeline select → save → detail showed zero horizontal overflow; local 768×1024 and 390×844 checks retained the responsive and intentional handoff evidence | Conversational Forge needs an explicit pipeline picker when an org has zero or multiple eligible pipelines |
| Compile and persistence enforcement | live-verified | KYC compiled with zero gaps, bound declared `customers` data, selected resolver-ready `KYC Verification`, and retained `pl_seed_org_bharat_kyc-verification` on API and browser read-back; both QA Apps were deleted (`204`, then `404`) | Keep new write surfaces on the same server validation seam |

The browser adversarial pass caught and closed a misleading default before release: an unbound App
was previously labelled as using the org default. New Apps now bind the sole eligible pipeline
explicitly; a genuinely unbound choice is labelled **No pipeline (unbound)**. This first-party plane
does not alter the 171 upstream capability denominator.

### LLM Guard 0.3.16 audit delta

`llm-guard` now has a seven-item, version-matched denominator pinned to upstream tag
`32b14a4a2fa398df8b77fd748ee4bd387a4ac5ce` and fleet record
`bc74d828e02db7566b32191650cb58360f9178ae`. The upstream repository explicitly states that the
project and associated models are archived and no longer maintained. The fleet's two-shard design
is an Off Grid runtime extension, not an upstream capability.

The audit also corrects a material coverage claim: stock `0.3.16` loads scanners from static YAML
and permits `scanners_suppress` per request; its request schema has no `scanners` configuration
field. Therefore the Console's per-request India recognizer/scanner object is ignored by the
upstream shards. Live email/secret redaction and the four configured g6 classifiers remain real;
per-card policy lifecycle, India recognizer injection, output-specific scanning, optional-shard
degradation visibility, and upstream telemetry remain partial or absent. No live gate was inferred
from source tests.

Replacement implications are release work, not a documentation footnote. Before continued use,
retain the selected image digest, SBOM, Python dependency lock, and scanner-model hashes; isolate the
service and own vulnerability triage because upstream will not ship fixes. A maintained replacement
must stay behind the existing guardrail port, implement distinct prompt and output contracts, expose
degradation and telemetry, and dual-run the bank/insurance adversarial plus redaction corpus before
cutover. Until that evidence exists, the Console must not claim current upstream security coverage.

## Evidence roll-up

These totals are calculated from the 171 versioned capability records currently owned by the two
canonical family registries. `yes`, `partial`, and `no` describe retained audit evidence—not fleet
health. Stale audits are deliberately normalized so their Available gate cannot be treated as
current. A `no` therefore means "not currently evidenced against the pinned denominator", not
necessarily "the upstream product can never do this".

| Gate                          |     Yes | Partial |      No |   Total |
| ----------------------------- | ------: | ------: | ------: | ------: |
| Available                     |     120 |       0 |      51 |     171 |
| Integrated                    |      93 |      58 |      20 |     171 |
| UI exposed                    |      98 |      50 |      23 |     171 |
| Used in a production workflow |      72 |      47 |      52 |     171 |
| **All four gates**            | **383** | **155** | **146** | **684** |

Readiness is a separate live projection derived from service probes and retained workflow evidence.
It is intentionally recomputed by the capability-map request rather than copied into this ledger.
Optional-service fallbacks, indirect forwarders, seeds, images, or a successful ping do not upgrade
readiness on their own.

## Active lanes

| Lane                                                        | Owner                          | File ownership                                                                | State                | Required handoff                                    |
| ----------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- | -------------------- | --------------------------------------------------- |
| Inventory and UI projection                                 | `capability_map_navigation`    | Capability-map page/component and focused UI tests                            | Live checked at `09b508bf`; narrow Quality Runs blocker recorded | Re-run after UI fix and deployment |
| Runtime, governance, operations                             | `capability_audit_runtime_ops` | `src/lib/service-capabilities/runtime-governance-operations.ts` and its tests | Committed `5fdf5670` | 14 audited, 10 pending; LLM Guard EOL and integration gaps pinned |
| Data, streaming, observability, quality, enterprise sources | `ai_qa_operator_loop`          | `src/lib/service-capabilities/data-quality-observability.ts` and its tests    | Committed `64bd00e5` | 24 audited; live attribution gaps retained          |
| Registry integration and release                            | Root                           | Shared registry projection, this tracker, build, deploy, live verification    | In progress          | Build and verify one immutable release              |

## Per-service ledger

The lane is the work owner. `current` and `stale` reflect the existing versioned audit registry.
`in-progress` means an assigned worker is gathering evidence; it does not imply any gate passed.

| Family            | Service ID                      | Audit state          | Lane                          |
| ----------------- | ------------------------------- | -------------------- | ----------------------------- |
| Data              | `postgres`                      | current              | data/quality                  |
| Data              | `qdrant`                        | current              | data/quality                  |
| Data              | `marquez`                       | current              | data/quality                  |
| Data              | `lancedb`                       | current              | data/quality                  |
| Data              | `seaweedfs`                     | current              | data/quality                  |
| Data              | `warehouse`                     | stale                | data/quality                  |
| Data              | `airbyte`                       | current              | data/quality                  |
| Data              | `streaming`                     | current              | data/quality                  |
| Data              | `data-quality`                  | current              | data/quality                  |
| Data              | `kestra`                        | stale                | data/quality                  |
| Runtime           | `gateway`                       | stale                | runtime/governance/operations |
| Runtime           | `litellm`                       | current, mutable tag | runtime/governance/operations |
| Runtime           | `temporal`                      | stale                | runtime/governance/operations |
| Runtime           | `gateway-control`               | pending              | runtime/governance/operations |
| Runtime           | `agent-worker`                  | pending              | runtime/governance/operations |
| Runtime           | `app-worker`                    | current              | runtime/governance/operations |
| Runtime           | `chat-worker`                   | pending              | runtime/governance/operations |
| Governance        | `llm-guard`                     | current audit; archived upstream; mutable image | runtime/governance/operations |
| Governance        | `keycloak`                      | stale                | runtime/governance/operations |
| Governance        | `opa`                           | stale                | runtime/governance/operations |
| Governance        | `openbao`                       | stale                | runtime/governance/operations |
| Governance        | `unleash`                       | stale                | runtime/governance/operations |
| Governance        | `presidio`                      | current              | runtime/governance/operations |
| Observability     | `opensearch`                    | current              | data/quality                  |
| Observability     | `langfuse`                      | current              | data/quality                  |
| Observability     | `evidently`                     | current              | data/quality                  |
| Observability     | `ragas`                         | current              | data/quality                  |
| Observability     | `victoriametrics`               | current              | data/quality                  |
| Observability     | `victorialogs`                  | current              | data/quality                  |
| Observability     | `otel-collector`                | stale                | data/quality                  |
| Observability     | `jaeger`                        | current              | data/quality                  |
| Operations        | `console`                       | stale                | runtime/governance/operations |
| Operations        | `edge-gateway`                  | current              | runtime/governance/operations |
| Operations        | `redis`                         | stale                | runtime/governance/operations |
| Operations        | `superset`                      | stale                | runtime/governance/operations |
| Operations        | `fleetdm`                       | stale                | runtime/governance/operations |
| Operations        | `cloudflared`                   | pending              | runtime/governance/operations |
| Operations        | `landing`                       | pending              | runtime/governance/operations |
| Operations        | `status-page`                   | pending              | runtime/governance/operations |
| Operations        | `litellm-forwarder`             | pending              | runtime/governance/operations |
| Operations        | `observability-forwarder`       | pending              | runtime/governance/operations |
| Operations        | `fleet-forwarder`               | pending              | runtime/governance/operations |
| Enterprise source | `enterprise-source-corebank`    | stale                | data/quality                  |
| Enterprise source | `enterprise-source-policyadmin` | stale                | data/quality                  |
| Enterprise source | `enterprise-source-erp`         | stale                | data/quality                  |
| Enterprise source | `enterprise-source-kafka`       | current              | data/quality                  |
| Enterprise source | `enterprise-source-minio`       | current              | data/quality                  |
| Enterprise source | `enterprise-source-crm`         | stale                | data/quality                  |

## Pending audit actions

Each pending service remains `not-audited` until the action below produces a pinned denominator and
item-level four-gate evidence. Existing code paths, configuration, or indirect downstream success are
useful discovery evidence but do not satisfy that contract.

| Service                   | Next resumable action                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway-control`         | Pin the first-party control contract to an immutable release, enumerate node/model actions, and retain one reversible enable/disable/restart or model-switch lifecycle with audit and rollback evidence. |
| `agent-worker`            | Stamp the worker artifact, register its Temporal queue/poller/heartbeat topology, audit the agent execution contract, and retain a durable governed run plus safe drain/restart evidence.                |
| `chat-worker`             | Stamp and audit the `offgrid-chat` worker, then retain one governed chat correlated across guardrail, citation, lineage, provenance, and audit evidence.                                                 |
| `cloudflared`             | Record the binary version and live-config checksum, remove duplicate/stale job ambiguity, prove one authoritative replica, and expose per-route readiness and restart evidence.                          |
| `landing`                 | Bind the public process to a repo-owned launch definition and immutable SHA, define the first-party landing denominator, and verify the complete CTA journey visually and functionally.                  |
| `status-page`             | Bind the status process to exact source/version, define freshness and dependency semantics, and verify that an operator can move from a reported problem to the owning management surface.               |
| `litellm-forwarder`       | Replace the unversioned/DHCP-bound forwarding job with a repo-owned, pinned Bonjour route and retain direct, negative, restart, and downstream-completion evidence.                                      |
| `observability-forwarder` | Repo-own and pin each logs/traces forwarding route, probe them independently, and retain outage/reconnect evidence instead of inferring the forwarder from downstream availability.                      |
| `fleet-forwarder`         | Stamp the bridge source and runtime version, derive routes from the canonical fleet registry, expose route-level dependencies, and verify target loss, reconnect, and restart.                           |

## Stale audit re-verification recipe

### Common execution spine re-verification

The first ordered re-verification pass retained all three common-spine audits as `stale`. Functional
or reachability evidence was not promoted into immutable version evidence:

| Service    | Exact retained evidence                                                                 | Blocking automation/evidence gap                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway    | Historical source release and current authenticated model/routing probes                | `push.sh` does not restart the aggregator; capture a repo-owned launch manifest plus running script checksum, expected source SHA, PID start time, and restart evidence in `recover.sh`. |
| OPA        | Fleet manifest tag, loopback-only bind, policy adapter code, and generic governed denial | Lock and verify the live container Image ID/RepoDigest, assert `OFFGRID_ADAPTER_POLICY=opa`, and correlate direct OPA allow/deny responses with Console decision records.                |
| Temporal   | Fleet manifest tags and C4 `202 + workflowId` durable-dispatch proof                     | Lock and verify live Server/UI Image IDs and RepoDigests; the successful workflow proves dispatch, not which server artifacts executed it.                                              |

OPA integration and workflow coverage was reduced where the retained denial could have come from
the first-party ABAC fallback. Gateway request-governance coverage was reduced where separate guard
and gateway records lacked one correlated request. These are evidence corrections, not reported
outages.

The 17 stale records are `warehouse`, `kestra`, `gateway`, `temporal`, `keycloak`, `opa`, `openbao`,
`unleash`, `otel-collector`, `console`, `redis`, `superset`, `fleetdm`,
`enterprise-source-corebank`, `enterprise-source-policyadmin`, `enterprise-source-erp`, and
`enterprise-source-crm`.

For each stale record:

1. Resolve the immutable version actually selected by the deployment system of record. A mutable tag,
   package range, image presence, or remembered version is insufficient.
2. Re-enumerate the relevant operator-outcome denominator from primary version-matched documentation;
   retain the denominator source in the canonical family registry.
3. Reassess every capability independently across Available, Integrated, UI exposed, and Used in a
   workflow. Preserve `partial` and intentional non-support; never copy the prior verdict forward.
4. Trace every claimed integration from the canonical URL/action through its adapter and authenticated,
   tenant-safe boundary. A status card or health request is not management integration.
5. Exercise the real path in a relevant bank or insurance journey and retain correlated evidence. If
   the workflow is destructive or currently unsafe, record the explicit skip and required fixture.
6. Update `auditedAt`, version, audit state, recency evidence, gaps, and tests; only then run the shared
   release gates and change the record from `stale` to `current`.

## Prioritized release gaps

| Priority | Gap                                                                                                                 | Release acceptance                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Ten services have no pinned capability denominator.                                                                 | Complete the pending actions above without converting `not-audited` into a percentage.                                                                                  |
| P0       | Seventeen audits are stale.                                                                                         | Apply the re-verification recipe against immutable selected versions; stale upstream gates remain unavailable until then.                                               |
| P0       | Readiness is 47 unverified and 1 partial.                                                                           | Supply signed/timestamped topology evidence for deployment, reachability, functional behavior, seed state, and Console use; do not infer it from optional fallbacks.    |
| P1       | Only 67/164 capabilities are fully integrated, 83/164 are fully UI-exposed, and 40/164 have full workflow evidence. | Prioritize outcome-bearing paths; close partial/error/lifecycle/tenancy gaps before adding decorative breadth.                                                          |
| P1       | The capability map is an exhaustive ledger but still costly to scan and scroll.                                     | Add URL-driven family/service local navigation, sticky summary/filter context, progressive disclosure, and direct gap-to-management links while retaining all evidence. |
| P1       | Workflow evidence is not yet organized as repeatable BFSI proof.                                                    | Retain deterministic indemnity, delinquency, and cross-sell journeys with before/after operational and financial measures.                                              |
| P2       | Capability breadth can be mistaken for customer value.                                                              | Publish intentional non-support and replacement rationale; product dashboards lead with outcomes, active work, exceptions, next actions, and proof—not service names.   |

## Usable, consumable, sellable priorities

The product is an enterprise AI control plane, not a gallery of upstream tools. Capability expansion
is valuable only when an operator can use it safely, understand it quickly, and justify it against a
material business outcome.

The exact must-have capability IDs and ordered delivery plan live in
[`FLAGSHIP_CAPABILITY_CLOSURE.md`](FLAGSHIP_CAPABILITY_CLOSURE.md).

| Outcome journey     | Usable                                                                                                                                                                                                | Consumable                                                                                                                                                                     | Sellable proof                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Insurance indemnity | A governed FNOL-to-decision workflow reads policy/claim evidence, detects fraud and leakage, applies human authority limits, records lineage, and can be corrected or resumed.                        | An insurance landing shows claim volume, exceptions, decisions awaiting people, leakage risk, cycle time, and the next action; technical services stay in drill-down evidence. | Baseline vs achieved claims/day, straight-through rate, cycle time, leakage avoided, indemnity accuracy, cost per claim, and same-workforce capacity.       |
| Lending delinquency | A tenant-safe early-warning and collections workflow identifies risk, prioritizes accounts, recommends compliant action, records contact/decision evidence, and supports human overrides.             | A lender landing groups queues by risk and urgency, explains why an account is prioritized, and links directly to action, evidence, policy, and outcome history.               | Roll-rate reduction, cure rate, days delinquent, promise-to-pay kept, collector cases/day, loss avoided, and cost per resolved account.                     |
| Banking cross-sell  | A governed customer-360/next-best-action workflow uses permitted holdings and eligibility data, produces a cited recommendation, respects contact/policy constraints, and records acceptance/outcome. | An RM landing leads with opportunity, eligibility, confidence, required review, customer context, and next action—not pipelines, models, or connector internals.               | Incremental conversion/revenue, RM book coverage, time-to-recommendation, offers reviewed per person, acceptance rate, and compliance exceptions prevented. |

Across all three journeys, the release order is: make the complete action path **usable**; organize it
around a role and decision so it is **consumable**; then attach auditable baseline, outcome, cost, and
capacity evidence so it is **sellable**. Seeds and screenshots are fixtures, not ROI proof.

## Release gates

- [x] All 48 entries are represented by the canonical source projection.
- [x] Enterprise-source selected-state projection is repaired and independently verified in focused tests.
- [x] Family, owner, audit-state, readiness, and text filters live in the URL/history stack.
- [ ] Every selected service shows deployment, routes, readiness evidence, workflow evidence, gaps,
      and next action even when its capability denominator is not audited.
- [x] Versioned family records are integrated into the canonical registry without duplicated facts.
- [x] Focused capability logic/integration tests pass (24/24 at `5fdf5670`); prior navigation proof remains retained at `7f4f8d61`.
- [ ] Typecheck and one exclusive production build pass.
- [ ] Wide and narrow light/dark screenshots are readable with no page-level overflow.
- [ ] Exact SHA is pushed and deployed over SSH.
- [ ] Both bank and insurance tenants are verified live.
- [ ] Fleet verification records the 48-entry inventory, eight nodes, service health, and seeded BFSI
      workflow evidence in `onprem-fleet-orchestration`.

## Required worker handoff

Every worker reports this block and the integration owner applies it here before the lane is closed:

```text
Lane:
Owned files:
Commit SHA:
Service IDs covered:
Available / Integrated / UI exposed / Used:
Version sources:
Real workflow evidence:
Known gaps:
Not verified:
Next resumable action:
```
