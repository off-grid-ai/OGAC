# Service capability expansion status

This is the resume-safe execution ledger for the 49-entry service capability map. Read it before
starting service discovery. Update it after every committed audit or UI projection. Detailed
capability facts remain owned by `src/lib/service-capability-map.ts` and its family registries; this
file records progress and handoffs without creating a second capability denominator.

## Current checkpoint

| Field                       | State                                                        |
| --------------------------- | ------------------------------------------------------------ |
| Updated                     | 2026-07-20                                                   |
| Release branch              | `codex/modernize-console-sidebar`                            |
| Checkpoint SHA              | `e410f14c9098686e919003e7872d73c11b782470`                   |
| Logical inventory           | 49 entries: 43 platform services + 6 enterprise sources      |
| Inventory projection        | Wired in code; production deployment pending                 |
| Versioned capability audits | 5 records: 4 current, 1 stale                                |
| Audit backlog               | 44 entries have no versioned denominator yet                 |
| Capability-map navigation   | In progress: URL-driven family/filter/master-detail refactor |
| Live verification           | Not started for this checkpoint                              |

`not-audited` is an honest state, not 0% capability. A service moves to `current` only after its
pinned upstream denominator and all four gates have evidence. A mutable tag must remain explicit.

## Active lanes

| Lane                                                        | Owner                          | File ownership                                                                | State       | Required handoff                                                |
| ----------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------- |
| Inventory and UI projection                                 | `capability_map_navigation`    | Capability-map page/component and focused UI tests                            | In progress | URL states, screenshots, test evidence, commit SHA              |
| Runtime, governance, operations                             | `capability_audit_runtime_ops` | `src/lib/service-capabilities/runtime-governance-operations.ts` and its tests | In progress | Exact service IDs, versions, four-gate counts, gaps, commit SHA |
| Data, streaming, observability, quality, enterprise sources | `ai_qa_operator_loop`          | `src/lib/service-capabilities/data-quality-observability.ts` and its tests    | In progress | Exact service IDs, versions, four-gate counts, gaps, commit SHA |
| Registry integration and release                            | Root                           | Shared registry projection, this tracker, build, deploy, live verification    | In progress | Immutable deployed SHA and live fleet evidence                  |

## Per-service ledger

The lane is the work owner. `current` and `stale` reflect the existing versioned audit registry.
`in-progress` means an assigned worker is gathering evidence; it does not imply any gate passed.

| Family            | Service ID                      | Audit state          | Lane                          |
| ----------------- | ------------------------------- | -------------------- | ----------------------------- |
| Data              | `postgres`                      | in-progress          | data/quality                  |
| Data              | `qdrant`                        | in-progress          | data/quality                  |
| Data              | `marquez`                       | in-progress          | data/quality                  |
| Data              | `lancedb`                       | in-progress          | data/quality                  |
| Data              | `seaweedfs`                     | in-progress          | data/quality                  |
| Data              | `warehouse`                     | in-progress          | data/quality                  |
| Data              | `airbyte`                       | in-progress          | data/quality                  |
| Data              | `streaming`                     | current              | data/quality                  |
| Data              | `data-quality`                  | in-progress          | data/quality                  |
| Data              | `kestra`                        | in-progress          | data/quality                  |
| Runtime           | `gateway`                       | in-progress          | runtime/governance/operations |
| Runtime           | `litellm`                       | current, mutable tag | runtime/governance/operations |
| Runtime           | `temporal`                      | in-progress          | runtime/governance/operations |
| Runtime           | `gateway-control`               | in-progress          | runtime/governance/operations |
| Runtime           | `agent-worker`                  | in-progress          | runtime/governance/operations |
| Runtime           | `app-worker`                    | in-progress          | runtime/governance/operations |
| Runtime           | `chat-worker`                   | in-progress          | runtime/governance/operations |
| Governance        | `llm-guard`                     | in-progress          | runtime/governance/operations |
| Governance        | `keycloak`                      | in-progress          | runtime/governance/operations |
| Governance        | `opa`                           | in-progress          | runtime/governance/operations |
| Governance        | `openbao`                       | in-progress          | runtime/governance/operations |
| Governance        | `unleash`                       | in-progress          | runtime/governance/operations |
| Governance        | `presidio`                      | current              | runtime/governance/operations |
| Observability     | `opensearch`                    | in-progress          | data/quality                  |
| Observability     | `langfuse`                      | in-progress          | data/quality                  |
| Observability     | `evidently`                     | current              | data/quality                  |
| Observability     | `ragas`                         | in-progress          | data/quality                  |
| Observability     | `victoriametrics`               | in-progress          | data/quality                  |
| Observability     | `victorialogs`                  | in-progress          | data/quality                  |
| Observability     | `otel-collector`                | stale                | data/quality                  |
| Observability     | `jaeger`                        | in-progress          | data/quality                  |
| Operations        | `console`                       | in-progress          | runtime/governance/operations |
| Operations        | `edge-gateway`                  | in-progress          | runtime/governance/operations |
| Operations        | `provit`                        | in-progress          | runtime/governance/operations |
| Operations        | `redis`                         | in-progress          | runtime/governance/operations |
| Operations        | `superset`                      | in-progress          | runtime/governance/operations |
| Operations        | `fleetdm`                       | in-progress          | runtime/governance/operations |
| Operations        | `cloudflared`                   | in-progress          | runtime/governance/operations |
| Operations        | `landing`                       | in-progress          | runtime/governance/operations |
| Operations        | `status-page`                   | in-progress          | runtime/governance/operations |
| Operations        | `litellm-forwarder`             | in-progress          | runtime/governance/operations |
| Operations        | `observability-forwarder`       | in-progress          | runtime/governance/operations |
| Operations        | `fleet-forwarder`               | in-progress          | runtime/governance/operations |
| Enterprise source | `enterprise-source-corebank`    | in-progress          | data/quality                  |
| Enterprise source | `enterprise-source-policyadmin` | in-progress          | data/quality                  |
| Enterprise source | `enterprise-source-erp`         | in-progress          | data/quality                  |
| Enterprise source | `enterprise-source-kafka`       | in-progress          | data/quality                  |
| Enterprise source | `enterprise-source-minio`       | in-progress          | data/quality                  |
| Enterprise source | `enterprise-source-crm`         | in-progress          | data/quality                  |

## Release gates

- [ ] All 49 entries are visible and selectable in the capability-map UI.
- [ ] Family, owner, audit-state, readiness, and text filters live in the URL/history stack.
- [ ] Every selected service shows deployment, routes, readiness evidence, workflow evidence, gaps,
      and next action even when its capability denominator is not audited.
- [ ] Versioned family records are integrated into the canonical registry without duplicated facts.
- [ ] Focused logic and navigation tests pass.
- [ ] Typecheck and one exclusive production build pass.
- [ ] Wide and narrow light/dark screenshots are readable with no page-level overflow.
- [ ] Exact SHA is pushed and deployed over SSH.
- [ ] Both bank and insurance tenants are verified live.
- [ ] Fleet verification records the 49-entry inventory, eight nodes, service health, and seeded BFSI
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
