# Off Grid — Unified Inference Control Plane

**Status:** Design (no code yet). **Date:** 2026-07-09.
**Mandate:** One package — `@offgrid/gateway` — owns the entire request path between "a request arrives" and "a response streams out." After this consolidation, **no gateway / routing / provider / tool-calling / queue / residency / budgeting / aggregator code lives in `desktop`, `console`, or `mobile`.** Each product becomes a thin host that injects its runtime specifics and imports everything else. Not necessarily shipped standalone — but the single source of truth.

This is a **gather, not a rewrite**: the best implementation of each concern already exists somewhere. We harvest each into the package and delete the forks.

---

## 1. The core idea

There is exactly one "inference control plane." It has eight concerns. Today each of three products re-implements a slice of each — 3 hosts × 8 concerns = up to 24 forks waiting to diverge (we have already shipped bugs from the divergence: desktop's non-streaming `toolChat`, the `ctxSize` 16384/32768 disagreement, `RagConversation.project_id` dropped at the type boundary).

Consolidate to: **one package (8 modules) + three thin hosts.**

**The package is recursive.** The same code runs as:
- a **node** — serves inference against local runtimes;
- an **aggregator** — routes `/v1/*` across a pool of nodes.

An aggregator is just a node whose "inference provider" happens to be "pick a downstream node and forward." One `createGateway(config)`; the config decides which role.

---

## 2. The eight concerns and where each is harvested from

| # | Concern | Canonical home today | Harvest into |
|---|---------|----------------------|--------------|
| 1 | OpenAI `/v1` surface + request lifecycle (async queue + polling, error shapes, `/docs`, openapi) | desktop `src/main/model-server.ts` | `gateway/src/http/` |
| 2 | Smart / conditional routing (local ↔ cloud, rule engine) | console `lib/routing-policy.ts`, `lib/cloud-routing.ts`, `lib/cloud-route-plan.ts` | `gateway/src/routing/` |
| 3 | Cloud provider transport + governance (egress leash, org policy) + egress/FinOps audit | console `lib/cloud-providers.ts`, `lib/cloud-client.ts`, `lib/cloud-egress-audit.ts` | `gateway/src/providers/cloud/`, `gateway/src/governance/` |
| 4 | Agentic tool-calling loop + MCP client | desktop `src/main/tools.ts`, `mcp.ts`, `mcp-server.ts`; pro connectors | `gateway/src/tools/`, `gateway/src/mcp/` |
| 5 | Queues — (a) admission/priority + (b) durable jobs | desktop `src/main/modality-queue/`; gateway `src/queue/` | `gateway/src/scheduler/`, `gateway/src/queue/` |
| 6 | Residency / eviction policy | **mobile** (best impl) | `gateway/src/residency/` |
| 7 | Budgeting (request-time enforcement + post-hoc accounting) | console FinOps (`api/v1/finops/budgets`) | `gateway/src/budget/` |
| 8 | Aggregator (node pool, selection, health, load, failover) | gateway `src/cluster/` (already here) | `gateway/src/cluster/` (stays) |

---

## 3. The unified request pipeline

Every request — from any host — flows through one pipeline. Stages are middleware; a host enables/configures them but never reimplements them.

```
inbound /v1/... request
  │
  ├─ auth            (policy/*: client token | keycloak JWT | api-key)        [concern 3]
  ├─ admission       (scheduler: priority tier, concurrency cap, queue)        [concern 5a]
  ├─ budget check    (budget: remaining tenant/user budget; block if empty)    [concern 7]
  ├─ routing         (routing rule engine → destination decision)              [concern 2]
  │     rules match on: data_class, task, model, tenant, capability,
  │     cost ceiling, node health, latency SLA, time-of-day
  │     → action: local | cloud:<provider> | node:<id> | cheapest | fastest
  │              | block | fallback-chain[...]
  │     governance overlay: egress leash OFF ⇒ any cloud action ⇒ block        [concern 3]
  │
  ├─ resolve destination
  │     ├─ LOCAL  → residency/eviction: ensure target model resident,          [concern 6]
  │     │           evicting a lower-tier model if needed; then InferenceProvider
  │     ├─ CLUSTER→ aggregator: pick node by model-family + load + health,      [concern 8]
  │     │           forward; failover on node down
  │     └─ CLOUD  → cloud provider adapter (OpenAI/Anthropic/compat), BYOK      [concern 3]
  │
  ├─ agentic loop    (if tools present):                                        [concern 4]
  │     model → tool_calls? → execute (MCP client | host ToolProvider)
  │            → feed results back → repeat (bounded) → else break
  │
  ├─ stream response (ONE streaming path — content + reasoning deltas)          [concern 1]
  │
  └─ finalize        observability sink + egress/cost audit (real tokens)       [concern 3/7]
```

**This single pipeline is why the original desktop bug disappears:** tool-calling is a stage *inside* the one streaming path, not a forked `toolChat`. Streaming, thinking, and tools are never mutually exclusive again.

---

## 4. The seam — ports the host injects

The package depends only on these interfaces. A host supplies implementations; adding a host or a backend is "write an adapter," never "edit the pipeline." (DSP/OCP.)

```ts
// Runtime inference — desktop wraps llama-server/tts/imagegen/whisper;
// mobile wraps llama.rn/whisper.rn; cluster wraps "forward to node".
interface InferenceProvider {
  capabilities(): Capabilities                       // modalities, vision, streaming
  chat(req): AsyncIterable<Delta>                    // streaming (content|reasoning)
  embeddings(req); transcribe(req); speak(req); generateImage(req)
  listModels(); activateModel(id)
}

// Tools that must run where the data is (desktop read_screen/search_memory,
// mobile equivalents). Pure tools (web_search, calculator) ship IN the package.
interface ToolProvider { schemas(): ToolSchema[]; execute(name, args): Promise<string> }

// Host-backed storage of decisions the package makes decisions FROM.
interface PolicyStore   { routingRules(); orgPolicy(); egressAllowed() }   // console=DB, desktop/mobile=local config
interface BudgetStore   { remaining(scope): number; record(scope, cost) }  // console=FinOps DB, desktop/mobile=local
interface CredentialStore { get(provider): { baseUrl, apiKey } }           // console=DB, desktop=keychain, env fallback
interface NodePool      { live(): Node[] }                                 // aggregator only; desktop/mobile = single self-node

// Side-channels (all optional, all injected).
interface ResidencyController { load(model); evict(model); resident(): Model[] } // the ACTION; policy is in-package
interface ObservabilitySink   { emit(event) }
interface AuditSink           { egress(evt); blocked(evt) }
```

**Policy vs execution seam (critical for #6 and #7):** the *decision* — "evict image to make room for chat," "block: budget exhausted" — is pure logic that lives once in the package. The *action* — actually freeing device RAM, reading a tenant's remaining budget — is host I/O injected via `ResidencyController` / `BudgetStore`. Mobile's eviction policy and console's budgeting move in as **logic**; their I/O stays as adapters.

---

## 5. `createGateway` — one factory, three configurations

```ts
// DESKTOP (single node)
createGateway({
  role: 'node',
  providers: desktopInferenceProviders,   // llama-server, tts, imagegen, whisper
  tools: [desktopToolProvider],           // read_screen, search_memory
  residency: desktopResidencyController,  // unload from unified memory
  policy: localConfigPolicyStore,
  budget: localBudgetStore,
})   // → an (req,res) handler bound to :7878; model-server.ts shrinks to this call + adapters

// MOBILE (single node)
createGateway({ role: 'node', providers: rnProviders, tools: [rnToolProvider],
                residency: rnResidencyController, ... })

// CONSOLE (aggregator + cloud)
createGateway({
  role: 'aggregator',
  nodePool: consoleNodePool,              // live fleet
  cloud: { credentials: consoleCredentialStore }, // OpenAI/Anthropic/compat
  policy: consoleDbPolicyStore,           // routing rules, egress leash, org policy
  budget: consoleFinOpsStore,
  audit: consoleEgressAudit,
  observability: [openSearchSink, langfuseSink],
})
```

Every product speaks the identical `/v1` surface, gets identical smart routing / tools / MCP / streaming, and differs only in injected adapters.

---

## 6. Two queues — do not conflate (concern 5)

- **Scheduler / admission queue** (`gateway/src/scheduler/`): in-process, per node. Priority tiers (foreground chat > background replay), concurrency cap, and the coupling to **residency/eviction** (#6) — "only one heavy model fits; who runs, who waits, who gets evicted." Harvest desktop `modality-queue` + mobile's eviction.
- **Durable job queue** (`gateway/src/queue/`): async / long-running / batch requests that outlive an HTTP call (workflow/worker/activities — already present). Backed by the host's durable store.

Same word, two subsystems, two modules.

---

## 7. What gets deleted from each host after migration

- **desktop**: the routing/lifecycle body of `model-server.ts` (keeps ~150 lines of adapters), `tools.ts`, `mcp.ts`, `mcp-server.ts`, `modality-queue/` (logic), `runtime-residency.ts` (logic). Ports/defaults consolidations (F1/F2 from `docs/CONSOLIDATION_PLAN.md`) fold in here.
- **console**: `cloud-providers.ts`, `cloud-client.ts`, `cloud-routing.ts`, `cloud-route-plan.ts`, `routing-policy.ts`, `cloud-egress-audit.ts`, the hand-rolled `lib/gateway.ts` client, `connector-policy.ts` tool bits. Console keeps: UI, tenant DB (behind `PolicyStore`/`BudgetStore`/`CredentialStore`), request-assembly orchestration that *calls* the package.
- **mobile**: its forked routing + eviction + any local gateway shim — replaced by `createGateway({role:'node'})`.

---

## 8. Migration — every product stays green at every gate

Order chosen so the shipping products (desktop, console) are never broken; each phase is independently shippable and verified (typecheck + tests + smoke).

- **P0 (independent, safe):** land the `docs/CONSOLIDATION_PLAN.md` P0 live-bug fixes first (project_id, saveArtifact union, ctxSize/sampler defaults, Modality). Unrelated to the big move, but they're live bugs and touch files the move will also touch.
- **Phase 0 — interfaces only.** Define the ports (§4) + `createGateway` skeleton + routing rule-engine types in the package. Unit-tested in isolation. **No host touched.**
- **Phase 1 — port the `/v1` surface + lifecycle + agentic loop + MCP** into the package behind a stub `InferenceProvider`, full test suite on the OpenAI shapes and the tool loop. **No host touched.**
- **Phase 2 — desktop flips to `createGateway({role:'node'})`.** The one real gate for desktop: `:7878` answers identically, chat streams, tools+MCP work, typecheck+tests+live smoke all green **before** the old `model-server.ts`/`tools.ts` bodies are deleted. Old code is one revert away.
- **Phase 3 — harvest routing/cloud/governance/budget from console** into the package; console adopts `createGateway({role:'aggregator'})` + the injected stores; delete console's forks. Fix the `:8800`/`:7878` port split as part of it.
- **Phase 4 — harvest mobile's routing + eviction** into `gateway/src/routing` + `gateway/src/residency`; mobile flips to `createGateway({role:'node'})`.
- **Phase 5 — cutover cleanup:** delete the dead forks in every host; assert (grep gate) no gateway/routing/provider/tool/queue code remains outside the package.

---

## 9. Testing strategy

- **Pure logic** (routing rule engine, eviction policy, budget decisions, cloud provider selection) — unit tests, zero I/O, in the package. These are the harvested decision cores; they must have real tests before the forks are deleted.
- **Pipeline integration** — run `createGateway` with in-memory fake providers/stores; assert the full `/v1` behavior (streaming deltas, tool loop, cloud-vs-local decision, egress block, budget block, eviction order).
- **Per-host smoke** — desktop boots and serves `:7878` identically (Phase 2 gate); console aggregates a fake 2-node pool; mobile node serves a request.
- **Regression guards** — a test per shipped divergence bug (non-streaming tools; project_id; ctxSize) so they cannot recur.

---

## 10. Open decisions to confirm

1. **Boundary:** does request *assembly* (RAG context, memory retrieval, guardrails/PII scan) move into the package, or stay as host orchestration that *calls* the package? Recommendation: **stays in host**; the package owns routing/transport/tools/governance/lifecycle. PII/data-class *classification* feeds the routing rule engine as an input the host supplies.
2. **Package boundaries:** one `@offgrid/gateway` with 8 submodules, or a small family (`@offgrid/gateway-core` + `@offgrid/gateway-cloud` + `@offgrid/gateway-cluster`)? Recommendation: **one package, submodule exports** — simpler to keep "one thing."
3. **Routing rule format:** reuse console's DB-backed rule shape as the canonical schema, or define a fresh one and adapt console's? Recommendation: **canonicalize console's** (it's the most evolved).
4. **Mobile runtime:** confirm mobile can build/consume a Node-oriented package (RN constraints) or whether the package needs a platform-neutral core with a Node HTTP shell.

---

*Companion: `desktop/docs/CONSOLIDATION_PLAN.md` (the internal desktop DRY/SOLID backlog; the P0 items sequence ahead of Phase 2).*
