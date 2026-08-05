# Gateway (registry / services / fleet) — audit findings

Team: AI Engineer · Technical operator · CISO + Principal UX / UI / Usability / QA / QC.
Scope: `src/app/(console)/gateway/**` and its canonical mounts under `/runtime/gateways`,
`/operations/services`, `/operations/devices`.
Status: **complete**.

## Top 5, ranked

1. **`src/lib/gateways.ts:325-331` — cloud gateway health ignores the HTTP status entirely.** A revoked key, 403, 404, 500 or an interception page yields `status:'up'` + `available:true`, under UI copy saying the probe is "never faked".
2. **`src/lib/gateways.ts:305-313` — a gateway renders green "up" and the string "N of N nodes up" when EVERY node is degraded**, because degraded nodes are counted in `up` and then compared against `total`.
3. **No egress enforcement exists anywhere.** `egressClassFor` feeds only badges and `<select>` labels; `pipelines.ts:330,403` bind any gateway to any pipeline with no residency check. The only egress-aware code is a *preference sort* that explicitly falls through to cloud (`eval-judge.ts:150-153`). "Data stays on-prem" is a label.
4. **`gateway/fleet/[id]/page.tsx:145` calls a data-plane WRITE during a GET render** (`store.ts:466-469`) — setting `status:'online'`, `lastSeen:'just now'` and the policy version, org-unscoped and unaudited. The page then renders that status as a green badge. Viewing the page manufactures the evidence the page displays.
5. **`registry/page.tsx:22` + `GatewaysManager.tsx:416-422` — a DB/probe failure renders as "No gateways registered yet."** `withTimeout` collapses reject and timeout into the same `[]`; the surface has no ERROR, PARTIAL or retry state.

---

## 0. Route topology

`gateway/*` files are the implementation; canonical routes re-export them (`runtime/gateways/page.tsx:1`,
`operations/services/page.tsx:1`, `operations/devices/page.tsx:1`, and the `[id]` variants).

### [MAJOR] Every `/gateway/*` URL is a live duplicate mount with no redirect — a one-way trapdoor
**Persona:** Principal UX
**Where:** `GatewaysManager.tsx:102,152`; `GatewayDetail.tsx:321`; `ServicesDirectory.tsx:67`; `gateway/fleet/[id]/page.tsx:170`
**What:** All in-page links point at the canonical space. Landing on `/gateway/registry` and clicking a card sends you to `/runtime/gateways/{id}`; the detail's back-link goes to `/runtime/gateways`. You can enter the `/gateway/*` prefix and never navigate within it. Two URLs render identical content with no canonicalization.
**Fix:** Redirect `/gateway/{registry,services,fleet}` to the canonical routes, as `gateway/ai` and `gateway/edge` already do.

## 1. Health truth

### [BLOCKER] Cloud gateway health proves TCP/TLS and "some bytes came back" — nothing else
**Persona:** AI Engineer / CISO
**Where:** `src/lib/gateways.ts:325-332`
**What:** `probeCloud` does `await fetch(...)` then `return true` — **no `res.ok`, no status inspection**. 401, 403, 404, 429, 500, a redirect chain, a captive-portal page → `reachable: true`, `status:'up'`, `detail:'provider reachable'` (`:354-360`). `configured` is env-var presence only (`cloud-providers.ts:224-236`). So `available = enabled && configured && reachable` (`gateways-policy.ts:142`) renders green "up" + "available" for a gateway whose API key is expired, revoked or over quota. The comment at `:324` admits this; the UI copy contradicts it — `GatewayDetail.tsx:136-137` "Health is the strict probe truth — never faked", `GatewaysManager.tsx:37-38` "we never invent a green dot the probe didn't earn."
**Fix:** Classify the status. 401/403 = *reachable but not authorized* — precisely the state the badge must distinguish.

### [MAJOR] Cloud gateways probe the WRONG URL — the row's `baseUrl` is decorative
**Persona:** AI Engineer
**Where:** `src/lib/gateways.ts:341-354`
**What:** Health resolves by `gatewayKindToProviderId(kind)` and probes the **env-configured** provider base URL, not `row.baseUrl`. A `compat` row showing `https://openrouter.ai/api/v1` (`gateways-seed.ts:62-67`) has its health decided by a different host; two `openai`-kind gateways with different `baseUrl`s report byte-identical health.
**Fix:** Probe the row's own `baseUrl`.

### [BLOCKER] "Up" is rendered when EVERY node is degraded
**Persona:** Technical operator
**Where:** `src/lib/gateways.ts:305-313`, `rollupNodeStatus` `:284-288`
**What:** `up = nodes.filter(n => n.health === 'up' || n.health === 'degraded').length`. Three all-degraded nodes ⇒ `up=3`, `total=3` ⇒ `up === total` ⇒ status **`'up'`**, green badge, `detail: "3 of 3 nodes up"` — a literal false statement.
**Fix:** Count only `up` for the numerator; surface degraded separately.

### [MAJOR] Nothing anywhere issues an inference; no badge covers serving
**Persona:** AI Engineer
**Where:** `src/lib/gateways.ts:292` (`/nodes` via `gatewayControlFetch`), node health from the aggregator's windowed error-rate verdict (`gateway.ts:32-41`)
**What:** No chat/completion is attempted by any code in this module. The on-prem "up" badge proves the aggregator's control API answered and lists ≥1 node it *believes* is up-or-degraded — a second-hand claim, structurally **stale by up to `windowMs`** — rendered as current truth under "Health is the strict probe truth".
**Fix:** Add a "test completion" action (see CRUD gap below) and label the badge as control-plane reachability.

### [MAJOR] Model availability is satisfiable by a stale tag
**Persona:** AI Engineer
**Where:** `GatewayDetail.tsx:261-280`, caption `:517`
**What:** The "Model catalog" is built from each node's **configured active-model tag**, captioned "Models this fleet serves (reconciled against live node routing tags)". A node whose weights failed to load still advertises its tag ⇒ the model is listed as served. No completion verifies it.
**Note on caching:** `gateway.ts:430-434` hardcodes "The router does not cache responses. There is no cache TTL to tune." while `src/lib/litellm-cache.ts` documents a live response cache surfaced at `/runtime/models/cache`. **Two surfaces can simultaneously tell an operator there is no response cache and show them their response cache.** No gateway health claim is itself served from that cache, but every latency figure in the module is a *health-endpoint* latency presented next to inference-serving language.

### [BLOCKER] "Up" is `httpStatus < 500`, and "healthy" includes services that are absent
**Persona:** Technical operator / CISO
**Where:** `src/lib/status.ts:30`, `src/lib/service-health.ts:15-17`, `services-directory.ts:455-458`
**What:** 401, 403, 404 and 3xx are all `up`. `isHealthy` returns `status !== 'down'`, so `'optional'` counts as healthy — and `resolveHealth` maps an *unreachable* optional service to `'optional'`, never `'down'`. Concretely: `llm-guard` is `probe:'optional'` with fallback "content guardrails not configured — requests report unscreened" (`:78-84`), so **a completely absent guardrail service counts toward the green numerator**; a dead LiteLLM router counts as non-failing (`:85-96`). Rollup `status.ts:109-113` returns `'operational'` when `healthy === total`. `withLiveReachability` (`ServiceReadiness.tsx:42-46`) promotes **Reachable to `pass`** on a 401/404/302, and `service-readiness-probe.ts:24-38` promotes **`functional: 'pass'`** from a 401 with summary "Live health probe returned healthy" — directly under `ServiceDetail.tsx:269` "A gate is only green when registered evidence proves it."
**Fix:** In progress in `src/lib/status.ts` (an `unverified` state + per-entry `expectStatus`). Also stop counting `optional` as healthy in the numerator, and stop promoting `functional` from a status code.

### [MAJOR] The probed hosts are Off Grid's own production domains, hardcoded
**Persona:** Full-stack engineer
**Where:** `services-directory.ts:40`, `:49`, `:58`; override path `:403-412`
**What:** `https://onprem-console.getoffgridai.co` (healthPath `/signin`), `https://ai.getoffgridai.co`, `https://gateway.getoffgridai.co`. Overridable only wholesale via `OFFGRID_SERVICES` JSON, and a **malformed** value silently falls back to these defaults. A self-hosted deployment renders somebody else's uptime as its own; the console's own badge is "the sign-in page rendered".
**Fix:** Derive from the deployment's own config; fail loudly on malformed `OFFGRID_SERVICES`.

## 2. Egress leash — see Top 5 #3

Full consumer list of the registry (`getGatewayRow|listGatewayRows|listGatewaysWithHealth|getGatewayWithHealth`): rendering, CRUD, a display projection in `pipelines.ts:171-173`, and a preference ordering in `eval-judge.ts:146-155` that falls through to a cloud gateway. Every other `egressClass` reference is a badge or a `<select>` label. The mechanism that *does* leash — `decideRouting(..., egressAllowed)` in `routing-policy.ts:49-79` — is a **separate axis** keyed off the device/org policy bundle and never reads `gateway.egressClass`. `ORG_POLICY_DEFAULTS.maxEgress` ("the core data-residency lock") is not joined to gateway selection anywhere.

## 3. CRUD completeness

| Surface | C | U | D | Missing |
| --- | --- | --- | --- | --- |
| registry | ✅ | ✅ URL-driven sheet, partial PATCH | ✅ | **No "test connection" / test completion** — the one action that would make the health badge mean something. No per-gateway credential management on the detail page. Delete uses `window.confirm` with no name-typing despite warning that bound pipelines break. |
| services | ❌ | ❌ | ❌ | Read-only **by design and honestly labelled** (`serviceControl`, `ServiceDetail.tsx:135` — no dead Restart button). Best-behaved surface in the module. |
| fleet (list) | ❌ | ❌ | ❌ | **Zero interactive elements.** `EnrollDeviceButton.tsx` (107 lines) and `FleetTools.tsx` (456 lines) are fully implemented and **mounted nowhere** — dead code. |
| fleet (detail) | ❌ | ✅ role reassign | ❌ no unenroll | lock/unlock/wipe rendered disabled "Coming soon" and hard-gated — honest. Audit hard-limited to 25 with no pagination. |

### [MAJOR] The seed route writes into another tenant unconditionally
**Persona:** CISO
**Where:** `src/app/api/v1/admin/gateways/seed/route.ts:16,24`
**What:** `const SEED_ORGS = ['org_bharat']` — every seed call writes gateway rows into `org_bharat` **in addition to** the caller's org, regardless of who calls.

## 4. The fleet pages

### [BLOCKER] The detail page WRITES on GET and manufactures its own "online" badge — see Top 5 #4
Additionally: **no link to either fleet detail route exists anywhere in the app** (grep returns only a code comment), the list renders no clickable rows, and the detail's back-link goes to the coming-soon list — a dead end. On a fresh install the `devices` table is empty (the only `insert(devices)` is enrollment; no seed exists) so the route 404s for every id. `getMdm()` is used only for a capability flag, and its FleetDM branch is **unreachable in practice**: `page.tsx:153` gates on numeric FleetDM host ids while `:142` resolves the id against the native `devices` table, so it 404s before the FleetDM branch can render.

### [MAJOR] Two adjacent routes in one module make opposite claims about whether device management exists
**Where:** `gateway/fleet/page.tsx:64-66`, `:99-102`, `modules/registry.ts:127-146` (`comingSoon: true`) vs the detail route's live device facts, live policy bundle, live audit table, working kill switch and working role reassignment.

## 5. Missing states

- **[BLOCKER]** registry: `withTimeout(..., 5000, [])` resolves the fallback on **timeout AND rejection** (`with-timeout.ts:26-28`), so a DB outage, a schema failure, a wedged aggregator or a 5s overrun all render "No gateways registered yet. Add one, or seed the samples…" — an infrastructure failure stated as a fact about the registry's contents, with an instruction to create data that already exists. No ERROR, PARTIAL or retry state exists on this surface. `registry/page.tsx:18` also claims a `loading.tsx` skeleton that **does not exist** for the list.
- **[MAJOR]** services list: `if (!res.ok || !alive) return;` (`ServicesDirectory.tsx:136-144`) and `catch { }` leave `health = {}`, so every card renders `<Spinner/> checking` **forever**, re-polling every 30s. A permission-denied is visually identical to still-loading. Same on the detail page (`ServiceDetail.tsx:52`, `:64`) → "Live probe: Checking", "Latency: —", "Collecting first sample…" indefinitely. `WorkerReadinessPanel.tsx:31-38` and `DeviceSoftware.tsx:31-33` do this correctly — the pattern is known and simply not applied to the two primary surfaces.
- **[MAJOR]** `ServiceDetail.tsx:81` `uptimePct` counts `status !== 'down'` as up, so `optional`/absent services show **100% uptime**.
- **[MAJOR]** `GatewayDetail.tsx:459` — a failed pipelines query (`.catch(() => [])`) renders as "0 pipelines bound" + "No pipelines are bound to this gateway yet", and that number is used to justify deleting the gateway.
- **[MINOR]** permission-denied is deliberately indistinguishable from 404 (`module-access.ts:17-22`, documented) — intentional, but it means no surface here has a permission-denied state.
- **[MINOR]** no `error.tsx` anywhere under `gateway/**`.

## 6. URL-driven navigation

**Correct:** `GatewaysManager.tsx:341-354` (`?panel=`), `ReassignPolicyButton.tsx:31`, `EnrollDeviceButton.tsx:19`, `FleetTools.tsx:33`, `RedpandaManager.tsx:47,69,72,101-111`.

**`useState` bugs:**
- **[MAJOR]** `GatewayDetail.tsx:217` — the Endpoint card's provisioned/unprovisioned MODE is local state seeded from a prop; the component is not keyed on `gateway.id`, so a client-side nav between two gateway details carries the previous gateway's hostname into the new view. Which card face you see is not in the URL.
- **[MAJOR]** `GatewayDetail.tsx:259` — the Model catalog's content is local state overwritten by an effect whose failure path silently keeps the static baseline; the user cannot tell reconciled-live from static, and cannot link to either.
- **[MINOR]** `GatewayDetail.tsx:105-109` NodePool state re-probes and re-flashes "Probing the fleet…" on every Back.
- **[MAJOR]** deep-linking `?panel=edit-gateway&id=X` where `X` is absent from a timed-out list yields `editTarget = null` and the sheet **silently opens in CREATE mode** with a "Create gateway" button.

## 7. OSS engine names in rendered copy

`RedpandaManager.tsx:252` ("Redpanda operations"), `:524`, `:79`; **`ServiceDetail.tsx:250` renders raw `dependency.serviceId`** so `postgres`, `redis`, `opensearch`, `litellm`, `keycloak`, `temporal`, `langfuse`, `openbao`, `qdrant` appear verbatim as user-facing chips; `services-directory.ts` labels/descriptions name LiteLLM (`:87`, `:95`), LanceDB (`:205`), Qdrant (`:207`), Redis (`:217`), SeaweedFS (`:230`), Keycloak (`:232`), Open Policy Agent (`:155`), Caddy (`:57`), OpenLineage (`:173`), Prometheus (`:363`), pgvector (`:29`), LLM Guard (`:38`); `gateway/fleet/page.tsx:82` renders `'FleetDM (osquery)'` and `:100` hardcodes it in copy; `DeviceSoftware.tsx:49` "From FleetDM / osquery".
`GatewaysManager.tsx:30-35` is clean (OpenAI/Anthropic are vendor names the operator chose).

## 8. Layout — clean

No whole-page `mx-auto max-w-{2,3,4}xl` bug in this module. Page roots are correctly `w-full`. Every `max-w-*` present is a prose clamp on a single paragraph or an empty-state block — including `gateway/fleet/page.tsx:67`, which wraps only a heading + one paragraph inside the left half of a flex row and is **not** a bug.
