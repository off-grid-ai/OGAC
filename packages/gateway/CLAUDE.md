# @offgrid/gateway — repo guide

The local, OpenAI-compatible AI gateway behind Off Grid AI. It is the **spine**:
a config-driven **composition root** that mounts feature modules (each its own
logic + UI) and exposes one governed API. Run it standalone, or let the console
mount the same host with a fuller config — there is no second app.

---

## ✅ RESOLVED DIRECTION (the architecture every session builds toward)

Settled with the user. The commercial line can still move per-module (see below),
but the architecture and the OSS principle are decided — do NOT relitigate them,
build to them.

### 1. Config-driven composition root — no duplication, ever
Every capability is a **self-contained feature module: its own logic AND its own
UI**. The gateway is the host; a single config file composes modules:

```ts
// offgrid.config.ts — the ONLY thing that differs between standalone GW and console
export default defineOffgrid({
  auth: localAuth(),                 // console swaps: keycloakAuth({ url, ... })
  modules: [
    analytics(),
    finops({ pricing: {...} }),
    vectordb({ url: 'http://qdrant.lan:6333', apiKey: '…' }),  // ← tell it the URL, done
  ],
})
```

Each module exports one factory returning a manifest: `{ id, nav, routes,
settingsPanel, gatewayHooks: { sinks?, policies? }, integrations, requires:[perms] }`.
The host reads the config and does the rest automatically — mounts nav/routes/
settings, wires sinks/policies into the engine, enforces `requires` via the auth
provider. **Import a module → add one config line → give it its URL → done.**
Add/remove a capability = add/remove a line. Nothing is defined or wired twice.

The **console is the same host with a fuller config** (more modules + the
Keycloak/org provider). It is not a separate app. That is what "the GW is the
spine of the console" means, literally.

### 2. Three hard principles
- **No duplication** — a module is defined once; the config only references it.
- **No lock-in** — every module takes its URL/backend as config; point it at your
  own Qdrant / analytics / nodes, or delete the line. OpenAI-compatible in and
  out. Self-host, your infra, your data, AGPL. Auth is itself a config-driven
  module (`localAuth` or `keycloakAuth`) — you can run SSO + org RBAC/ABAC
  yourself; it is not a gate.
- **True OSS** — run the gateway standalone and use ALL plug-and-play modules and
  integrations with no account, no console, no paywall.

### 3. The OSS / Pro line: **plug-and-play is OSS; tough, maintained work is Pro**
Not an arbitrary feature list — a principle. If it's an interface + a config line,
it's open. If it takes real, ongoing engineering + maintenance, it's **Pro**.

- **OSS (plug-and-play):** the composition-root host, the module SDK, and every
  interface-driven module — gateway/routing/health/backpressure, policy engine,
  analytics, finops, vectordb inspect, chat, projects, knowledge base,
  authz/Keycloak provider, and the **connector interface** itself.
- **Pro (not plug-and-play — the hard/maintained work):** the actual **maintained
  connectors** (Salesforce/HubSpot/Gmail/Slack/…), **ETL pipelines**, **fleet
  control / multinode orchestration**, and the polished **authoring/builder
  experiences** (BRE rule builder, AI agent builder). Plus **managed hosting**.

Honest, not lock-in: the connector interface is open, so anyone CAN write their
own — most won't, because maintaining connectors/ETL is exactly the treadmill
they're paying to avoid (the Fivetran/Airbyte bet). We sell the *work and its
upkeep*, never a locked capability.

**Per-module license is a movable flag.** Build every capability as a module the
same way; which side of the OSS/Pro line it lands on is decided per module and can
change. Don't hard-code the boundary into the architecture.

### For the agent working here
Build to this. Keep new capability behind the module manifest + config seams (not
hardwired). When a change touches the OSS/Pro boundary for a specific module,
confirm which side it's on with the user — but the architecture above is settled.

---

## Current state vs. target
- Built: cluster router (routing, true health, admission-control backpressure),
  plug-and-play observability **sinks** + policy **pipeline**; layer packages in
  `shared` (`@offgrid/policy|analytics|finops|vectordb`) with logic + integration
  catalogs. The console imports the gateway and runs it (live on the rig :8800).
- NOT yet built: the config-driven module registry (`defineOffgrid`, the manifest
  contract), per-module UIs as shared React components, the `@offgrid/authz`
  provider seam. A raw-HTML dashboard was hacked onto the gateway and should be
  removed in favor of module UIs rendered by the host. Today's modules are
  logic-only; the UI + registry work is the path to the target above.

## Layout
- `src/cli.ts` — single-node gateway (handlers migrating from desktop `model-server`).
- `src/cluster-cli.ts` + `src/cluster/*` — the multinode router (routing, health, capture, observability sinks, admission limiter, policy pipeline).
- `src/policy/*` — the policy pipeline interface (concrete policies ship as `@offgrid/policy`).
- `src/runtime-env.ts` — host-agnostic path/resource seam (Electron vs standalone).

## Conventions
- Dependency-light; Node `http` + global `fetch`. Build with `npm run build` (tsup, esm+cjs+dts).
- Observability and policy are **plug-and-play** (sink/policy interfaces) — keep new capability behind those seams, not hardwired.
- Small, meaningful commits; push. AGPL-3.0-only. No verbatim copying from other projects (inspiration only).
- Backpressure/admission control is in-process on the sync path; durable queued inference belongs on Temporal as a separate async layer.


## Multi-agent operating model (how we build here)

Substantial work is executed by a fleet of parallel subagents orchestrated by the main session — not one linear thread. The standard:

- **Parallel workers, 3 at a time.** Decompose work into worktree-isolated subagents that run concurrently in a rolling window of ~3, each on a DISJOINT file-set so they never merge-conflict. As each lands: review against the engineering standards, merge, run a **local production build gate** (typecheck + tests do NOT catch build/route errors — build before deploy), deploy, verify, then launch the next from the backlog. One agent owns nav/shared-file changes per round; the others avoid them.
- **The gap agent.** Any gap, regression, or "not fully done" is logged to the repo's gaps doc (`docs/GAPS_BACKLOG.md`). A standing gap agent is woken whenever there are gaps: it picks them up, closes them, and marks them resolved with evidence. Gaps are surfaced honestly, never hidden.
- **The QA / platform-integration + docs sweep agent.** After every 3 agent completions, run a sweep agent that (a) verifies the whole platform integrates and works end-to-end (run the integration harness + exercise real cross-service/-surface flows), (b) surfaces any new gaps into the gaps doc, and (c) writes/updates USER-FACING documentation live — how to use / what to do / why / when, per surface — so docs stay current with the build.
- **Merge gate (every merge, non-negotiable):** SOLID + pure logic isolated (unit-testable, zero-IO) separated from I/O; thin handlers; REAL tests exercising real behavior (mocks sparingly); typecheck clean; tests pass; a clean local production build; verify UI by screenshot (vision) and integration by the harness. Nothing is "done" until VERIFIED live, not merely merged.
- **Honesty bar:** report status as a gate (code / wired / verified), never inflate "done." A premature "complete" is a defect.
