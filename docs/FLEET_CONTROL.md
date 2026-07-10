# Fleet Control — device fleet + field-force intelligence

"Fleet Control" is two layers in one console: the **baseline device-fleet management** the market
already expects, plus the **field-force intelligence** only Off Grid adds. The first is leveraged
open source (FleetDM + osquery); the second is the moat, captured on-device across desktop and
mobile and grounded in your own Brain.

See it as a page: **[/fleet-control](/fleet-control)**.

## Act 1 — baseline device fleet (FleetDM + osquery, MIT core)

The table stakes, delivered on permissive OSS, self-hosted, no per-device licence.

**Available today (agent-enrolled):**

- **Device inventory & health** - hardware, OS, software, users, disk-encryption status, per device.
- **Live & scheduled queries** - ask any question across the whole fleet in real time (osquery).
- **Policies & compliance** - pass/fail posture per device becomes a fleet compliance score.
- **Software visibility & vulnerability mapping** (software to CVEs).
- **GitOps & targeting** (labels/teams as code) · **audit, webhooks, dashboards**.

**Coming soon - device CONTROL (MDM commands):** the actions that reach out and change a device -
**lock**, **wipe**, **config-profile push**, **settings enforcement**, and **Apple APNs
enrollment**. These render in a "coming soon" state in the console today (the action is visible but
disabled) so nothing silently no-ops. The inventory, queries, and policies above stay live.

*Fleet Free (MIT core) covers inventory, live/scheduled queries, policies, GitOps, and scripts.
Advanced MDM control (config profiles, richer device-action RBAC) leans Fleet Premium, which is
paid and separately licensed - we stay on the MIT core, so control ships when the self-hostable
path is real.*

**Wiring:** the `mdm` capability port — `OFFGRID_ADAPTER_MDM=fleetdm`, `OFFGRID_FLEET_URL`,
`OFFGRID_FLEET_TOKEN`. Bring it up with `make mdm` (Fleet + MySQL + Redis on `:8070`); the console
both calls Fleet's REST API (`GET /api/v1/admin/mdm/devices`) and embeds its full UI (Tier-3). The
first-party device registry is the always-on default and the fallback.

## Act 2 — Fleet intelligence (Off Grid AI, desktop + mobile)

FleetDM manages devices; Off Grid turns the fleet into a workforce you can coach. None of this
comes from an MDM — it's the differentiation:

- **Device → person → territory** — every host tied to the rep/role/region that owns it.
- **Activity & workflow intelligence** — the Off Grid node (desktop + mobile, opt-in capture) sees
  how work actually happens and turns it into signal.
- **Field-force & sales intelligence** — playbook adherence, winning-pattern detection,
  next-best-action, grounded in the Brain, per rep and region.
- **On-device copilot, everywhere** — a private copilot on each desktop and phone.
- **Tacit knowledge → shared SOPs** · **coverage & cohort insight**.

## Governed, because it's fleet control *for AI*

The same console that manages the devices governs the AI on them: one **gateway** + **kill-switch**,
append-only **audit** + **ABAC** per device, **Agent QA** (evals / drift / online scoring) across
the fleet, **FinOps** cost per device, **provenance**.

## Platform split (how devices join the fleet)

- **Desktop (macOS/Windows/Linux):** already an Off Grid node; optionally bundle **fleetd** (osquery
  agent) to unlock the full Fleet feature set. A standard agent install — not a rewrite.
- **Mobile (iOS/Android):** already an Off Grid **node** (capture/enroll/policy/audit). osquery
  doesn't run on mobile and Fleet's mobile MDM is Premium-leaning, so mobile rides the node, not
  Fleet. Optional future: NanoMDM (Apache-2.0) for true Apple MDM.

The console unifies both behind one Fleet Control surface.
