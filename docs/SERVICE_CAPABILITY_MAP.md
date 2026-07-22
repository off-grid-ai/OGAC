# Service capability map

The console's [Service capability map](/operations/services/capability-map) answers four separate
questions for each named capability:

1. Is the capability available in the audited upstream service version?
2. Does the console have an adapter or API integration for it?
3. Is there a real operator UI for it?
4. Is it used in a verified production or business workflow?

Those questions cannot be collapsed into a single "integrated" flag. A page can advertise a
control that its adapter ignores. An adapter can work in an admin test without carrying production
traffic. The map keeps both gaps visible.

## Denominator semantics

The denominator is the named capability list for one audited service and version in
`src/lib/service-capability-map.ts`. It is not an endpoint count. Repeated endpoints that implement
one operator outcome are one capability. Distinct outcomes stay distinct even when they share an
endpoint.

Every item has four gates:

| Gate                | A `yes` means                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Available upstream  | The capability exists in the audited upstream release or deployed image.                       |
| Adapter / API       | The console calls or configures the real capability and handles its response.                  |
| UI exposed          | An operator can reach a real, deep-linkable console route for the capability.                  |
| Production workflow | A real production or business path uses it. A manual test panel alone does not pass this gate. |

Gate states are:

- `yes`: the audit verified the full gate.
- `partial`: a bounded part exists, and the evidence names the remaining boundary.
- `no`: the gate is absent or unverified.

The progress value counts only `yes` gates. `partial` is shown separately and is not rounded up.
The production count includes only items whose production-workflow gate is `yes`.

An unaudited service has no denominator. It renders `not audited`, not 0% and not 100%. Adding a
service to the directory does not silently create a coverage claim.

## Version semantics

An audit is valid for the exact version string and audit date stored in the registry. Re-audit when:

- a pinned image, package, or sidecar dependency changes;
- an adapter, API route, UI route, or production workflow changes;
- the upstream capability set changes; or
- a mutable image tag resolves to a different artifact.

LiteLLM currently uses `main-stable`, a mutable image tag. The map calls that out rather than
inventing a fixed version. Pin the image digest before treating that upstream denominator as
reproducible.

The canonical registry composes two disjoint family registries and currently contains 37 versioned
audit records: 20 current and 17 stale. Eleven of the 48 inventory entries remain explicitly
unaudited. Stale records keep their historical adapter, UI, and workflow evidence visible, but every
Available gate is normalized to `no` until the deployed upstream denominator is re-audited.

The map separates version provenance from denominator provenance. `versionSource` names the image,
package, first-party SHA, or deployment record that establishes identity. `denominatorSource` names
the primary upstream contract used to enumerate relevant operator outcomes. A compose pin alone is
not proof of an upstream capability list.

## Systems of record

Use the right owner for each fact:

- `src/lib/service-capability-map.ts` is the canonical projection and duplicate-owner gate.
  `src/lib/service-capabilities/*` owns each disjoint family denominator, four gate assessments,
  evidence, operator routes, and concrete gaps.
- `src/lib/services-directory.ts` and the runtime topology registry own which logical services the
  console lists. They do not own capability coverage.
- `deploy/docker-compose.yml`, `deploy/sidecars/drift/requirements.txt`, and
  `deploy/otel-collector.yaml` own generic self-host image and configuration defaults in this repo.
- The private sibling `off-grid-ai/onprem-fleet-orchestration` repository owns deployment-specific
  live state, service placement, environment wiring, and deploy verification. Its `SERVER_STATE.md`,
  `SERVICE_MAP.md`, `DEPLOY.md`, and verification records decide whether a code path is live on a
  particular fleet.
- `docs/SERVICE_CAPABILITY_AUDIT.md` and `docs/research/*` are historical audit inputs. They are not
  the current UI score system of record and must not overwrite newer live evidence without a
  re-audit.

## First-party capability planes

The 48-entry denominator measures audited upstream services and enterprise sources. First-party
product planes such as Governed Action, Outcome Observation, and Enterprise Context are recorded as
cross-cutting deltas in `docs/SERVICE_CAPABILITY_STATUS.md`; they do not create synthetic services or
inflate an upstream denominator.

An Enterprise Context delta passes only when one tenant-safe resolver projection drives the Builder
API, guided editor, conversational Forge, data/tool/pipeline/action pickers, and server-side App
write validation. A capability shown as unavailable must remain visible with a plain-language reason
and remedy, but it must not be selectable or persistable. Local code, route, browser, and deployment
evidence are recorded independently.

## Updating the map

For each changed capability, read the upstream contract, trace the real adapter and API route,
open the actual UI route, and prove the production path. Update all four gates independently. Add a
concrete gap whenever any gate is `partial` or `no`, and add or update the pure and route integration
tests in the same commit.
