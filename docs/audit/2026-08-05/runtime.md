# AI Runtime — conference-demo audit (2026-08-05)

Lens: **conference demo**, not production hardening. Severity = DEMO-BLOCKER / DEMO-RISK / POST-DEMO.
Every screenshot judged as a projected 16:9 image from row 10.

Section: `src/app/(console)/runtime/**` + model/pipeline/agent-run libs.
Screenshots: `/tmp/audit/runtime/*.png` (`node scripts/audit-shoot.mjs`, viewport 1600, fullPage).

## Coverage so far

- [x] Route enumeration (23 files; `/runtime/pipelines*` and `/runtime/api` are re-export aliases of `build/*` / `operations/api-docs`)
- [x] Shot + judged: `/runtime`, `/runtime/models` (overview), `/runtime/models/cache`, `/runtime/models/spend`, `/runtime/models/callbacks`, `/runtime/pipelines`, `/runtime/api-budgets` (keys)
- [x] `/runtime/agents` → **404** (agents actually live at `/solutions/agents`)
- [ ] Shot in flight: `/runtime/models/{overview,routing,traffic,logs,fleet-control,providers,tuning}`, `/runtime/api-budgets/{keys,clients,budgets}`
- [ ] Pipeline detail + 11 tabs (`/runtime/pipelines/pl_seed_default_loan-underwriting/...`)
- [ ] Agent detail (`/solutions/agents/kyc-checker`)
- [x] Read: `src/lib/cache.ts`, `src/lib/adapters/cache.ts`, `src/lib/agentrun.ts` (compose/gatewayAnswer/persist path)
- [ ] `src/lib/pipelines.ts`, `pipeline-execute*.ts`

Real ids for reshooting: pipelines `pl_system_ai_quality_judge__default`, `pl_seed_default_{cross-sell-advisor,fraud-screening,kyc-verification,loan-underwriting,motor-claim-fnol,reimbursement-governance}`; agents `sop-synth, fnol-intake, sales-coach, kyc-checker, audit-watch`.

## Findings

### [DEMO-BLOCKER] The Spend screen contradicts itself: "2 requests" beside "No traffic in this window", $0.0000, and a model called `unknown`
**Persona:** AI Engineer / CISO in the audience
**Where:** `src/app/(console)/runtime/models/spend/page.tsx`, `src/components/gateway/SpendPanel*` (data via `src/lib/litellm-spend.ts`)
**What:** The stat band reads `REQUESTS 2 · TOTAL TOKENS 0 · AVG TOKENS/REQ 0 · TOTAL SPEND $0.0000`, the chart underneath says **"No traffic in this window."**, and the "Attribution — By model" table's only row is model **`unknown`** with 0 tokens. The right-hand "Spend reality" card also prints raw API paths (`/global/spend/keys`, `/global/spend/models`) as UI text.
**Why it matters:** This is the FinOps money slide. A tile saying 2 requests next to a chart saying no traffic is the single fastest thing an audience spots, and `unknown` as the model name destroys the "every call is attributed to a model and a tenant" claim he is on stage to make.
**Fix:** Seed/replay ~24h of gateway traffic before the demo so the window is non-empty; make the chart's empty copy consistent with the request tile (if requests>0 but tokens=0, say "requests recorded, token detail not reported by this window" rather than "No traffic"); map a null model to the routed deployment name instead of `unknown`; drop the `/global/spend/*` paths from the card.
**Screenshot:** `runtime_models_spend.png` shows the contradiction and the `unknown` row.

### [DEMO-BLOCKER] `/runtime/models/callbacks` is a wall of internal class names — including "LiteLLM" — with overlapping columns
**Persona:** Principal UX / any business viewer
**Where:** `src/app/(console)/runtime/models/callbacks/page.tsx`, `src/lib/litellm-callbacks.ts`
**What:** The two "Callback sinks" columns list raw proxy internals: `_ProxyDBLogger`, `_PROXY_MaxBudgetPerSessionHandler`, `_PROXY_CacheControlCheck`, **`_PROXY_LiteLLMManagedVectorStores`**, `_PROXY_LiteLLMManagedFiles`, `SkillsInjectionHook`, `async_deployment_callback_on_failure`, each tagged `Other`. The right column's labels are clipped at the panel edge and visibly OVERLAP the left column's `Other` badges. The example record also exposes `"gateway": "g5"` and `onprem/qwen3.5-9b`.
**Why it matters:** Rule-5 jargon at maximum density, on a projector, with the banned engine name spelled out. It reads as a debug dump, not a product. The overlap alone makes the screen look unbuilt.
**Fix:** Do not show this route on stage; medium-term, collapse the sink list to a count + friendly categories ("cost accounting", "audit log", "usage metering") and hide any `_PROXY_*` / vendor-named entry behind a "technical detail" disclosure. Fix the column clipping/overlap (each column needs its own `min-w-0` + truncation).
**Screenshot:** `runtime_models_callbacks.png` — see the `_PROXY_LiteLLM*` entries and the collided middle gutter.

### [DEMO-BLOCKER] `/runtime/agents` 404s — the AI Runtime section has no agents route at all
**Persona:** Technical operator / the founder mid-demo
**Where:** no `src/app/(console)/runtime/agents/**`; agents live at `src/app/(console)/solutions/agents`
**What:** `/runtime/agents` returns HTTP 404 with "Page not found — That route doesn't exist, or the module isn't enabled for this deployment."
**Why it matters:** "AI Runtime" is the natural place a viewer (or the founder typing a URL, or anyone following the section's own naming) looks for agents. A 404 branded "the module isn't enabled for this deployment" reads as *the product is incomplete*, not *wrong URL*.
**Fix:** Add `src/app/(console)/runtime/agents/page.tsx` as a re-export alias of the solutions agents list (the same one-line pattern already used by `runtime/pipelines/page.tsx`), or redirect. Cheap.
**Screenshot:** `runtime_agents.png` shows the 404 page.

### [DEMO-BLOCKER] API & budgets opens completely empty — "No API keys yet" on a governed-access demo
**Persona:** AI Engineer / CISO
**Where:** `src/app/(console)/runtime/api-budgets/page.tsx` → keys destination; data via `src/lib/gateway-api-keys.ts`
**What:** `/runtime/api-budgets` lands on Keys and the whole page is one empty card: "No API keys yet — create one to authenticate a client to the gateway." Nothing else on a 1600px screen. The route ALSO failed to reach network-idle within 90s in the harness (something polls forever), so it may present as a page that keeps loading.
**Why it matters:** This is the surface that proves "budgets are enforceable and every client is keyed". Empty, it proves the opposite. Two of the three sub-tabs (Clients, Budgets) are one click away and untested here.
**Why it matters (demo):** first obvious click off the Runtime nav lands on an empty screen.
**Fix:** Seed 3–4 credible Indian-BFSI keys (e.g. `suraksha-claims-app`, `bharatunion-kyc-batch`, `analyst-notebook`) with budgets attached; give the empty state a primary CTA in-card rather than a bare sentence.
**Screenshot:** `runtime_api-budgets.png` — the entire viewport is one empty panel.

### [DEMO-BLOCKER] Cache page prints the engine name: "BACKEND redis"
**Persona:** Principal UX (rule-5 jargon), CISO
**Where:** `src/components/gateway/CacheDashboard.tsx` (value from `src/lib/adapters/litellm-cache.ts` `/cache/ping` `type`), rendered at `/runtime/models/cache`
**What:** The "Cache status" panel shows `BACKEND` = **`redis`**, and the page body references a `cache_hit` marker on "request logs" and "spend logs". Below that, "Call types" is a wrapped wall of tokens (`acompletion, aembedding, atranscription, arerank, aresponses…`) squeezed into a narrow column.
**Why it matters:** A named OSS component and snake_case API tokens on the screen where the pitch is "private AI, no vendor". `arerank`/`aresponses` mean nothing to a business audience and read as a config dump.
**Fix:** Render the backend as "Shared, persistent (survives restarts)" vs "In-process"; drop the `cache_hit` phrasing to "the gateway does not report per-request cache hits on this build"; collapse Call types to "Chat, embeddings, transcription, re-ranking" with the raw list behind a disclosure.
**Screenshot:** `runtime_models_cache.png` shows `BACKEND redis` and the Call-types wall.

### [DEMO-RISK] Model catalog shows a model literally named "(fleet)" whose own detail card says "On fleet: no", with unknown context window and unknown licence
**Persona:** AI Engineer asking "what are you actually running?"
**Where:** `/runtime/models` (`src/components/gateway/...` catalog) fed by `src/lib/model-catalog.ts`
**What:** The first catalog row, auto-selected, is `Qwen 9B (fleet)` with NO `live` badge and `ctx unknown · 9B`; the detail pane reads `Context window: unknown`, `License: unknown`, **`On fleet: no`**, and a note "context window not publicly fixed". The Modalities band shows `image generation` / `image edit` as **`not_installed`** (raw snake_case).
**Why it matters:** The default selection on the models page is the least credible entry in the catalog — a model named "(fleet)" that says it is not on the fleet, with three "unknown"s. `4 live · 25 total` also means 21 of 25 rows are aspirational; a viewer scrolling sees mostly non-live models.
**Fix:** Default-select a `live` model (e.g. `Qwen3-VL 8B Instruct`), or default the `live only` filter ON; fill or remove the `(fleet)` synthetic row; render `not_installed` as "Not enabled".
**Screenshot:** `runtime_models.png` — first row selected, detail pane full of `unknown`.

### [DEMO-RISK] The AI Runtime overview proves nothing about the runtime — three console record counts and no serving signal
**Persona:** AI Engineer / technical operator
**Where:** `src/app/(console)/runtime/page.tsx:20-59`
**What:** Under the headline "Run reliable private intelligence on your infrastructure", the only facts are `Enabled gateways 4/4`, `Assigned models 3`, `Published pipelines 7/7` — all counted from console DB rows, labelled "Current console records". No requests, latency, error rate, or spend. The section heading below reads lowercase **"Inside ai runtime"**.
**Why it matters:** The landing screen of the runtime section shows no evidence anything is *running*. It is also visually thin: three cards occupy ~60% of a 1600px width with a dead right gutter, then a plain link list.
**Fix:** Add one live band (requests last 24h, p95 latency, error rate) sourced from the same spend/traffic reads the Spend tab already uses; capitalise "AI Runtime" in the section heading; stretch the fact band to 4 columns so it fills the width.
**Screenshot:** `runtime.png`.

### [POST-DEMO / DEMO-RISK if the gateway wobbles] A model-call failure is rendered as a successful answer
**Persona:** Technical operator
**Where:** `src/lib/agentrun.ts:283-289` (`compose`), `:246-249` + `:218-221` (`gatewayAnswer` swallows `!res.ok` and every throw as `null`)
**What:** When the gateway returns non-200 or times out, `gatewayAnswer` returns `null` and `compose` returns `Based on ${hits.length} source(s): ${hits[0].snippet}` — the first retrieved snippet, presented as the agent's answer. The run persists with status `ok`, the `answer/compose` step shows that text, and `onUsage` never fires so tokens/cost record as zero.
**Why it matters (demo):** if a node is loaded or the model is cold during a live run, the agent "answers" with a raw document excerpt and the run is green. He would be demoing a fabricated answer without knowing.
**Fix (demo-cheap):** have `compose` return a distinguishable failure so the run persists `status:'error'` with "the model did not answer — retry"; keep the snippet out of the answer field.

## Out of scope for the demo (one line each)

- `src/lib/cache.ts:87` — the response cache key (`resp:<sha256(prompt)>`) has no org namespace, and the in-process SEMANTIC layer (`bestSemantic`, threshold 0.92) matches across orgs/models/system-prompts, so a cached answer can cross tenants and misattribute the serving model. No visible demo symptom.
- `src/lib/agentrun.ts:283` — a cache hit skips `onUsage`, so cached runs record zero tokens/cost (contributes to the Spend zeros above but is not itself visible).
- `runtime/pipelines/**` and `runtime/api` are `export { default } from '@/app/(console)/build/...'` aliases — the same entity has two canonical URLs; an IA/Back-coherence question with no demo symptom.
