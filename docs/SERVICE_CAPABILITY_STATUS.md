# Service capability expansion status

This is the resume-safe execution ledger for the 48-entry service capability map. Read it before
starting service discovery. Update it after every committed audit or UI projection. Detailed
capability facts remain owned by `src/lib/service-capability-map.ts` and its family registries; this
file records progress and handoffs without creating a second capability denominator.

## Current checkpoint

| Field                       | State                                                          |
| --------------------------- | -------------------------------------------------------------- |
| Updated                     | 2026-07-20                                                     |
| Release branch              | `codex/modernize-console-sidebar`                              |
| Checkpoint SHA              | integration worktree after `fb66086b`                          |
| Logical inventory           | 48 entries: 42 platform services + 6 enterprise sources        |
| Inventory projection        | 48-entry explorer wired in code; production deployment pending |
| Versioned capability audits | 36 records: 19 current, 17 stale                               |
| Audit backlog               | 12 entries have no versioned denominator yet                   |
| Capability-map navigation   | Committed in `9107dd5b`; live verification pending             |
| Live verification           | Not started for this checkpoint                                |

`not-audited` is an honest state, not 0% capability. A service moves to `current` only after its
pinned upstream denominator and all four gates have evidence. A mutable tag must remain explicit.

## Active lanes

| Lane                                                        | Owner                          | File ownership                                                                | State                | Required handoff                                    |
| ----------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- | -------------------- | --------------------------------------------------- |
| Inventory and UI projection                                 | `capability_map_navigation`    | Capability-map page/component and focused UI tests                            | Committed `9107dd5b` | Visual and live verification pending                |
| Runtime, governance, operations                             | `capability_audit_runtime_ops` | `src/lib/service-capabilities/runtime-governance-operations.ts` and its tests | Committed `f3f081d2` | 12 audited, 12 pending; live evidence gaps retained |
| Data, streaming, observability, quality, enterprise sources | `ai_qa_operator_loop`          | `src/lib/service-capabilities/data-quality-observability.ts` and its tests    | Committed `64bd00e5` | 24 audited; live attribution gaps retained          |
| Registry integration and release                            | Root                           | Shared registry projection, this tracker, build, deploy, live verification    | In progress          | Immutable deployed SHA and live fleet evidence      |

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
| Runtime           | `app-worker`                    | pending              | runtime/governance/operations |
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

## Release gates

- [x] All 48 entries are visible and selectable in the capability-map UI.
- [x] Family, owner, audit-state, readiness, and text filters live in the URL/history stack.
- [ ] Every selected service shows deployment, routes, readiness evidence, workflow evidence, gaps,
      and next action even when its capability denominator is not audited.
- [x] Versioned family records are integrated into the canonical registry without duplicated facts.
- [ ] Focused logic and navigation tests pass (route ownership repair in progress).
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
