# AI Runtime — conference-demo audit (2026-08-05)

Lens: **conference demo**, not production hardening. Severity = DEMO-BLOCKER / DEMO-RISK / POST-DEMO.
Every screenshot judged as a projected 16:9 image from row 10.

Screenshots (kept): `/tmp/audit/runtime/`, `/tmp/audit/runtime2/`, `/tmp/audit/runtime3/`
(harness `scripts/audit-shoot.mjs`, viewport 1600, fullPage, signed in as admin).

## Coverage

Shot **and judged**: `/runtime`, `/runtime/models` (= `/models/overview`), `/models/routing`,
`/models/traffic`, `/models/logs`, `/models/fleet-control`, `/models/providers`, `/models/tuning`,
`/models/spend`, `/models/cache`, `/models/callbacks`, `/runtime/pipelines`,
`/runtime/pipelines/pl_seed_default_loan-underwriting` + its `routing`, `guardrails`, `quality` tabs,
`/runtime/api-budgets` (keys), `/api-budgets/clients`, `/api-budgets/budgets`, `/runtime/api`,
`/runtime/agents` (404).

Code read: `src/lib/agentrun.ts` (run-execution chain), `src/lib/cache.ts`,
`src/lib/adapters/cache.ts`, `src/components/gateway/GatewayTraffic.tsx`,
`src/components/pipelines/PipelineOverview.tsx`, `src/modules/runtime-routes.ts`.

**NOT verified (dev server on :3005 was taken down mid-audit — do not assume these are fine):**
pipeline tabs `policy`, `drift`, `cost`, `audit`, `observability`, `versions`, `api`;
`/runtime/models/[destination]` for a non-existent destination (404 behaviour);
`/runtime/gateways*` (deliberately out of scope — sibling team);
agent detail pages (`/solutions/agents/<id>`);
whether `/api-budgets/budgets` renders correctly with an intact build (see F11).

Useful ids for a re-shoot: pipelines `pl_system_ai_quality_judge__default`,
`pl_seed_default_{cross-sell-advisor,fraud-screening,kyc-verification,loan-underwriting,motor-claim-fnol,reimbursement-governance}`;
agents `sop-synth, fnol-intake, sales-coach, kyc-checker, audit-watch`.

---

## Findings

### F1 [DEMO-BLOCKER] Providers page announces "Cloud egress is ON" and shows OpenAI / Anthropic / DeepSeek / Zhipu — with OpenRouter→`gpt-4o-mini` as the only LIVE provider
**Persona:** CISO in the audience; AI Engineer
**Where:** `/runtime/models/providers` — `src/lib/litellm-provider-pool.ts`, rendered under `src/app/(console)/runtime/models/[destination]/page.tsx`
**What:** An amber banner at the top of the page reads **"Cloud egress is ON.** Requests a routing rule sends to cloud … will reach a configured provider. Turn egress off in Policy to hard-stop all cloud." Below it: five provider cards — `OpenAI` (`api.openai.com`, `gpt-4o-mini`), `Anthropic` (`api.anthropic.com`, `claude-3-5-haiku-latest`), `DeepSeek`, `Zhipu AI (GLM)` (`open.bigmodel.cn`) all `not configured`, and the ONE marked **`available`** is "OpenAI-compatible" → `https://openrouter.ai/api/v1`, default model `openai/gpt-4o-mini`. Cards also print raw tag-prefix config ("Routes model tags: openai, openai/, openai:, gpt-").
**Why it matters:** The pitch is a private AI where data does not leave. This screen, projected, says cloud egress is ON and the live route is OpenRouter to GPT-4o-mini — plus a Chinese-hosted endpoint in the list. It also directly contradicts the pipeline pages, which say "leashed to on-prem". One off-script click here and he is defending, not demoing.
**Fix (demo):** Do not put Providers in the run of show, and ideally hide the destination for the demo tenant. If it must exist: suppress `not configured` third-party cards entirely (show only what is wired), reword the banner to state the *effective* posture ("Cloud is available but every seeded pipeline is leashed to on-prem — no pipeline can reach it"), and rename the live entry to something that does not read as OpenAI.
**Screenshot:** `runtime3/runtime_models_providers.png`.

### F2 [DEMO-BLOCKER] Routing page contradicts itself three times: "Router is live … load-balances across the deployments below", then `DEPLOYMENTS (0)`, then three deployments listed
**Persona:** AI Engineer / technical operator
**Where:** `/runtime/models/routing` — `src/lib/litellm-config.ts`, `src/lib/litellm-provider-pool.ts`
**What:** In one viewport: an info bar "**Router is live.** It load-balances across the deployments below with automatic failover + retries; per-key budgets and rate limits are enforced." Immediately under it `DEPLOYMENTS (0)` — "The router reports no deployments yet — **check the generated config.yaml**." and `KEY BUDGETS (0)` — "No budgets reported". Then the Provider pool table lists three live deployments, and further down "Virtual keys & budgets … **10 keys**" with a row `$0.00 / ∞`.
**Why it matters:** Zero-vs-three and zero-vs-ten in the same screenshot. "check the generated config.yaml" instructs the audience to go read a YAML file. This is the routing-control screen — the one an AI engineer in the room will care about most.
**Fix:** Read the deployment/budget counts from the same source the tables below use (or drop the two `(0)` summary lines entirely — the tables already say it), and remove the `config.yaml` sentence.
**Screenshot:** `runtime/runtime_models_routing.png`.

### F3 [DEMO-BLOCKER] The Routing page prints a full API key and `host.docker.internal` endpoints
**Persona:** CISO; anyone photographing the screen
**Where:** `/runtime/models/routing` — virtual-keys table + provider-pool table (`src/lib/gateway-api-keys.ts`, `src/lib/litellm-provider-pool.ts`)
**What:** The "Virtual keys & budgets" table shows alias `offgrid-onyx-g4` with the **full 64-char key** `bc449eb3759b60058d574d89336c7ad1a2e2bbd48d942ec5cebc183a97f48c02` in plain text. The provider-pool rows show endpoints `http://host.docker.internal:7811/v1`, `:7812`, `:7813`, and upstream names `openai/qwen3-vl-8b` etc.
**Why it matters:** A live credential on a conference projector is the worst possible slide, and it undercuts the security story in the same frame. `host.docker.internal` tells the room the "on-prem fleet" is Docker on one box; `openai/<local-model>` makes local models look like OpenAI calls.
**Fix:** Mask the key (`bc44…f48c02`) with a copy button, as the Clients table already does; render endpoints as node names (`g1 · on-prem`) not docker URLs; strip the `openai/` provider prefix from the displayed upstream.
**Screenshot:** `runtime/runtime_models_routing.png`.

### F4 [DEMO-BLOCKER] Spend contradicts itself and attributes every request to a model called `unknown`
**Persona:** AI Engineer / CFO-minded viewer
**Where:** `/runtime/models/spend` — `src/app/(console)/runtime/models/spend/page.tsx`, `src/lib/litellm-spend.ts`
**What:** Stat band: `REQUESTS 2 · TOTAL TOKENS 0 · AVG TOKENS/REQ 0 · TOTAL SPEND $0.0000`. The chart directly beneath says **"No traffic in this window."** The "Attribution — By model" table's only row is model **`unknown`** with 2 requests / 0 tokens / $0. The side card prints raw API paths `/global/spend/keys`, `/global/spend/models`.
**Why it matters:** "2 requests" beside "no traffic" is the fastest contradiction in the section, and `unknown` as the model name destroys the "every call is attributed to a model and a tenant" claim. All four tiles are 0 or near-0 — the money screen looks unbuilt.
**Fix:** Default the range to 7 or 30 days (the Logs page proves 18 calls exist outside the 15m/24h window); replay a few dozen governed runs before the demo; map a null model to the routed deployment name; make the chart's empty copy consistent with a non-zero request count; delete the `/global/spend/*` paths from the UI.
**Screenshot:** `runtime/runtime_models_spend.png`.

### F5 [DEMO-BLOCKER] Traffic tab sits on "Loading live traffic…" and then says the feed is offline
**Persona:** Technical operator
**Where:** `/runtime/models/traffic` — `src/components/gateway/GatewayTraffic.tsx:180-215`, endpoint `/api/v1/gateway/traffic`
**What:** After network-idle plus a 3.5s wait, the only thing on a 1600px screen is a small card reading "Loading live traffic…". The endpoint is slow: an unauthenticated probe took **9.5s** to return (`curl -w` against `127.0.0.1:3005/api/v1/gateway/traffic` → `401` in `9.47s`), because it reaches out to the aggregator. When it finally settles with no feed, the copy is "No live traffic feed … the **aggregator's** traffic feed is offline or no calls have been routed yet."
**Why it matters:** A spinner that hangs ~10 seconds on a projected screen, resolving to an "offline" message with an internal component name in it. "Live traffic" is exactly the tab someone asks for.
**Fix:** Do not demo this tab unless traffic is flowing at that moment. Cheap improvements: render a skeleton with the table headers instead of a bare sentence, cut the fetch timeout to ~2s, and reword the failure to "No requests have been routed in the last few minutes."
**Screenshot:** `runtime/runtime_models_traffic.png`.

### F6 [DEMO-BLOCKER] The Quality tab of the flagship pipeline shows an amber "nothing is being verified" warning and three zeros
**Persona:** CISO / any risk-minded viewer
**Where:** `/runtime/pipelines/pl_seed_default_loan-underwriting/quality` — `src/app/(console)/build/pipelines/[id]/quality/page.tsx`
**What:** An amber alert box: **"No checks are set up for this app, so nothing is being verified."** (also the wrong noun — this is a pipeline, not an app). Beside it "Evals for this pipeline — **0 attached**", "Golden set for this pipeline (**0**)", "No golden cases yet". The "Attach from the library" chip row contains **"Hallucination / Faithfulness" twice** — a visible duplicate. The "Question / inpu" placeholder is clipped mid-word.
**Why it matters:** The loan-underwriting pipeline is the money demo. A yellow box saying nothing is verified, on the quality tab, is the single sentence a CISO will quote back. The duplicated chip reads as sloppy seed data.
**Fix (cheapest win in this section):** Attach 2–3 of the existing library evals to this pipeline and seed 4–6 golden cases with Indian-BFSI questions/answers, so the tab shows a real bar and a real score. De-duplicate the library chips. Change "this app" to "this pipeline".
**Screenshot:** `runtime2/runtime_pipelines_pl_seed_default_loan-underwriting_quality.png`.

### F7 [DEMO-BLOCKER] On the flagship loan pipeline, "Require grounding" is OFF and "Filter toxic content" is OFF
**Persona:** CISO
**Where:** `/runtime/pipelines/pl_seed_default_loan-underwriting/guardrails` — `src/app/(console)/build/pipelines/[id]/guardrails/page.tsx`, defaults from `src/lib/guardrail-rules-runtime.ts`
**What:** Four guardrail cards. `Mask PII before the model` = **Masking on** (`Org · locked`) and `Block prompt injection` = **Defence on** (`Org · locked`) — good. But `Require grounding` shows **"Grounding off"** and `Filter toxic content` shows **"Filter off"**, both `Org default`. The page's own body copy promises "grounding and toxicity filters … Retrieved data and model output pass through the effective guardrails below on every call."
**Why it matters:** The prose above the toggles claims grounding and toxicity filtering; the toggles beneath it say both are off. On a credit-decisioning pipeline, "hallucination checking: off" is the worst possible read. It is also a one-click fix.
**Fix:** Turn both on for the seeded demo pipelines (there is already a "Turn on: Filter toxic content" affordance on the page — just do it before the demo), or set the org default on.
**Screenshot:** `runtime2/runtime_pipelines_pl_seed_default_loan-underwriting_guardrails.png`.

### F8 [DEMO-BLOCKER] `/runtime/agents` 404s with "the module isn't enabled for this deployment"
**Persona:** the founder mid-demo; any viewer following the section's own vocabulary
**Where:** no `src/app/(console)/runtime/agents/**` (agents live at `src/app/(console)/solutions/agents`)
**What:** HTTP 404 → "Page not found | That route doesn't exist, or the module isn't enabled for this deployment."
**Why it matters:** "AI Runtime" is the natural home for agents; the 404 copy says the product is *not enabled*, which reads as unfinished rather than as a wrong URL. `runtime/pipelines/page.tsx` already proves the one-line alias pattern works.
**Fix:** `export { default } from '@/app/(console)/solutions/agents/page';` in a new `runtime/agents/page.tsx`, or a redirect. Minutes of work.
**Screenshot:** `runtime/runtime_agents.png`.

### F9 [DEMO-BLOCKER] `/runtime/models/callbacks` is a debug dump — `_PROXY_LiteLLMManagedVectorStores` and friends, in two overlapping columns
**Persona:** Principal UX; any business viewer
**Where:** `src/app/(console)/runtime/models/callbacks/page.tsx`, `src/lib/litellm-callbacks.ts`
**What:** Two columns of raw handler class names, each badged `Other`: `_ProxyDBLogger`, `_PROXY_MaxBudgetPerSessionHandler`, `_PROXY_CacheControlCheck`, **`_PROXY_LiteLLMManagedVectorStores`**, `_PROXY_LiteLLMManagedFiles`, `SkillsInjectionHook`, `async_deployment_callback_on_failure`, `_PROXY_VirtualKeyModelMaxBudgetLimiter`… The right column's labels are **clipped at the panel edge and visibly overlap** the left column's badges. The sample record exposes `"gateway": "g5"` and `onprem/qwen3.5-9b`.
**Why it matters:** The banned engine name is literally spelled out on screen, at maximum jargon density, in a visually broken layout. Note this route is NOT in the Models rail (`src/modules/runtime-routes.ts` has no `callbacks` destination), so it is only reachable by URL — which lowers, but does not remove, the risk.
**Fix:** Leave it out of the run of show. To make it safe: show a count plus friendly categories ("cost accounting", "audit log", "usage metering") and hide every `_PROXY_*`/vendor-named entry behind a "technical detail" disclosure. Fix the two-column clipping (`min-w-0` + truncate).
**Screenshot:** `runtime/runtime_models_callbacks.png`.

### F10 [DEMO-BLOCKER] `/runtime/models/tuning` is a read-only wall of env-var and infra jargon
**Persona:** Principal UX; business viewer
**Where:** `src/app/(console)/runtime/models/[destination]/page.tsx` → tuning destination
**What:** Header: "Read-only. These are the aggregator's live tuning values … set from environment in the aggregator's **launchd plist on S1** … the router has no live-reconfigure endpoint." Cards include `POOL PINNED (OFFGRID_POOL)`, `5 nodes — HARDCODED FALLBACK POOL`, `JAMMED LATENCY`, `DEGRADED ERROR RATE`, `SYNTHETIC PROBE`, `POOL REFRESH INTERVAL`, and the sentence "Change via: aggregator env (launchd plist on S1) — restart to change" repeated **eleven times**.
**Why it matters:** An env var name, "launchd plist", "SSOT", and the word **"hardcoded"** projected on a slide. Every card also tells the viewer the console cannot change the value — a read-only page in a product sold as an operator console.
**Fix:** Not in the run of show. Longer term: keep 4–5 plain-language cards ("a node is considered slow above 30s"), collapse the rest, and say "set at deploy" once, not per card.
**Screenshot:** `runtime3/runtime_models_tuning.png`.

### F11 [DEMO-BLOCKER] The whole API & budgets area is empty — no keys, no budgets — and Clients is ten unreadable JWTs
**Persona:** AI Engineer / CISO
**Where:** `/runtime/api-budgets` (keys), `/api-budgets/clients`, `/api-budgets/budgets` — `src/lib/gateway-api-keys.ts`, `src/lib/litellm-key-policy.ts`
**What:** Three separate problems in one area.
- **Keys:** the entire 1600px page is one card: "No API keys yet — create one to authenticate a client to the gateway." The route also failed to reach network-idle in 90s in the harness, so it may present as still-loading.
- **Budgets:** `Token budgets · 0`, "No budgets issued yet. Use the form above to cap a user or org." The form placeholder is `ada@acme.co or org:acme` (not Indian BFSI) and the help text names the raw header `x-offgrid-user`.
- **Clients:** ten rows whose only identity is a truncated JWT (`eyJhbG…y_uQ`, `eyJhbG…xGKA`, …), Provider column reading `jwt jwt` twice per row, every IP `offgrid-s1.local` (the console calling itself), every "Routing overrides" = `none`, and "Last seen" rendered in raw hours — `139h ago`, `666h ago`, **`722h ago`**.
**Why it matters:** This is the surface that proves "budgets are enforceable and every client is keyed". It shows nothing enforceable and no identifiable client. `722h ago` is unreadable and quietly admits nothing has called in a month.
**Fix (cheap):** Seed 3–4 named keys (`suraksha-claims-app`, `bharatunion-kyc-batch`, `analyst-notebook`) each with a token budget so Keys and Budgets both land populated; label Clients rows by the key alias with the JWT behind a disclosure; format "last seen" as days/weeks; change the placeholder to an Indian-BFSI example.
**Screenshots:** `runtime/runtime_api-budgets.png`, `runtime3/runtime_api-budgets_clients.png`, `runtime3/runtime_api-budgets_budgets.png`.
**Caveat, stated honestly:** the `budgets` shot rendered as **completely unstyled raw HTML** (Times New Roman, blue underlined links, broken image icon) with 29 chunk-404s. That is almost certainly the shared dev server's clobbered `.next` (the coordinator confirmed `.next/BUILD_ID` was emptied), **not** a product defect — I could not re-verify after the server went down. It is worth one re-shoot after the production rebuild, because a torn build produces exactly this on stage.

### F12 [DEMO-BLOCKER] Raw internal tokens on the two best pipeline screens: `__never__`, `data_class`, and the model catalog's `not_installed` / `unknown`
**Persona:** Principal UX; AI Engineer
**Where:** `src/components/pipelines/PipelineOverview.tsx:243-259` and the routing tab's "Routing rules" card; `src/lib/model-catalog.ts` + the Modalities band on `/runtime/models`
**What:** On the pipeline Overview *and* the Routing tab, the egress-leash rule list reads `pii → local`, `restricted → block`, **`__never__ → local`**, under the caption "`data_class` → local | cloud | block". On `/runtime/models`, the Modalities band shows `image generation` and `image edit` as **`not_installed`**; the auto-selected first catalog row is `Qwen 9B (fleet)` with no `live` badge, `ctx unknown`, and a detail pane reading `Context window: unknown`, `License: unknown`, **`On fleet: no`** — a model named "(fleet)" that says it is not on the fleet. Counter reads `4 live · 25 total`, so 21 of 25 rows are not served.
**Why it matters:** The pipeline detail page is otherwise the strongest surface in the section — and a double-underscore sentinel sits in the middle of its governance card. On the models page the *default selection* is the least credible row in the catalog, with three "unknown"s.
**Fix:** Hide the `__never__` sentinel row (or label it "everything else"); render `data_class` as "data class" and `not_installed` as "Not enabled"; default the catalog's `live only` filter ON, or default-select a `live` model (`Qwen3-VL 8B Instruct`), and drop or complete the `(fleet)` synthetic row.
**Screenshots:** `runtime2/runtime_pipelines_pl_seed_default_loan-underwriting.png`, `runtime2/…_routing.png`, `runtime/runtime_models.png`.

### F13 [DEMO-RISK] Logs lands empty by default while admitting 18 calls exist just outside the window
**Persona:** Technical operator
**Where:** `/runtime/models/logs` — `src/lib/litellm-log-shape.ts` + the logs panel
**What:** Default range `15m`. The page states "**0 matches** — nothing in this time range, but **18 calls exist outside it**. Widen the range." Table body: "No results — adjust filters or widen the time range." Half the screen is empty.
**Why it matters:** Honest copy (credit where due — it does not present an outage as emptiness), but on stage the request-log tab opens with zero rows and a nudge to fix the filter. Trivially avoidable.
**Fix:** Default the range to 24h or 7d — or auto-widen when the current window is empty and a wider one is not, and say so.
**Screenshot:** `runtime3/runtime_models_logs.png`.

### F14 [DEMO-RISK] Fleet control shows a model file named `Qwythos-9B-Claude-Mythos-5-1M-Q4_K_M.gguf`
**Persona:** AI Engineer; CISO
**Where:** `/runtime/models/fleet-control` — node-control model selectors
**What:** The g7 node's active-model dropdown reads `Qwythos-9B-Claude-Mythos-5-1M-Q4_K_M.gguf`; g1 and g5 show `Qwen3VL-8B-Instruct-Q4_K_M.gguf` and `gemma-4-E4B-it-Q4_K_M.gguf`. Node cards are keyed `g1 g3 g5 g6 g7 s1` with hostnames `offgrid-g6.local` and a port `:8439`; `g6` and `s1` show a hostname and no model at all, unlike their siblings.
**Why it matters:** Otherwise this is one of the best screens in the section (real nodes, real swap/restart/disable controls — genuinely demo-worthy). But a filename containing **"Claude"** on a private-AI stage invites "so you're calling Anthropic?", and `Q4_K_M.gguf` is deep jargon. The two model-less cards make the grid look half-configured.
**Fix:** Display a friendly model name with the file behind a tooltip; rename the demo weight file; give `g6`/`s1` a role line ("storage node — serves no model") so the cards read complete.
**Screenshot:** `runtime3/runtime_models_fleet-control.png`.

### F15 [DEMO-RISK] The AI Runtime landing page proves nothing is running, and says "Inside ai runtime"
**Persona:** AI Engineer / technical operator
**Where:** `src/app/(console)/runtime/page.tsx:20-59`
**What:** Under "Run reliable private intelligence on your infrastructure" the only facts are `Enabled gateways 4/4`, `Assigned models 3`, `Published pipelines 7/7`, labelled "Current console records" — all counted from console DB rows. No requests, latency, error rate or spend anywhere. The section heading further down is lowercase **"Inside ai runtime"**. Three cards occupy ~60% of a 1600px width with a dead right gutter.
**Why it matters:** This is the first screen of the section. It shows configuration counts, not evidence of a live runtime, so the headline claim is unsupported on the very slide that makes it. The lowercase "ai runtime" reads as a bug.
**Fix:** Add one live band (requests 24h / p95 latency / error rate) from the same reads Spend already does; capitalise "AI Runtime"; make the fact band 4-up so it fills the width.
**Screenshot:** `runtime/runtime.png`.

### F16 [DEMO-RISK] A model-call failure is rendered as a successful answer
**Persona:** Technical operator; the founder running a live agent on stage
**Where:** `src/lib/agentrun.ts:283-289` (`compose`), `:246-249` and `:218-221` (`gatewayAnswer`)
**What:** `gatewayAnswer` returns `null` on any non-200 or throw. `compose` then returns `Based on ${hits.length} source(s): ${hits[0].snippet}` — the first retrieved document snippet, presented as the agent's answer — or `'No sources found.'`. The run persists with status `ok`, and `onUsage` never fires so tokens/cost record zero.
**Why it matters (demo):** if a node is cold or loaded during a live run, the agent "answers" with a raw document excerpt and the run shows green. He would be demoing a fabricated answer without knowing, and the run history would not show a failure to point at.
**Fix:** Return a distinguishable failure from `compose` so the run persists `status:'error'` with "the model did not answer — retry"; never put a raw snippet in the answer field.

### F17 [DEMO-RISK] Cache page prints "BACKEND redis" and a wall of API call-type tokens
**Persona:** Principal UX
**Where:** `src/components/gateway/CacheDashboard.tsx` (value from `/cache/ping` via `src/lib/adapters/litellm-cache.ts`), at `/runtime/models/cache`
**What:** "Cache status" shows `BACKEND` = **`redis`**, `REACHABLE yes`, `HEALTHY yes`; "CACHE POLICY" shows `TTL 3600s`, `Namespace offgrid`, and a Call-types column wrapping `completion, acompletion, embedding, aembedding, atranscription, transcription, atext_completion, text_completion, arerank, rerank, responses, aresponses…` in a narrow column. The effectiveness band reads `HIT RATE n/a` with an amber note that "This gateway does not stamp a `cache_hit` marker on its request logs".
**Why it matters:** A named OSS component plus snake_case API tokens on the private-AI screen. Credit where due: the `n/a` hit-rate note is genuinely honest and the flush controls look real — the problem is purely how it reads from row 10.
**Fix:** Render the backend as "Shared, survives restarts" vs "In-process"; collapse Call types to "Chat, embeddings, transcription, re-ranking" with the raw list behind a disclosure; reword `cache_hit` to "this build does not report per-request cache hits".
**Screenshot:** `runtime/runtime_models_cache.png`.

### F18 [DEMO-RISK] The flagship pipeline is owned by `service@offgrid.local` with "No team"
**Persona:** Business viewer; demo-data credibility
**Where:** pipeline Overview → "Lifecycle & ownership"; also the auto-rollback event on the Quality tab is attributed to `service@offgrid.local`
**What:** `OWNED BY service@offgrid.local`, `TEAM No team`, with "Reassign" and "Assign" buttons beside them.
**Why it matters:** The governance story is "a named person owns this and a team reviews it". A service account owning the loan-underwriting pipeline, with no team, weakens exactly that. The repo's convention is Indian BFSI names.
**Fix:** Reassign the seeded pipelines to plausible named owners and teams (e.g. "Credit Risk — Underwriting") before the demo. Pure data.
**Screenshot:** `runtime2/runtime_pipelines_pl_seed_default_loan-underwriting.png`.

---

## Demo readiness

### The story (strongest 2 minutes in AI Runtime), in route order
1. `/runtime/pipelines` — seven named BFSI pipelines, all `published`, all badged **on-prem**, each with a data ceiling. This is the best list surface in the section: full width, credible names, "Open →" plus delete on every card. Open with this, not with `/runtime` (F15).
2. `/runtime/pipelines/pl_seed_default_loan-underwriting` — the Overview. Lifecycle Draft→In review→Published, a named owner (after F18), Binding "On-Prem Cluster · Data stays on-prem", the data ceiling chips (`loan-applications, credit-bureau, income-proofs, kyc-records`), and cards linking to policy/guardrails/quality. This is the heart-of-product screen and it holds up.
3. → **Gateway & routing** tab — "Allow cloud egress" unchecked, the routing rules, the hard allowlist, "Every save records a new immutable version". This is where the leash claim is made and it looks like a real control.
4. → **Guardrails** tab — "Mask PII before the model: on, Org · locked" and "Block prompt injection: on, Org · locked". **Only after F7 is fixed** (grounding + toxicity currently read "off").
5. `/runtime/models/fleet-control` — real nodes, real Swap / Restart / Disable. The strongest "we run the metal" moment. **After F14** (the `…Claude-Mythos…gguf` filename).
6. Close on `/runtime/models` with the **`live only`** filter applied — four live models, cleanly badged.

### What to avoid on stage
- **`/runtime/models/providers`** — "Cloud egress is ON", OpenAI/Anthropic/DeepSeek/Zhipu cards, OpenRouter→`gpt-4o-mini` as the only live provider (F1). The single most dangerous screen in the section.
- **`/runtime/models/routing`** — self-contradicting counts plus a full API key and `host.docker.internal` (F2, F3).
- **`/runtime/models/tuning`** and **`/runtime/models/callbacks`** — env vars, "launchd plist", "hardcoded", `_PROXY_LiteLLM*` (F9, F10).
- **`/runtime/models/traffic`**, **`/runtime/models/logs`**, **`/runtime/models/spend`** — a hanging spinner, an empty table, and a self-contradicting money band (F5, F13, F4).
- **`/runtime/api-budgets/*`** — empty keys, empty budgets, ten unreadable JWTs (F11).
- The pipeline **Quality** tab until F6 is seeded — the amber "nothing is being verified" box.
- Typing `/runtime/agents` (F8).
- Note: the Models rail exposes Routing / Traffic / Logs / Providers / Tuning / Spend one click away from the safe Models page. Four of the six are on the avoid list — worth collapsing the rail or reordering it before the demo.

### Cheapest wins, ranked (data and copy, no refactors)
1. **Turn grounding + toxicity ON for the seeded pipelines, and attach 2–3 evals + 4–6 golden cases to Loan Underwriting** (F7, F6). Turns the two worst governance screens into the two best. Pure configuration/seed.
2. **Seed the API & budgets area**: 3–4 named keys with token budgets (F11), which also gives the Clients table real identities.
3. **Change three defaults**: Logs range → 7d, Spend range → 30d, model catalog → `live only` on (F13, F4, F12). Three one-line changes that make three surfaces land populated.
4. **Copy sweep of the tokens visible on the safe screens**: `__never__`, `data_class`, `not_installed`, `unknown` model, `BACKEND redis`, "Inside ai runtime", "this app" on the pipeline Quality tab (F12, F17, F15, F6).
5. **Add the `/runtime/agents` alias** (F8) and **mask the API key** on the routing page (F3). Two small edits that remove a 404 and a credential from the projector.
6. **Reassign the seeded pipelines to named owners + teams** (F18). Data only.

---

## Out of scope for the demo (one line each)

- `src/lib/cache.ts:87` — the response-cache key (`resp:<sha256(prompt)>`) carries no org namespace, and the in-process semantic layer (`bestSemantic`, cosine ≥ 0.92) matches across orgs, models and system prompts, so a cached answer can cross tenants and misattribute the serving model. No visible demo symptom.
- `src/lib/agentrun.ts:281-283` — a cache hit skips `onUsage`, so cached runs record zero tokens/cost (feeds the Spend zeros but is not itself visible).
- `runtime/pipelines/**` and `runtime/api` are `export { default } from '@/app/(console)/build/...'` / `operations/api-docs` aliases, so the same entity has two canonical URLs — an IA/Back-coherence question with no demo symptom.
- `/runtime/models/tuning` and `/api-budgets/clients` are read-only surfaces (no create/update/delete), against the full-CRUD rule.
- `/runtime` and `/runtime/api-budgets` emit React hydration-mismatch console errors; the pipeline `quality` tab throws a hydration `pageerror`. Not visible in the rendered pixels.
- `/runtime/api` (API docs) drops the AI Runtime rail because it re-exports an `operations/` page — the sidebar context collapses mid-navigation.
