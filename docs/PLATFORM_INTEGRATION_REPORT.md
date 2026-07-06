# Platform integration report — post-merge audit (workspace / temporal / config batch)

**Date:** 2026-07-06 · **Method:** code read + grep against `main` (no deploy). **Scope:** the 3
just-merged surfaces (Workspace revamp #75, Temporal Jobs #76, Config mDNS + honest health #78) plus
the CSP/Scalar fix, traced for *integration coherence* — not "does each file compile" but "do the
seams connect end-to-end."

The live harness (`deploy/verify-integration.sh`, per `INTEGRATION_SUCCESS_SPEC.md`) stood at
**8 pass / 0 fail / 3 skip** on S1 (A1–A5, C1–C3 VERIFIED; A7/B2/B3 SKIP-by-design; C4 SKIPs cleanly
until the Temporal worker is wired). This report does not re-run that harness (S1-only); it verifies
the *newly-merged code* integrates with those seams.

---

## Overall verdict: THE PLATFORM COHERES — with two real seams to close

Every newly-merged UI action has a backing route, every route degrades gracefully when its dependency
is off, and the pure/IO split holds throughout (`temporal-visibility.ts`, `display-host.ts`,
`services-directory.ts` resolvers are zero-IO and testable; the adapters do the I/O). The workspace
consolidation resolves all routes, Artifacts is reachable again, and the self-hosted Scalar closes the
air-gap hole.

**Two concerns worth fixing (details below):**
1. **`workflows/[wf]/cancel` emits no audit event** — an operator cancelling/terminating a durable
   job leaves no accountability record. Mutation-without-audit violates the audit mandate. (Gap #34)
2. **`runIdFromWorkflowId` is fragile to runIds containing `-`** — it slices after the *last* `-`,
   but `workflowIdFor` is `agentrun-<agent>-<runId>`. Safe for today's hyphen-free runIds, latent
   otherwise. (Gap #35)

---

## Per-surface findings

### 1. Temporal Jobs surface — PASS (with 2 concerns)

**Flow traced:** `DurableExecutionsPanel.tsx` → `GET /workflows` (list) → per-row `workflowActionsFor`
gates buttons → `POST /workflows/[wf]/rerun` | `/cancel` → `agentruntime.ts` adapter → Temporal.

- **PASS — graceful degradation when Temporal is off.**
  `src/app/api/v1/admin/agent-runs/workflows/route.ts:14` calls `listWorkflowExecutions`, which
  returns a `{configured, reachable, note, executions:[]}` view rather than throwing. The panel
  branches on `!view.configured` / `!view.reachable` and shows the "Durable runtime not enabled" /
  "configured but unreachable" empty states (`DurableExecutionsPanel.tsx:158-174`). No 5xx path.
- **PASS — rerun correlates workflowId → recorded runId → re-dispatch.**
  `rerun/route.ts:29` parses the console runId out of the workflowId via `runIdFromWorkflowId`, loads
  the prior run (`getAgentRun`), and re-submits through `runAgent(prior.agentId, prior.query, …)`
  (`rerun/route.ts:44`). This is the correct seam: rerun re-enters durable dispatch when enabled or
  runs inline otherwise, so "rerun a job" works regardless of runtime — and does NOT require Temporal
  to be reachable (the source run is in the DB). 400 when the workflow isn't an agent-run; 404 when no
  recorded run correlates. Solid.
- **PASS — rerun is audited via `runAgent`.** The new run goes through `runAgent`, which emits the
  canonical attributed audit (`agentrun.ts:326-329,361,375`) and the full correlation fan-out
  (`correlation.ts`). So the rerun *result* is a first-class governed run in the audit trail.
- **PASS — action gating agrees between UI and route.** Both the panel
  (`DurableExecutionsPanel.tsx:220 workflowActionsFor`) and the pure predicates
  (`temporal-visibility.ts` `canRerunWorkflow`/`canCancelWorkflow`) derive from the same Temporal
  status union — rerun only on closed, cancel only on open. No divergence.
- **PASS — cancel maps failure modes to honest HTTP codes.** `cancel/route.ts:26` →
  `not_found`→404, `not_configured`→409, else 502. Never an unhandled 5xx.
- **CONCERN (Gap #34) — cancel/terminate emits NO audit.** `grep` for `audit` across
  `workflows/**` returns nothing. Unlike rerun (audited through `runAgent`), a
  `POST /workflows/[wf]/cancel` (esp. `mode:terminate`, which force-kills irreversibly) writes no
  accountability record. The route even captures `gate.user.email` into the response `by` field but
  never persists it. This is a mutation with no audit — the exact seam the operating model flags.
- **CONCERN (Gap #35) — `runIdFromWorkflowId` fragile to hyphenated runIds.**
  `temporal-visibility.ts:runIdFromWorkflowId` slices after the *last* `-`; `workflowIdFor`
  (`agent-run-durable.ts:74`) builds `agentrun-<safeAgent>-<runId>`. If a runId ever contains `-`
  (e.g. a UUID), rerun would resolve the wrong runId or 404. Today's runIds (`run_2c0d55c7`) are
  hyphen-free so it's correct now — latent, not live.

### 2. Config mDNS — PASS

**Flow traced:** `config-registry.ts` (declares `hostValue` keys, mDNS defaults) →
`config.ts` `getConfigEntries` renders through `configDisplayValue` → operator edits → `setConfig`
maps back through `configConnectValue` before persisting.

- **PASS — no raw IP / loopback can reach the client.** `config.ts:57` renders every non-secret value
  through `configDisplayValue` → `toDisplayHost`, which rewrites loopback (`127.0.0.1`/`localhost`/
  `0.0.0.0`/`::1`), every known fleet IP, AND *any* unknown private RFC-1918 / link-local IPv4 to an
  mDNS host (`display-host.ts` `mapHostname`/`isPrivateIPv4`). An unknown private IP falls back to
  `offgrid-s1.local` rather than leaking. Only public hostnames pass through. Founder directive holds.
- **PASS — display↔connect round-trip preserves the real target.** `toDisplayHost` and `toConnectHost`
  are exact inverses for the S1/g6 loopback mapping (`display-host.ts` `DISPLAY_HOST_TO_LOOPBACK`),
  preserving scheme/port/path. `setConfig` (`config.ts:87`) applies `configConnectValue` on the
  write path, so an operator who sees `offgrid-s1.local:6333` and saves it persists `127.0.0.1:6333`
  — connectivity never breaks. g6 inverts on the *displayed proxy port* (8931–8939), which matches
  how it's shown. Both URL-form and bare `host:port` (and IPv6, and `redis://` scheme) are handled.
- **PASS — mDNS defaults everywhere.** Every `hostValue:true` key in `CONFIG_REGISTRY` defaults to an
  `offgrid-*.local` form (gateway/keycloak/qdrant/opensearch/langfuse/temporal/redis), never a raw
  IP. Verified across the registry.

### 3. Honest health — PASS

**Flow traced:** `services-directory.ts` (declares `probe: embedded|optional|network`) →
`status.ts` `probeEntry`/`resolveHealth` → `GET /api/v1/services/health`.

- **PASS — LanceDB (embedded) never reports false "down".** `services-directory.ts:180-189` marks
  LanceDB `probe:'embedded'` with `url:'embedded://lancedb'`; `status.ts:31-33` skips the network
  probe for `embedded://`/`redis://` schemes; `resolveHealth` (`services-directory.ts:255`) returns
  `'embedded'` (healthy) with no probe. Correct — an in-process on-disk store has no endpoint to hit.
- **PASS — Redis (optional) reports its fallback, not "down".** `services-directory.ts:191-199` marks
  Redis `probe:'optional'`; when it doesn't answer, `resolveHealth` returns `'optional'` (on the
  documented in-process-cache fallback) not `'down'`. The rollup (`status.ts:81-87`) counts anything
  `!== 'down'` as healthy, so an absent Redis doesn't drag the platform to "degraded".
- **PASS — both the authenticated Services sweep and public `/status` share one probe.**
  `services/health/route.ts:12` uses the same `probeEntry` as the public status API, so the two
  cannot disagree.

### 4. Workspace consolidation — PASS

- **PASS — /projects /prompts /artifacts still resolve; Artifacts reachable again.** All three live
  under the `(workspace)` route group (`src/app/(console)/(workspace)/{projects,prompts,artifacts}`),
  sharing `layout.tsx` which renders `WorkspaceNav` top-tabs. The routes are the group's `secondary`
  members in `groups.ts` (Workspace: primary `chat/knowledge/storage`, secondary
  `projects/prompts/artifacts`) — they keep their routes (nothing 404s) but are reached via the scoped
  nav, not the sidebar, per the two-level nav design.
- **PASS — sidebar highlight stays coherent on secondary routes.** `sidebarActiveIdFor` maps a
  secondary route (e.g. `/artifacts`) back to its group's primary so the sidebar row stays active —
  matches the navigation-in-URL mandate.

### 5. Self-hosted Scalar (`/docs/api`) — PASS

- **PASS — air-gap hole closed.** `docs/api/route.ts` sets Scalar `cdn:'/scalar.standalone.js'`
  instead of jsdelivr; the 3.7M vendored bundle is present at `public/scalar.standalone.js`;
  `middleware.ts:40` lists `/scalar.standalone.js` in `PUBLIC_EXACT` so the unauthenticated docs page
  can load it. CSP `script-src 'self' 'unsafe-inline' 'unsafe-eval'` (`next.config.mjs:11`) permits
  the same-origin bundle. The page renders fully on-prem with no external fetch.

---

## Seams checked and found sound (adversarial pass)

- **UI action → backing route:** every button in `DurableExecutionsPanel` (Refresh/Re-run/Cancel/
  Terminate/detail drill-in) maps to a real route. No dangling action.
- **Route → dep-down behaviour:** workflows list/detail/cancel all return typed graceful states, not
  5xx, when Temporal is off. Config renders defaults when `.env` keys are absent. Health resolves
  embedded/optional without a probe.
- **Correlation:** rerun re-enters `runAgent`, which owns the single-runId fan-out — so a rerun is as
  correlated as any inline run.

## Seams that DON'T fully connect (→ gaps filed)

- Cancel/terminate mutation has no audit emission (Gap #34).
- `runIdFromWorkflowId` last-hyphen parse is latent-fragile (Gap #35).
