# Service expansion agent brief

This is the shared execution brief for every agent that audits, integrates, exposes, or verifies an
Off Grid service. Read it before discovery. Do not create a competing inventory, capability scale,
route taxonomy, or definition of "integrated".

## Outcome

The Console must account for the fleet's **49 logical composable entries**: 43 platform services and
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
6. `../brand/DESIGN_PHILOSOPHY.md` and
   `../component-library-animations` — UI source of truth. Reuse or extend its primitives.

Container/image counts are deployment detail, not the product ontology. Never infer the 49 entries
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

## Required record for each of the 49 entries

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

1. Reconcile the 49-entry inventory; never hard-code an eight-node or container-derived list.
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

- **Inventory/IA projection** — 49-entry reconciliation, canonical routes, capability-map projection.
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
```

## Non-negotiable honesty rules

- Do not say "all services are up" when any required health/integration check fails.
- Do not say "integrated" for a container, ping, proxy, status card, or dead code path.
- Do not claim upstream feature coverage without a versioned denominator and source.
- Do not hide unsupported features; explain whether they are irrelevant, deferred, or blocked.
- Do not deploy a moving worktree. Capture one source SHA before sync/build and stamp that same SHA.
- Do not declare UI complete without reading rendered screenshots at wide and narrow viewports.
