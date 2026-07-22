# Service expansion agent brief

## Product-first deployment boundary

The on-prem fleet is a demo/integration fixture that avoids cloud cost; fleet topology is not the
deliverable. Agents must verify the assigned capability through its complete user journey and only
the dependencies that journey actually exercises. Do not redeploy or re-certify all composable
services after an App/Console capability change.

- Console/App code: deploy the exact Console artifact and affected Console workers only.
- Schema changes: use the explicit backup + migration gate, and only when schema changed.
- Service code/config/image/contract changes: narrowly deploy that service and preserve its state.
- Broad recovery: reserved for explicit fleet/recovery work or a proven fleet-wide blocker, never a
  routine capability-release step.

Live evidence must lead with the product outcome (UI/API journey, persisted effect, controls,
receipt/audit, replay/idempotency). Infrastructure health is supporting evidence, scoped to the
dependency required for that outcome.

This is the shared execution brief for every agent that audits, integrates, exposes, or verifies an
Off Grid service. Read it before discovery. Do not create a competing inventory, capability scale,
route taxonomy, or definition of "integrated".

## Zero-discovery bootstrap

This document is the universal prompt. The orchestrator's task message supplies only three things:

```text
Assigned family:
Owned files (disjoint from other agents):
Required deliverable/evidence:
```

Everything else comes from the systems of record below. Do **not** spend a turn broadly scanning the
repository, counting Docker images, reconstructing fleet topology, inventing a capability taxonomy,
or asking another agent to repeat prior discovery. Start from the assigned rows in
`docs/SERVICE_CAPABILITY_STATUS.md`, then open only the linked canonical records and the code needed
for that family.

If two records disagree, do not silently choose one or start a new inventory. Record the conflict in
`docs/GAPS_BACKLOG.md`, preserve the more conservative gate state, and send the exact conflicting
paths and values to the integration owner. The canonical inventory count is the value enforced by
`src/lib/service-inventory.ts`; historical release notes are evidence for their release, not the
current ontology.

Before editing, confirm the assigned file set does not overlap another active lane. During the task,
commit each coherent slice. At handoff, report only the compact evidence template in **Parallel
ownership** below; do not write a second narrative audit.

## Outcome

The Console must account for **48 logical composable entries**: 42 platform services and
operational dependencies plus six enterprise source systems. Every entry must be visible in the
service inventory. Relevant upstream capabilities must be classified honestly and, when supported,
must have a real adapter/API/UI/workflow path. An image, container, health check, or read-only status
card is not product integration.

The product goal is not to mirror every upstream administration screen. Expose the capabilities that
help an operator build, govern, run, diagnose, and prove high-ROI BFSI workflows. Record intentionally
unsupported upstream capability instead of silently omitting it or inflating coverage.

## Systems of record — read in this order

1. `../onprem-fleet-orchestration/deploy/onprem/SERVICE_MAP.md` — deployed ownership and routes.
2. `../onprem-fleet-orchestration/deploy/onprem/DEPLOYMENT_TOPOLOGY.md` — node placement and topology.
3. `../onprem-fleet-orchestration/deploy/onprem/SERVER_STATE.md` — current live evidence and gaps.
4. `src/lib/runtime-service-topology.ts` and `src/lib/operational-services.ts` — Console registry.
5. `src/lib/service-capability-map.ts` and `docs/SERVICE_CAPABILITY_MAP.md` — audited capability
   denominators and evidence. Reuse them; do not copy their facts into another registry.
6. `docs/SERVICE_CAPABILITY_STATUS.md` — the resume-safe 48-entry tracker, active ownership,
   release gates, and last committed handoffs. Read it before discovery and update it through the
   integration owner after every committed slice.
7. `../brand/DESIGN_PHILOSOPHY.md` and
   `../component-library-animations` — UI source of truth. Reuse or extend its primitives.

Container/image counts are deployment detail, not the product ontology. Never infer the 48 entries
from `docker images`.

## The four gates

Evaluate every audited capability independently:

1. **Available** — the pinned upstream version really provides it and the deployed service is healthy.
2. **Integrated** — a production adapter/API path calls it with correct auth, tenancy, errors, and
   lifecycle behavior.
3. **UI exposed** — an operator can discover and manage it in the canonical URL-driven Console IA;
   read-only status does not satisfy CRUD/action capability.
4. **Used in workflow** — a seeded bank or insurance journey exercises the real path and produces
   auditable evidence.

Only verified gates count. Partial work remains partial. Never round up or turn "not audited" into
zero percent. A capability can be healthy but not selected by production; state that explicitly.

## Required record for each of the 48 entries

- stable id and operator-facing name;
- family and role (data, runtime, governance, observability, operations, enterprise source);
- deployed node/process and version or mutable-tag warning;
- system-of-record link;
- operational state and last verification evidence;
- audit state (`audited` or `not audited`);
- audited upstream denominator and source, when known;
- counts/evidence for each of the four gates;
- canonical list/detail/management routes;
- production callers and seeded BFSI workflows;
- explicit gaps, intentionally unsupported capabilities, and next action.

## Implementation sequence

For one service family at a time:

1. Reconcile the 48-entry inventory; never hard-code an eight-node or container-derived list.
2. Pin or record the upstream version and audit capabilities from primary upstream documentation.
3. Implement pure capability/policy models in `src/lib`; keep I/O behind adapters.
4. Wire real service APIs through thin routes with tenant/auth/error boundaries.
5. Add canonical list → detail → management UI using shared Off Grid primitives. Navigation lives in
   URLs/history; third-level collections use collapsible local navigation when needed.
6. Add relevant CRUD/actions—not a read-only dashboard—and expose honest readiness/provenance.
7. Exercise a real bank or insurance journey, seed useful data, and capture auditable proof.
8. Update Console docs and fleet records in the same commit as behavior/config changes.
9. Run focused real tests, coverage/typecheck/build, rendered wide+narrow visual checks, deploy the
   exact immutable SHA, then run fleet health and integration verification.

## Definition of done for an assigned service

An assigned service is complete only when the same immutable version has all applicable artifacts:

- one canonical inventory entry and one versioned upstream capability denominator;
- a real adapter/API call path with auth, tenancy, bounded failures, and lifecycle semantics;
- a discoverable URL-driven list/detail/management surface using the shared component library;
- relevant create/update/delete and operational actions, not merely health or read-only cards;
- at least one bank or insurance workflow exercising the real path with retained audit evidence;
- focused unit/integration coverage plus build and visual evidence for the touched journey;
- matching Console documentation, fleet configuration/state documentation, and gap status.

If any artifact is absent, hand it off as `partial` or `not verified` with the exact next action. An
agent may finish its owned slice without claiming the service itself is complete.

## Parallel ownership

The orchestrator assigns disjoint families and file sets. A worker must not edit another active
worker's shared navigation, registry, or component files. One agent owns shared IA/registry projection
per wave; family agents expose narrow handoff APIs. Commit coherent slices early and report the SHA.

The shared checkout also means `.next`, `coverage/`, and other generated directories are global.
Workers run focused tests, formatting, and typecheck; the orchestrator schedules production build,
full coverage, duplication, screenshot, push, and deploy gates **exclusively**, after workers stop their
dev servers. Never run two Next builds or two c8 commands concurrently—their artifacts can invalidate
an otherwise good visual or coverage result.

Recommended lanes:

- **Inventory/IA projection** — 48-entry reconciliation, canonical routes, capability-map projection.
- **Data/messaging/quality** — Airbyte, Kestra, warehouse, Redpanda, Presidio, Great Expectations,
  Evidently and related stores.
- **Runtime/governance/observability** — gateways, LiteLLM, models, guardrails, secrets, OTel, Jaeger,
  metrics/logging and platform control services.

After a lane lands, use this handoff format:

```text
Service family:
Owned files:
Commit SHA:
Available / Integrated / UI exposed / Used:
Real workflow evidence:
Fleet health evidence:
Known gaps (with backlog ids):
Not verified:
Next resumable action:
```

The orchestrator applies that handoff to `docs/SERVICE_CAPABILITY_STATUS.md` before closing or
reassigning the lane. Workers do not create private scratch trackers or redefine another worker's
state.

## Non-negotiable honesty rules

- Do not say "all services are up" when any required health/integration check fails.
- Do not say "integrated" for a container, ping, proxy, status card, or dead code path.
- Do not claim upstream feature coverage without a versioned denominator and source.
- Do not hide unsupported features; explain whether they are irrelevant, deferred, or blocked.
- Do not deploy a moving worktree. Capture one source SHA before sync/build and stamp that same SHA.
- Do not declare UI complete without reading rendered screenshots at wide and narrow viewports.
