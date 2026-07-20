# Service capability expansion status

This is the resume-safe execution ledger for the 48-entry service capability map. Read it before
starting service discovery. Update it after every committed audit or UI projection. Detailed
capability facts remain owned by `src/lib/service-capability-map.ts` and its family registries; this
file records progress and handoffs without creating a second capability denominator or implying a
live deployment.

## Current checkpoint

| Field                        | State                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------- |
| Updated                      | 2026-07-20                                                                    |
| Release branch               | `codex/modernize-console-sidebar`                                             |
| Registry checkpoint          | Source snapshot through `58abc71e`; this is not a deployed-SHA assertion      |
| Logical inventory            | 48 entries: 42 platform services + 6 enterprise sources                       |
| Versioned capability audits  | 37 records: 20 current, 17 stale                                              |
| Audited denominator          | 157 capability items / 628 four-gate assessments                              |
| Audit backlog                | 11 entries have no versioned denominator yet                                  |
| Readiness evidence           | 47 `unverified`, 1 `partial`; no entry is release-verified by this checkpoint |
| Enterprise-source projection | Repaired in `7f4f8d61`; live UI confirmation remains outstanding              |
| Live verification            | Not asserted by this ledger                                                   |

`not-audited` is an honest state, not 0% capability. A service moves to `current` only after its
pinned upstream denominator and all four gates have evidence. A mutable tag must remain explicit.

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

## Evidence roll-up

These totals are calculated from the 157 versioned capability records currently owned by the two
canonical family registries. `yes`, `partial`, and `no` describe retained audit evidence—not fleet
health. Stale audits are deliberately normalized so their Available gate cannot be treated as
current. A `no` therefore means "not currently evidenced against the pinned denominator", not
necessarily "the upstream product can never do this".

| Gate                          |     Yes | Partial |      No |   Total |
| ----------------------------- | ------: | ------: | ------: | ------: |
| Available                     |     100 |       0 |      57 |     157 |
| Integrated                    |      65 |      65 |      27 |     157 |
| UI exposed                    |      82 |      46 |      29 |     157 |
| Used in a production workflow |      40 |      44 |      73 |     157 |
| **All four gates**            | **287** | **155** | **186** | **628** |

Readiness is a separate projection. At this checkpoint, 47 inventory entries have no sufficient
runtime topology evidence and one has only partial evidence. This is an evidence-state result, not a
claim that 47 processes are down or that one process is healthy. Optional-service fallbacks, indirect
forwarders, seeds, images, or a successful ping do not upgrade readiness.

## Active lanes

| Lane                                                        | Owner                          | File ownership                                                                | State                | Required handoff                                    |
| ----------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- | -------------------- | --------------------------------------------------- |
| Inventory and UI projection                                 | `capability_map_navigation`    | Capability-map page/component and focused UI tests                            | Committed `7f4f8d61` | Visual and live verification pending                |
| Runtime, governance, operations                             | `capability_audit_runtime_ops` | `src/lib/service-capabilities/runtime-governance-operations.ts` and its tests | Committed `58abc71e` | 13 audited, 11 pending; Gateway/OPA/Temporal identity gaps pinned |
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
| Governance        | `llm-guard`                     | pending              | runtime/governance/operations |
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
| Operations        | `edge-gateway`                  | pending              | runtime/governance/operations |
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
| `llm-guard`               | Audit the pinned `0.3.16` API/scanner denominator item by item, distinguish upstream scanners from first-party sharding, and record the archived/EOL replacement risk.                                   |
| `edge-gateway`            | Record the exact Caddy build and module list, enumerate the bounded Caddy/Coraza/rate-limit/file-routing denominator, and prove policy, rejection, file, and recovery paths.                             |
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
| P0       | Eleven services have no pinned capability denominator.                                                              | Complete the pending actions above without converting `not-audited` into a percentage.                                                                                  |
| P0       | Seventeen audits are stale.                                                                                         | Apply the re-verification recipe against immutable selected versions; stale upstream gates remain unavailable until then.                                               |
| P0       | Readiness is 47 unverified and 1 partial.                                                                           | Supply signed/timestamped topology evidence for deployment, reachability, functional behavior, seed state, and Console use; do not infer it from optional fallbacks.    |
| P1       | Only 65/157 capabilities are fully integrated, 82/157 are fully UI-exposed, and 40/157 have full workflow evidence. | Prioritize outcome-bearing paths; close partial/error/lifecycle/tenancy gaps before adding decorative breadth.                                                          |
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
- [x] Focused logic and navigation tests pass (34/34 at `7f4f8d61`).
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
