# Audit — Operations (excluding observability) — 2026-08-05

Section: `src/app/(console)/operations/**` minus logs/traces/metrics/alerts and minus
`operations/services` + `operations/devices` (covered by sibling teams). Focus: capability map,
runs, physical nodes, edge, configuration, backups/DR drills, admin, and the
service-inventory/health/status libs underneath.

Central question: **can an operator trust this section's picture of the platform?**

Status: IN PROGRESS — findings appended as confirmed.

## Coverage so far

- [x] status.ts / service-health.ts / service-probes.ts / services-directory.ts (probe truthfulness)
- [x] backups + DR drill libs and all 4 write routes
- [ ] service-inventory.ts / capability map UI
- [ ] runs (`operations/runs`)
- [ ] nodes (`operations/nodes`, clusters)
- [ ] edge
- [ ] configuration
- [ ] admin
- [ ] screenshots read + judged

Live evidence gathered so far (local dev server on :3005, read-only):
`GET /api/v1/status` → `overall=degraded, up=42, total=43`; UP 33, EMBEDDED 1 (lancedb),
OPTIONAL 8 (redis, agent-worker, app-worker, chat-worker, cloudflared, litellm-forwarder,
observability-forwarder, fleet-forwarder), DOWN 1 (data-quality). No service reported `unverified`.

## Findings

### OPS-1 — BLOCKER — `expectStatus` is declared, documented, typed… and never passed to the probe
Persona: technical operator / SRE · full-stack engineer

`ServiceEntry.expectStatus` (`src/lib/service-entry.ts:19`) is the whole mechanism the in-flight
`status.ts` fix relies on to stop a wrong health path reading green. `judgeProbeStatus` honours it
(`src/lib/status.ts:31`) and `probeService` accepts it (`src/lib/status.ts:42`) — but the only caller
that ever runs for a real service drops it:

```ts
// src/lib/status.ts:80
const raw = await probeService(entry.url, entry.healthPath);   // entry.expectStatus never passed
```

Consequence: **no service on the fleet can declare what "alive" means for its probe.** Every entry
silently falls back to the lenient default. The single entry that declares `expectStatus: [405, 200]`
(otel-collector, `services-directory.ts:391`) is additionally shadowed by a custom probe adapter
(`service-probes.ts:64`), so it never reaches `probeService` either — which is why the declaration
looks like it works. `grep -rn expectStatus src test` returns zero call sites that plumb it and zero
tests. Add the argument, and add a test that a `[200]`-declaring entry answering 404 reads
`unverified`.

### OPS-2 — BLOCKER — the new `unverified` state still counts toward the green numerator
Persona: technical operator / SRE · QA

The fix introduces `unverified` precisely so "something answered but we proved nothing" stops reading
as health. The rollup then throws that away:

```ts
// src/lib/status.ts:133
const healthy = results.filter((r) => r.status !== 'down').length;
const up = healthy;                        // 'unverified' counted as up
...
// src/lib/status.ts:116  rollupStatus
if (healthy < total || anySlow) return 'degraded';
return 'operational';                      // all-unverified → "operational"
```

Same rule, same bug, in the shared helper: `isHealthy(status) { return status !== 'down' }`
(`src/lib/service-health.ts:16`), which is what the services list uses for its own `upCount`
(`src/components/services/ServicesDirectory.tsx:154`) and for filtering
(`ServicesDirectory.tsx:198`). So a fleet where every probe path is wrong renders
**"43 / 43 up · operational"**. This is the exact defect the fix was written to remove, surviving one
layer up. `up`/`healthy` must exclude `unverified`, and the rollup needs a third word for it.

### OPS-3 — BLOCKER — `HealthStatus` has no `unverified` member, so the section does not typecheck
Persona: full-stack engineer

`npx tsc --noEmit` on `main` (clean tree, HEAD `b5192513`) fails with exactly two errors, both in
this section:

```
src/lib/services-directory.ts(481,5): error TS2322: Type '"up" | "down" | "unverified"'
  is not assignable to type 'HealthStatus'.
src/lib/overview-synthesis.ts(329,5): error TS2322: ... '"unverified"' is not assignable to '"up" | "down"'
```

`RawProbe.status` gained `unverified` (`services-directory.ts:433`) but `HealthStatus`
(`service-health.ts:11`) and the `OperatorHome.health.items` shape did not. Beyond the broken gate,
the second error is the interesting one — see OPS-4.

### OPS-4 — HIGH — three different definitions of "healthy", and the operator home uses the opposite one
Persona: technical operator / SRE · full-stack engineer (DRY)

One decision, three implementations that disagree:

| site | rule | `optional` | `embedded` | `unverified` |
|---|---|---|---|---|
| `status.ts:133` (`/api/v1/status`, ops landing tile) | `!== 'down'` | healthy | healthy | healthy |
| `service-health.ts:16` `isHealthy` (services list) | `!== 'down'` | healthy | healthy | healthy |
| `overview-synthesis.ts:312` (operator home tile) | `=== 'up'`, `down = total - up` | **"not responding"** | **"not responding"** | **"not responding"** |

`overview-synthesis.ts:323` renders `hint: \`${down} not responding\``. With today's live numbers
(33 up of 43) the operator home says **"10 not responding"** while `/operations` says
**"42 / 43 · degraded"** and the services page says 42 healthy — from the same probe batch, in the
same page load. Whichever number is right, two of the three surfaces are lying, and an operator has
no way to tell which. Extract one `classifyHealth()` and have all three consume it.

### OPS-5 — HIGH — the three workers that execute every run are green by construction
Persona: technical operator / SRE

`agent-worker`, `app-worker` and `chat-worker` are registered with `url: 'indirect://<id>'` and
`probe: 'optional'` (`src/lib/operational-services.ts:15-35,53-76`). `indirect://` is not
http-probeable (`status.ts:68`), so `probeEntry` skips the network entirely and `resolveHealth`
returns `status: 'optional'` — **unconditionally, forever**. Combined with OPS-2 they are counted in
`up`. Live confirmation above: all three sit in the OPTIONAL bucket and are part of `up: 42`.

These are not peripheral: no poller on `offgrid-agents` / `offgrid-apps` / `offgrid-chat` means **no
run ever executes**. The console can already prove it — `readWorkerReadiness()`
(`src/lib/adapters/worker-readiness.ts`) does a real `DescribeTaskQueue` and
`task-queue-readiness.ts` shapes a `no-pollers` verdict, rendered by `WorkerReadinessPanel` on
`/operations/runs` and the service detail. So the truth is one component away and the health rollup
does not consume it. Their `fallbackLabel` even says *"readiness is reported by Temporal
task-queue/run state"* — pointing at evidence that exists but is not applied to the row that needs
it. Wire `readWorkerReadiness` into the probe adapter registry (`service-probes.ts:62`) for these
three ids, exactly as `postgres` and `otel-collector` already are.

Same construction, same permanent green, for `cloudflared` and the three forwarders — 7 of 43 rows
cannot ever report a problem.

### OPS-6 — HIGH — one malformed service URL takes down the entire health picture
Persona: full-stack engineer · SRE

`probeService` builds the target URL **outside** its try/catch:

```ts
// src/lib/status.ts:44-46
const target = new URL(healthPath ?? '/', url).toString();   // throws TypeError, uncaught
const started = Date.now();
try { const res = await fetch(...) }
```

`new URL('/', 'localhost:8080')` throws `TypeError: Invalid URL` (verified). A single bad row —
a hand-edited `OFFGRID_SERVICES`, an env var set to `host:port` instead of `http://host:port` —
rejects `probeEntry`, rejects the `Promise.all` in `computeStatus` (`status.ts:125`), and every
consumer degrades to its fallback at once: the ops landing tile renders **"Service health:
Unavailable"**, and `listLiveServiceTopologies` swallows it (`live-service-readiness.ts:47`
`catch { return topologies }`) so all 43 capability-map rows silently revert to the baseline
readiness. One typo, whole-platform blindness, with no message naming the offending entry. Move the
`new URL` inside the try and return a `down`/`unverified` result carrying the parse error.

### OPS-7 — HIGH — every privileged backup action is audited under the SAME action string
Persona: CISO

Four routes, four very different blast radii, one audit action:

| route | operation | audited as |
|---|---|---|
| `api/v1/admin/backups/route.ts:35` | run a backup | `action: 'backup.run'` |
| `api/v1/admin/backups/[name]/route.ts:24` | **DELETE a backup** | `action: 'backup.run'` |
| `api/v1/admin/backups/prune/route.ts:15` | **bulk-delete by retention** | `action: 'backup.run'` |
| `api/v1/admin/backups/[name]/restore/route.ts:26` | read DR commands | `action: 'backup.run'` |

Only the free-text `resource` field distinguishes them, and governance/alerting filters on `action`.
So "an admin destroyed the 03:00 backup" and "an admin ran a backup" are the same audit event class.
Worse, the delete route audits **only on success and only after the `rm`** — a delete that fails with
a 500 leaves no trace that anyone attempted it. Give each operation its own action
(`backup.delete`, `backup.prune`, `backup.restore.inspect`) and emit on the attempt.

### OPS-8 — MEDIUM — the backup concurrency guard is a module-level boolean
Persona: SRE

`runBackupNow` serialises with `let running = false` in module scope (`src/lib/backups.ts:139-146`)
and the comment states *"the script prunes/rsyncs, so two at once is unsafe."* That guard holds only
within one Node process. It does not survive a console restart mid-backup (the flag resets while the
spawned `backup.sh` is still running, because `spawn` is not tied to the request), and it is void the
moment a second console process exists. The 409 the UI shows is therefore best-effort, not a lock.
For a stated-unsafe operation the guard belongs on disk (a lockfile next to `BACKUPS_DIR`) or in the
DB, and the UI copy should not imply exclusivity it cannot enforce.

### OPS-9 — MEDIUM — another specific-deployment default baked into a self-host code path
Persona: full-stack engineer (same class as the hardcoded `getoffgridai.co` probe hosts)

`src/lib/backups.ts:25-31`:

```ts
const BACKUPS_DIR = process.env.OFFGRID_BACKUPS_DIR || '/Users/admin/offgrid/backups';
const OFFBOX_TARGET = process.env.OFFGRID_BACKUPS_OFFBOX_TARGET
  ?? 'admin@offgrid-g6.local:/Users/admin/offgrid/backups-from-s1';
```

plus `OFFGRID_BACKUP_SCRIPT || '/Users/admin/offgrid/console/deploy/onprem/backup.sh'` (`:106`) and
`OFFGRID_BACKUP_LAUNCHD_LABEL || 'co.getoffgridai.backup'` (`:107`). On any deployment that is not
this one box, the page reports **a specific other machine as the operator's off-box replication
target** — presented as configuration, not as a default — while the directory read fails and the view
falls back to empty/stale. Defaults for a fleet-specific path/host belong in `.env`, not in a
`||` in library code; absent config should read "not configured", never someone else's hostname.

### OPS-10 — BLOCKER — the Operations landing page is guaranteed to show "Unavailable" for all three headline facts
Persona: technical operator / SRE · principal UX · QA (verified by screenshot + measurement)

`/tmp/audit/ops/operations.png` — the entry point of the whole section renders three red-bordered
tiles: **Service health: Unavailable** ("Service probes did not complete"), **Runs in progress:
Unavailable**, **Runs needing attention: Unavailable** ("Run records did not respond"). Every fact
the page exists to state is dead.

Not a flake — arithmetic. `src/app/(console)/operations/page.tsx:13-16`:

```ts
safeWithTimeout(() => computeStatus(), 1500, null),
safeWithTimeout(() => listAllRuns(orgId), 1500, null),
```

Measured on the same server, same minute: `GET /api/v1/status` (which is `computeStatus()`)
returned in **20.1s** and **37.3s** on two consecutive calls. The budget is 1500ms. `computeStatus`
fans 43 probes each with a 5s `AbortSignal.timeout`, plus a `pg` pool connect at 2500ms
(`service-probes.ts:9`) — it cannot finish in 1.5s and never will. `listAllRuns` reads three DB
planes at 500 rows each; `/operations/runs` proves the data exists (**Total 173 · Failed 56**), so
that tile is timing out too, not empty.

The consequence is worse than a slow page: `safeWithTimeout` collapses timeout and rejection into the
same `null` (`with-timeout.ts:41-60`, by design), so the operator's first screen in Operations can
never distinguish "probes are slow", "probes crashed" and "the platform is on fire" — and after
seeing "Unavailable" three times, they will stop believing this page. Either read a cached/last-known
status snapshot here, or raise the budget to something the probe can actually meet and stream the
tiles in.

### OPS-11 — BLOCKER — "Physical nodes" shows no health, while the console already has live node health one module away
Persona: technical operator / SRE · principal UX (verified by screenshot)

`/tmp/audit/ops/operations_nodes.png` — eight node cards (g1…g7, s1), each showing exactly four
facts: Role, Host, Model, Routing. **No up/down, no last-seen, no reachability, no CPU/GPU/memory,
no capacity.** The closest thing to a status is "Routing: Enabled", which is a *configuration flag*
(`FleetTopology.tsx:31` — `node.clusterHead ? 'Cluster worker' : node.enabled ? 'Enabled' : 'Out of
rotation'`), not health. During an incident this page cannot answer "is g3 alive?".

The nav card on `/operations` promises otherwise — *"Registry-driven node inventory, roles, **health,
and capacity**"* — and the page's own subtitle says *"Inspect and **configure** every physical
instance"*. Neither health nor capacity nor configure is on the page.

This is a wiring gap, not a missing capability: `FleetTopology` reads `/api/v1/gateway/fleet`, whose
`FleetNode` type (`src/lib/fleet.ts:16-30`) is a pure `fleet_nodes` DB registry row with no health
field at all — while `/api/v1/gateway/nodes` proxies the aggregator's `/nodes`, whose raw shape is
documented in that route as `{name,host,port,model,vision,**health**,installedModels}`
(`src/app/api/v1/gateway/nodes/route.ts:18`) and is already rendered by `GatewayNodesCard`. So the
console has live node health; the surface an SRE navigates to for nodes reads the health-free registry
instead. Two "fleet" surfaces, and Operations got the one that cannot go red.

Secondary: `/operations/nodes/[nodeId]` (`FleetTopology.tsx:78-107`) is a real route (rule 3 ✓) but
renders the **same four facts as the card** plus a cluster link and a "Configure node" button that
navigates out of the section to `/runtime/models/fleet-control`. A detail view that adds no
information over its list item satisfies rule 3 in letter only.

### OPS-12 — HIGH — a stale Edge picture is presented as current; there is no "as of" anywhere on the surface
Persona: technical operator / SRE · QA

`useEdgeSnapshot` (`src/components/edge/EdgePanel.tsx:70-96`) polls `/api/v1/edge` every 15s and
tracks `failed`. `failed` is then consumed on exactly one line — inside `if (!snapshot)`
(`EdgePanel.tsx:106`). So:

- Before the first success, a failure reads honestly ("Could not reach the edge status API") ✓.
- **After** the first success, every subsequent failure sets `failed = true` and changes nothing on
  screen. The `StatusBand` keeps rendering the last-known `requests / allowed / blocked / WAF blocks /
  rate-limited` counts (`EdgePanel.tsx:120-129`) as live numbers.

`grep -n 'checkedAt|updatedAt|lastChecked' src/components/edge/EdgePanel.tsx` → **zero hits**: the
surface carries no timestamp at all. An operator watching the security posture of the public edge
cannot tell whether "0 blocked" means the edge is quiet or the reader died 40 minutes ago. `failed`
must gate the populated path too (banner + dimmed values), and every polled ops panel needs an
"as of HH:MM:SS".

`/tmp/audit/ops/operations_edge.png` shows the related first-load cost: the whole surface is a single
centered *"Loading edge status…"* card with no skeleton, and it was still loading when the shooter's
wait expired.

`WorkerReadinessPanel` has the same structure but renders its `error` line above the grid
(`WorkerReadinessPanel.tsx:65`), so at least the red text appears next to the now-stale green "Ready"
dots — visible, if contradictory. Fix both from one pattern.

### OPS-13 — HIGH — a 401 still resolves to `functional: 'pass'` in the capability-map readiness gates
Persona: CISO · technical operator / SRE

`judgeProbeStatus` deliberately maps auth refusal to `up` — defensible for *liveness*
(`status.ts:33-35`: "Auth refusal proves the service is serving"). `readinessFromHealth` then promotes
that same `up` to all three gates:

```ts
// src/lib/service-readiness-probe.ts:26-27
case 'up':
  return { deployed: 'pass', reachable: 'pass', functional: 'pass' };
```

The 404 hole was closed (`:38-43`, `functional: 'unknown'`), but **401/403 was not** — and on a
hardened fleet that is the common case, not the exotic one. A service answering `401 Unauthorized`
because the console's credential is wrong, expired, or was never provisioned renders a green
`functional` gate on the capability map. A refusal proves a socket and a router; it proves nothing
about function, and it is *precisely* the state an operator most needs to see (the console cannot talk
to the service). `services-directory.ts:238-239` even relies on this for SeaweedFS: *"a 403/401 from
the bucket root still proves it's up… which the network probe counts as healthy."*

`401`/`403` should map to a distinct state (`unauthorized`) with `reachable: pass, functional:
unknown` and an operator-facing "credential not accepted" note — the actionable message the current
green hides.

### OPS-14 — MEDIUM — "OpenAPI for every integrated service" is a hand-maintained list of 12 out of 43
Persona: full-stack engineer

`/operations/api-docs` renders `SERVICE_SPECS` under the claim *"OpenAPI for **every integrated
service**, through one authed surface"* (`operations/api-docs/page.tsx:52-54`). `SERVICE_SPECS`
(`src/lib/service-specs.ts:19-32`) is a hand-written array of **12** entries; the service registry has
**43**. A new service is picked up by nothing here — it just silently isn't in the list, and there is
no reconciliation issue raised the way `reconcileServiceInventory` raises `platform-count`
(`service-inventory.ts:345`). Either derive the rows from the registry and mark spec-less services
explicitly, or change the copy to "services with a published spec (12 of 43)".

Concrete drift already present: `resolveSpecUrl` reads `OFFGRID_PRESIDIO_URL`
(`service-specs.ts:27`), while the service registry *prefers* `OFFGRID_PRESIDIO_ANALYZER_URL` and
falls back to `OFFGRID_PRESIDIO_URL` (`services-directory.ts:198-201`). A deployment that sets only
the ANALYZER var — the documented one — has a healthy Presidio on the services page and a
"not configured" spec on api-docs. Two files, one fact.

### OPS-15 — MEDIUM — node inventory failure returns an empty list and discards the reason
Persona: technical operator / SRE (rule 6: failure must never present as emptiness)

```ts
// src/app/api/v1/gateway/nodes/route.ts:31-36
if (!r.ok) return NextResponse.json({ available: false, nodes: [], support: actionSupport() });
...
} catch { return NextResponse.json({ available: false, nodes: [], support: actionSupport() }); }
```

The `available: false` flag is the right instinct — but the **reason is thrown away in both arms**.
The aggregator answering `401` (wrong `OFFGRID_GATEWAY_KEY`), the aggregator being dead, a DNS name
that no longer resolves, and a 15s timeout all produce the identical byte-for-byte response. That is
the same failure mode as the known-true `data-quality` 502-with-no-backend case: the operator is told
"unavailable" and given nothing to act on. Return the upstream status and `err.cause.code` (the repo
already has this lesson recorded) so the surface can say *"the gateway refused our key (401)"* instead
of a shrug.

**Credit where due:** the rest of the backups module is the honesty standard the rest of this section
should be held to. `serviceControl()` (`services-directory.ts:511`) names who owns each lifecycle
instead of showing a dead Restart button; `readScheduleStatus` (`backups.ts:246`) documents that an
unprivileged `launchctl list` failure is NOT "not scheduled" and corroborates from artefacts instead
of asking for sudo; the console refuses one-click destructive restore and hands over a
copy-pasteable command; and a missing drill record reports **NEVER REHEARSED** rather than health
(`backups.ts:334`, `dr-drill.ts`). That is exactly rule 1 (deployment-owned, and it says so).

