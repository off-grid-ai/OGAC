# Gateway Deep Audit

**Date:** 2026-07-02  
**Scope:** `/Users/user/wednesday/off-grid-ai/gateway/src/` — all source files read in full.  
**Purpose:** Comprehensive ground-truth audit of what the gateway actually does today vs. what CLAUDE.md says it must become.

---

## 1. What the Gateway Does TODAY vs. CLAUDE.md Aspirations

### What Is Actually Built (Production-Ready Code)

The gateway ships two distinct CLIs from one codebase:

**A. Single-node gateway (`src/cli.ts`, `src/index.ts`)**

The `offgrid-gateway` CLI (bin: `./dist/cli.js`) runs on port 7878. It is v0.1 and extremely thin. It serves exactly two routes:

- `GET /healthz` — returns `{ ok: true, version }` (`cli.ts:32-35`)
- `GET /v1/models` — reads `.gguf`, `.bin`, `.onnx` files from `modelsDir()` and returns an OpenAI-compatible list (`cli.ts:36-39`)

Every other request returns 501 with: `"handler migrating from desktop runtime — see README"` (`cli.ts:41`). The README confirms this explicitly: "The OpenAI-compatible inference handlers (chat/vision/image/audio/embeddings) are migrating from the desktop runtime; until then the standalone server exposes `/healthz` and `/v1/models`." (`README.md:43-44`).

The `runtime-env.ts` seam is fully built and works. It resolves data dirs, model dirs, bin roots, and resource dirs across Electron (embedded) and standalone (Node/Docker) contexts, with lazy Electron detection via `require('electron')` and env-var fallbacks (`runtime-env.ts:27-128`).

**B. Cluster gateway (`src/cluster-cli.ts`, `src/cluster/server.ts`)**

The `offgrid-gateway-cluster` CLI (bin: `./dist/cluster-cli.js`) runs on port 8800. This is substantially more built-out. It is what the console actually talks to. It includes:

- Multinode pool routing with true inference health
- In-process admission control (backpressure)
- Plug-and-play observability sinks (OpenSearch, Langfuse, stdout)
- A composable policy pipeline (pre/post hooks)
- Keycloak JWT validation (no external deps)
- A built-in HTML dashboard served at `/`
- Model-management control plane proxying to per-node APIs
- Configuration schema with live-reload for some settings
- A `/tokens` endpoint for enterprise client token passthrough visibility

**C. Temporal queue subsystem (`src/queue/`)**

Fully typed and wired. The `@temporalio/*` packages are in `dependencies` (`package.json:37-41`). The queue has a client, worker, workflow, and activities layer. It is exposed as a separate subpath export (`./queue`) specifically to avoid dragging Temporal into bundles that only need the core cluster gateway.

### What CLAUDE.md Says Must Exist But Does NOT

From `CLAUDE.md:83-91`, the document is explicit about what is missing:

> **NOT yet built:** the config-driven module registry (`defineOffgrid`, the manifest contract), per-module UIs as shared React components, the `@offgrid/authz` provider seam. A raw-HTML dashboard was hacked onto the gateway and should be removed in favor of module UIs rendered by the host. Today's modules are logic-only; the UI + registry work is the path to the target above.

Concretely absent:

1. **`defineOffgrid()`** — the top-level config-driven composition root described in `CLAUDE.md:18-31`. No such function exists anywhere in `src/`. The config object shown in CLAUDE.md (`auth: localAuth()`, `modules: [analytics(), finops(), vectordb()]`) has no implementation.

2. **Module manifest contract** — the `{ id, nav, routes, settingsPanel, gatewayHooks: { sinks?, policies? }, integrations, requires:[perms] }` shape described in `CLAUDE.md:32-37`. No `manifest` type or module registry exists in `src/`.

3. **Per-module React UIs** — modules as described should export their own UI components. The `dashboard.ts` is a single self-contained static HTML page (104 lines of inline HTML/CSS/JS — `dashboard.ts:10`). CLAUDE.md explicitly calls this out as something to remove.

4. **`@offgrid/authz` provider seam** — the auth abstraction that would let `localAuth()` swap for `keycloakAuth()` via config. The current implementation hardwires Keycloak config from env vars; there is no auth provider factory/seam.

5. **`@offgrid/policy` package** — `CLAUDE.md:87` says "concrete policies — guardrails, rate limits, budgets, caching — ship as the @offgrid/policy package". The `src/policy/` directory has the interface (`types.ts`) and two built-in policies (`client-auth.ts`, `keycloak-auth.ts`) but no external `@offgrid/policy` package.

6. **Single-node inference handlers** — `/v1/chat/completions`, `/v1/images/generations`, `/v1/audio/*`, `/v1/embeddings` on the standalone gateway are all 501. They are described as "migrating from the desktop runtime" (`cli.ts:7-8`).

---

## 2. Cluster Router: All Exposed Endpoints

All routing lives in `server.ts`. The server's `handleRequest` function dispatches by URL pattern (`server.ts:216-550`). Auth (`checkAuth`) applies to everything except `/healthz`.

### Management & UI Routes

| Route | Method | What it does |
|---|---|---|
| `GET /healthz` | GET | Returns `{ ok: true }`. Bypasses auth. (`server.ts:555`) |
| `GET /` (browser) | GET | Serves `DASHBOARD_HTML` — the built-in terminal-aesthetic status page polling `/traffic`. (`server.ts:218-221`) |
| `GET /dashboard` | GET | Same as `/` browser path — the built-in dashboard. (`server.ts:218-221`) |
| `GET /` (API) | GET | Returns `poolInfo()`: pool name, `openai_compatible:true`, `base_url`, merged modalities, per-node health. (`server.ts:222-223`) |
| `GET /health` | GET | Same as `GET /` — returns `poolInfo()`. (`server.ts:222-223`) |
| `GET /traffic` | GET | Returns `trafficJSON()`: since-timestamp, pool snapshot, per-node stats (requests/errors/tokens/avgMs/inflight/queued/peakInflight), rolling 2000-record log with full per-request detail. (`server.ts:224`) |
| `GET /traffic.json` | GET | Alias for `/traffic`. (`server.ts:224`) |
| `GET /tokens` | GET | Lists `TokenStore.list()` if `client-auth` policy is wired; else `[]`. Exposes enterprise client token metadata (preview, inferred provider, IPs, use counts). (`server.ts:225-228`) |
| `GET /config` | GET | Returns `GATEWAY_CONFIG_SCHEMA` (all 18 known env keys) with current live values; secrets masked as `***`. (`server.ts:234-241`) |
| `POST /config` | POST | Applies `{ settings: Record<string, string> }` to `process.env`. Live-reload keys (5 of 18) take effect immediately. Returns `{ ok, applied, restartRequired }`. (`server.ts:242-266`) |
| `GET /v1/models` | GET | Returns deduplicated pool model list, each with `capabilities: ['text'] | ['text','vision']` and `gateways` list. (`server.ts:267-273`) |
| `GET /nodes` | GET | Aggregates per-node model info via `clusterModels.nodeModels()`: reachable, active model, installed list, catalog count, health. (`server.ts:279-288`) |
| `POST /nodes/:name` | POST | Dispatches model management actions to a named node: `activate`, `unload`, `pull`, `delete`, `settings`. (`server.ts:289-319`) |

### OpenAI-Compatible Proxy Routes

Everything not matched above falls through to the proxy handler (`server.ts:321-549`). The gateway passes the full path through verbatim:

```
req.url → target node at http://${target.host}:${target.port}${req.url}
```
(`server.ts:420-425`)

This means `/v1/chat/completions`, `/v1/completions`, `/v1/images/generations`, `/v1/embeddings`, and any other path the upstream nodes support are proxied. The cluster gateway itself adds:

- Model + modality routing (Router picks a node)
- Admission control (AdmissionLimiter gate)
- Policy pipeline (pre/post hooks)
- Response body capture for traffic logging
- Streaming detection and SSE-aware token counting
- `x-offgrid-gateway` and `x-offgrid-model` response headers
- `X-Forwarded-For` pass-through

The only route that explicitly works at the cluster layer from an OpenAI perspective is `GET /v1/models` (handled directly, `server.ts:267-273`). All others require a node behind the pool to actually implement them.

---

## 3. Queue Subsystem (`src/queue/`)

### What It Is

A durable async inference layer for AI workflows (batch jobs, agent runs, long generations). It is NOT the sync chat path — that is the cluster gateway with `AdmissionLimiter`. The comment in `limiter.ts:12-13` states this explicitly: "Durable, retryable QUEUED inference (batch, agents, long generations) belongs on Temporal — a separate async layer whose worker concurrency is its own backpressure — not here."

### Architecture

Four files, each with a clear role:

**`queue/types.ts`** — three interfaces:
- `QueuedInferenceRequest`: an OpenAI-compatible chat body + optional caller/corrId
- `QueueResult`: HTTP status, parsed body, wall-clock ms
- `QueueConfig`: Temporal address, namespace, task queue, maxConcurrentPerNode, maxAttempts, gatewayUrl

**`queue/workflow.ts`** — the Temporal workflow. Deterministic, no I/O. Calls `proxyActivities<typeof activities>` with `startToCloseTimeout: '10 minutes'`, `scheduleToCloseTimeout: '1 hour'`, and exponential retry up to `maxAttempts` (`workflow.ts:22-37`). Note: this file must NOT be bundled by tsup — Temporal's own bundler handles it.

**`queue/activities.ts`** — one activity: `runInference`. POSTs to `${OFFGRID_QUEUE_GATEWAY_URL}/v1/chat/completions`. Throws on non-2xx so Temporal retries. No node pool logic — it treats the cluster gateway as a black box (`activities.ts:21-50`).

**`queue/worker.ts`** — `startQueueWorker()`. Uses `@temporalio/worker`. The key: `maxConcurrentActivityTaskExecutions: cfg.maxConcurrentPerNode` (default: 2) is the actual backpressure cap (`worker.ts:77`). Resolves the workflow file path with a probe across four candidates to handle tsup output layouts (`worker.ts:27-35`).

**`queue/client.ts`** — `enqueueInference()` and `getResult()`. Uses `@temporalio/client`. Caches the `Connection` + `Client` by address/namespace. Workflow IDs are `inf-${corrId ?? cryptoRandom()}` (`client.ts:35`).

### Is Temporal Actually Wired?

Yes — `@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow`, and `@temporalio/activity` are all in `package.json:37-41` as runtime `dependencies` (not devDependencies). The code fully imports and uses them.

In the console, `src/lib/agentrun.ts:103` does:
```ts
const { enqueueInference, getResult } = await import('@offgrid/gateway/queue');
```
This is gated by `OFFGRID_QUEUE_ENABLED === '1'` (`agentrun.ts:85`). It falls through to a direct fetch if the queue is unavailable. Temporal is a running dependency for agent runs when enabled — it is not aspirational scaffolding.

The Temporal server address defaults to `localhost:7233` (`worker.ts:41`). There is no Temporal container in `docker-compose.yml` — the operator must supply their own Temporal instance.

---

## 4. Policy Pipeline

### Interface (`src/policy/types.ts`)

Three types + two runner functions:

- **`PolicyContext`** — mutable per-request object. Fields: `caller`, `corrId`, `model`, `image`, `body` (mutable), `target` (mutable — a policy can reroute), `candidates`, `deny?`, `shortCircuit?`, `meta`, `clientIp`, `clientToken?`, `clientId?`, `clientScopes?`.
- **`PolicyOutcome`** — what post hooks see: `status`, `output`, `promptTokens`, `completionTokens`, `streamed`, `raw?`.
- **`Policy`** — `{ name: string; pre?(ctx): void|Promise; post?(ctx, outcome): void|Promise }`.

**`runPre()`** — iterates policies in order, stops on first `deny` or `shortCircuit`, swallows errors (fail open) (`types.ts:77-88`).  
**`runPost()`** — iterates all policies, swallows all errors (`types.ts:91-101`).

### Built-in Policies

**`policy/keycloak-auth.ts` — `keycloakAuth()`**

Runs as a pre hook. Flow:
1. If no Keycloak config (env vars absent) — pass through entirely.
2. Requires `Authorization: Bearer <jwt>`.
3. Validates JWT against Keycloak JWKS (via `KeycloakValidator`).
4. Parses scopes: `model:*`, `mode:*`, `tier:*`.
5. Extracts roles from `realm_access` and `resource_access`.
6. Puts identity on `ctx`: `clientId`, `clientScopes`, plus meta keys `keycloakSub`, `keycloakClient`, `keycloakEmail`, `keycloakRoles`, `keycloakTier`, `keycloakModelScopes`, `keycloakModeScopes`.
7. If `enforceScopes: true` (default: false) and model scopes are present, denies requests for models not in scope with 403.

`onFailure` defaults to `'deny'` (enforcing mode). Can be set to `'warn'` for migration (`keycloak-auth.ts:30`).

**`policy/client-auth.ts` — `clientAuth()`**

Runs as a pre hook (must run AFTER `keycloakAuth`). This is Mode B: the client authenticates to the gateway via Keycloak JWT AND supplies their own cloud-provider key in `x-provider-key`.

The policy:
1. Reads `x-provider-key` header (NOT `Authorization`).
2. Infers provider from token shape: JWT decode, then prefix matching for Anthropic (`sk-ant-`), OpenAI (`sk-proj-`, `sk-`), Google AI (`AIza`), AWS (`AKIA`), Azure (32 hex), Hugging Face (`hf_`), Cohere (`co-`), Mistral (32 alphanumeric) (`client-auth.ts:76-125`).
3. Stores each unique token in `TokenStore` (in-memory, FNV hash, capped at 500 entries, LRU eviction). Never stores the raw token — uses a preview (`first6…last4`) and a non-cryptographic hash for dedup.
4. Puts `ctx.clientToken` and meta `clientTokenPreview`, `clientTokenInferred` for observability.

**No other policies exist today.** CLAUDE.md references guardrails, rate limits, budgets, and caching policies — none are built in `src/`. These are deferred to a future `@offgrid/policy` package.

### How Policies Are Wired

Policies must be passed into `createClusterGateway({ policies: [...] })` via `ClusterOptions.policies`. The cluster CLI (`cluster-cli.ts`) passes no policies — it calls `createClusterGateway()` with no arguments. So in the standalone deployment, the policy pipeline runs with zero policies (pass-through). The console would need to import and wire policies explicitly when it calls `createClusterGateway`.

---

## 5. Observability Sinks

All sinks are in `src/cluster/observability.ts`.

### `stdoutSink()` (always active)

One log line per request to stdout:
```
[req] <ISO timestamp> <gateway> <model> <kind> <status> <ms>ms <bytes>b [tok=N]
```
(`observability.ts:77-87`)

### `openSearchSink(url, index)` (when `OFFGRID_OPENSEARCH_URL` is set)

Fire-and-forget `POST /${index}/_doc` with the full `TrafficRecord` plus `@timestamp` and `source: 'offgrid-gateway-cluster'` (`observability.ts:20-35`). Index defaults to `offgrid-gateway`, overridden by `OFFGRID_GATEWAY_INDEX`.

### `langfuseSink(baseUrl, publicKey, secretKey)` (when all three Langfuse env vars are set)

Fire-and-forget `POST /api/public/ingestion` with a batch of two events:
- `trace-create`: gateway, corrId metadata
- `generation-create`: model, modelServed, input (first 2000 chars of user prompt), output (first 2000 chars of completion), usage (promptTokens, completionTokens, total tokens), tps, finish reason, ms

(`observability.ts:38-74`)

### What Data `TrafficRecord` Captures

Full field list from `cluster/types.ts:28-64`:
- `ts`, `gateway`, `model`, `modelServed`, `kind` (text/image/embedding), `status`, `ms`, `bytes`
- `tokens`, `promptTokens`, `completionTokens`
- `tps` (tokens per second), `ttfb` (time-to-first-byte), `writeBlocked` (downstream backpressure count)
- `finish` (finish_reason), `toolCalls` (name + args, 400 char cap), `reasoning` (2000 char cap)
- `caller` (user-agent, 80 char), `corrId` (x-offgrid-run or x-request-id)
- `params` (temperature, maxTokens, topP, thinking flag, toolsOffered count)
- `msgs` (per-message role + text, 600 char cap each)
- `input` (last user turn, 2000 char cap), `output` (completion, 2000 char cap)
- `requestHeaders`, `responseHeaders` (only when `OFFGRID_RAW_HEADERS=true`)

The in-memory rolling log holds 2000 records (`capture.ts:10`). Per-node counters (requests, errors, totalMs, tokens) accumulate without bound.

---

## 6. Gateway-Console Relationship and :8800

### How the Console Uses the Gateway

The console does NOT embed or import `createClusterGateway` itself. The gateway runs as a **separate process** on port 8800. The console talks to it over HTTP via thin proxy API routes. Evidence:

**`console/src/app/api/v1/gateway/traffic/route.ts`** — proxies `GET /traffic` from the gateway. Uses `OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878'` (note: this file defaults to 7878, the single-node port — likely a bug or stale value; the cluster gateway is at 8800).

**`console/src/app/api/v1/gateway/config/route.ts:9`** — `const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:8800'`. Implements GET (merge DB overrides with live gateway config), POST (save to DB + push to gateway `/config`), DELETE (remove DB override). Uses `requireAdmin` auth. Sends `x-api-key` header.

**`console/src/app/api/v1/gateway/nodes/route.ts:10`** — `const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:8800'`. Proxies `/nodes` and `/nodes/:name`.

**`console/src/lib/agentrun.ts:28`** — `const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878'`. Agent runs POST to `/v1/chat/completions` directly (or via Temporal queue). The 7878 default here suggests agent runs target the single-node gateway unless `OFFGRID_GATEWAY_URL` is overridden.

The one place `@offgrid/gateway` is imported as a package is `agentrun.ts:103`:
```ts
const { enqueueInference, getResult } = await import('@offgrid/gateway/queue');
```
This is a dynamic import of the Temporal queue subpath — it does NOT import cluster server code.

### How :8800 Is Started

The Caddy edge config (`deploy/Caddyfile`) has:
```
http://gateway.getoffgridai.co {
  reverse_proxy 127.0.0.1:8800
}
```
The `setup.sh` confirms: gateway Macs run Off Grid Desktop headless natively (can't containerize on macOS for Metal inference). The cluster CLI is launched manually or via the setup script over SSH. There is no Docker container for the gateway in `docker-compose.yml`.

The gateway binds `0.0.0.0:8800` by default (`server.ts:139`). In practice, the single Mac at 127.0.0.1 runs both the console (port 3000) and the cluster gateway (port 8800).

---

## 7. What Is Completely Missing vs. CLAUDE.md

### Architecture-Level Gaps

| Feature | CLAUDE.md Reference | Status |
|---|---|---|
| `defineOffgrid()` composition root | `CLAUDE.md:18-31` | Not built |
| Module manifest contract (`{ id, nav, routes, settingsPanel, gatewayHooks }`) | `CLAUDE.md:32-37` | Not built |
| Per-module React UI components | `CLAUDE.md:32-37` | Not built |
| `@offgrid/authz` provider seam | `CLAUDE.md:88` | Not built |
| `@offgrid/policy` external package | `CLAUDE.md:87` | Not built |
| Module registry (auto-mounts nav/routes/settings) | `CLAUDE.md:38-42` | Not built |
| Config-only module composition (`add one line → done`) | `CLAUDE.md:42-44` | Not built |

### Single-Node Gateway Gaps

| Feature | Status |
|---|---|
| `/v1/chat/completions` on standalone | 501 — `cli.ts:41` |
| `/v1/images/generations` | 501 |
| `/v1/audio/*` (TTS, transcription) | 501 |
| `/v1/embeddings` | 501 |
| `/v1/completions` | 501 |
| Model loading/activation API | Not in cli.ts |

### Policy Gaps

| Policy | CLAUDE.md / Code Reference | Status |
|---|---|---|
| Rate limiting | `types.ts:9` comment | Not built |
| Token budget enforcement | `types.ts:9` comment | Not built |
| Prompt caching / short-circuit | `types.ts:9` comment | Not built |
| Guardrails / PII redaction | `types.ts:9` comment | Not built |

---

## 8. OpenAI-Compatible Surface — Which `/v1/*` Routes Actually Work

### On the Cluster Gateway (`:8800`) — Directly Implemented

- `GET /v1/models` — works, returns pool model list (`server.ts:267-273`)

### On the Cluster Gateway (`:8800`) — Proxied (Works if Upstream Supports It)

ALL other `/v1/*` routes are passed through verbatim to whatever node the router picks. These work only if the backend node (running on `:7878`) implements them:

- `POST /v1/chat/completions` — the primary path; the gateway adds routing, backpressure, policies, traffic capture
- `POST /v1/completions`
- `POST /v1/images/generations`
- `POST /v1/embeddings`
- `POST /v1/audio/transcriptions`
- `POST /v1/audio/speech`
- Any other OpenAI-compatible path

The proxy is path-transparent: `path: req.url` (`server.ts:424`). The gateway does NOT strip or rewrite paths.

### On the Single-Node Gateway (`:7878`) — Implemented

- `GET /healthz` — works (`cli.ts:32`)
- `GET /v1/models` — works (filesystem scan) (`cli.ts:36`)
- Everything else → 501

### Summary

Today, the only `/v1/*` route the gateway **itself** implements end-to-end is `GET /v1/models`. The chat/image/embedding/audio routes depend entirely on upstream node implementations. The cluster gateway is a transparent proxy with intelligence layered around it — it is not itself an inference engine.

---

## 9. Keycloak Integration

Keycloak validation is implemented in two places: `src/cluster/keycloak.ts` (the validator) and `src/policy/keycloak-auth.ts` (the policy wrapper).

### `KeycloakValidator` (`cluster/keycloak.ts`)

Pure Node crypto — no external deps. Implements:

1. **JWKS fetching** — `GET ${issuer}/protocol/openid-connect/certs` with 5s timeout. (`keycloak.ts:76`)
2. **Key caching** — 10-minute TTL, keyed by `kid`. On unknown `kid`, triggers a fresh fetch (key rotation support). Single in-flight fetch deduplication via a `Promise` reference. (`keycloak.ts:88-96`)
3. **JWT verification** — three-part split, base64url decode, cheap claim checks first (expiry, issuer, audience/azp), then crypto signature verify. (`keycloak.ts:99-132`)
4. **Algorithm support** — RS256, RS384, RS512 (RSA PKCS1v15), PS256/384/512 (RSA-PSS), ES256/384/512 (EC). (`keycloak.ts:122-129`)
5. **Singleton cache** — one `KeycloakValidator` per `url|realm|clientId` string, shared across requests. (`keycloak.ts:137-141`)
6. **Env-var config** — `OFFGRID_KEYCLOAK_URL`, `OFFGRID_KEYCLOAK_REALM`, `OFFGRID_KEYCLOAK_CLIENT_ID`. (`keycloak.ts:145-150`)

### Gateway-Level Auth Gate (`server.ts:202-213`)

Separate from the policy pipeline. The static API key check + Keycloak JWT check runs on every non-`/healthz` request when either `OFFGRID_GATEWAY_API_KEY` or Keycloak config is set. This is an OR gate: a valid static key OR a valid Keycloak JWT passes. (`server.ts:203-212`)

This gateway-level check is coarser than the policy-level `keycloakAuth()` — it just validates the JWT, it does not extract scopes or enforce model access.

### Policy-Level `keycloakAuth()` (`policy/keycloak-auth.ts`)

Runs only if wired into `ClusterOptions.policies`. Provides:
- Scope parsing (`model:*`, `mode:*`, `tier:*`)
- Role extraction from `realm_access` and `resource_access`
- Full identity population on `PolicyContext` for observability and downstream policies
- Optional scope enforcement (`enforceScopes: false` by default)
- Configurable failure mode (`'deny'` vs `'warn'`)

In the standalone cluster CLI, this policy is NOT wired (no policies are passed). The gateway-level check still applies if env vars are set.

---

## 10. Admission Control / Backpressure Limiter

### `AdmissionLimiter` (`cluster/limiter.ts`)

In-process, no external dependencies. Per-node concurrency cap with bounded wait queue.

**Configuration** (all have env defaults):
- `maxConcurrentPerNode` — default 2 (`OFFGRID_MAX_CONCURRENT_PER_NODE`): max requests a node serves simultaneously. Before this, requests are immediately forwarded. (`limiter.ts:27`)
- `maxQueuePerNode` — default 24 (`OFFGRID_MAX_QUEUE_PER_NODE`): max requests waiting for a slot. Beyond this, the limiter throws `Saturated`. (`limiter.ts:28`)
- `acquireTimeoutMs` — default 30000ms (`OFFGRID_QUEUE_TIMEOUT_MS`): how long a queued request waits before being rejected with `Saturated`. (`limiter.ts:29`)

**`acquire(name)`** (`limiter.ts:58-75`):
- If `active < maxConcurrentPerNode` → increment and resolve immediately.
- Else if `waiters.length >= maxQueuePerNode` → reject immediately with `Saturated`.
- Else → push a waiter with a timeout. Resolves when a slot is released.

**`release(name)`** (`limiter.ts:78-89`):
- If waiters exist → hand the slot to the next waiter (active count unchanged).
- Else → decrement active.

**`load(name)`** (`limiter.ts:104-107`): returns `active + waiters.length` — used by `Router.pickLeastLoaded()` to steer new requests away from saturating nodes before they jam.

### How It Integrates

In `server.ts:394-403`, after the policy pre-hooks pass:
1. `await limiter.acquire(target.name)` — blocks if node is full, fast-rejects if queue is full.
2. On `Saturated`: returns HTTP 503 with `Retry-After: 2` header and records the shed event in the traffic log.
3. `res.on('close', release)` ensures the slot is freed if the client aborts.

### Peak Tracking

`NodeState.peak` tracks the highest `active` count ever seen per node (`limiter.ts:44`). `limiter.peak(name)` exposes this. It is included in `NodeStats.peakInflight` and shown in the `/traffic` response — useful for capacity planning.

### Relationship to Temporal Queue

The limiter comment (`limiter.ts:12-13`) is explicit: this is the SYNC path guard. The Temporal queue is the ASYNC path for batch/agents. The two layers are independent: the limiter sheds synchronous requests when a node is overloaded, while the queue holds async requests durably until a worker slot opens. They are not connected.

---

## Appendix: Key File-to-Concept Map

| File | Primary Concept |
|---|---|
| `src/cli.ts` | Single-node gateway CLI (v0.1, mostly 501) |
| `src/cluster-cli.ts` | Cluster gateway CLI entrypoint |
| `src/index.ts` | Public API / package exports |
| `src/runtime-env.ts` | Electron vs. standalone path resolution |
| `src/cluster/server.ts` | Cluster gateway — all routes, proxy logic, auth gate |
| `src/cluster/router.ts` | Model+modality routing with round-robin |
| `src/cluster/health.ts` | True inference health (not just process liveness) |
| `src/cluster/capture.ts` | In-memory traffic log + sink fan-out |
| `src/cluster/limiter.ts` | Per-node concurrency cap + bounded wait queue |
| `src/cluster/keycloak.ts` | JWT validation against Keycloak JWKS |
| `src/cluster/models.ts` | Per-node model management API proxying |
| `src/cluster/observability.ts` | OpenSearch, Langfuse, stdout sinks |
| `src/cluster/dashboard.ts` | Built-in self-contained HTML status page |
| `src/cluster/types.ts` | All cluster-layer TypeScript interfaces |
| `src/policy/types.ts` | Policy interface + runPre/runPost runners |
| `src/policy/client-auth.ts` | Enterprise token passthrough + TokenStore |
| `src/policy/keycloak-auth.ts` | JWT scope extraction + model access enforcement |
| `src/queue/types.ts` | Queue request/result/config types |
| `src/queue/workflow.ts` | Temporal workflow (deterministic, no I/O) |
| `src/queue/activities.ts` | Temporal activity — POSTs to cluster gateway |
| `src/queue/worker.ts` | Temporal worker — backpressure via `maxConcurrentActivityTaskExecutions` |
| `src/queue/client.ts` | Temporal client — `enqueueInference` / `getResult` |

---

*All claims in this document are cited to specific file:line locations read directly from source.*
