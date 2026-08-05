# The Gateway & The AI Runtime — viewer-demo audit

Shot both tenants at 1600px as demo-insurer@getoffgridai.co (role viewer, org org_suraksha, host
suraksha-onprem-console.getoffgridai.co) and demo-bank@getoffgridai.co (role viewer, org org_bharat,
host bharatunion-onprem-console.getoffgridai.co) — harness printed the confirmed role + org both
times. Screenshots in `insurer/` and `bank/` next to this file. Also probed the live API directly
with curl (CSRF → `/api/auth/callback/password` → session), and used a small scroll-capture helper
(`scroll-shoot.mjs`, same dir) because several run-detail pages scroll inside an inner `div`, not the
document, so the harness's `fullPage` screenshot silently truncates them at the viewport height —
worth fixing in the harness itself, filed under LATER.

Routes covered: `/runtime/models` (+ cache, callbacks, spend), `/runtime/gateways` (+ detail),
`/runtime/pipelines` (+ detail, cost, policy, routing), `/runtime/api-budgets` (keys, clients,
budgets), `/runtime/api`, `/solutions/agents` (+ two agent detail + run-history pages),
`/solutions/apps`, `/solutions/tools`, `/operations/runs` (+ two real run detail pages), `/build`
(known-404, confirmed).

## Verdict for this section

Under the hood the governed chain is real — a completed app run traces through OPA policy, PII/
injection guardrails, retrieval, an LLM call, grounding scoring, and Ed25519 signing, and the app
correctly shows "Runs on: Cross-Sell Advisor." That is the best evidence available anywhere in the
console that this product does what it claims. But almost everything a technical buyer would check
next fails: the pipeline that a real run supposedly ran through shows **$0 / 0 tokens / 0 requests**
in its own cost ledger; the master Runs list labels an agent/app id as "Pipeline"; every built-in
agent card says "No pipeline"; API keys and token budgets are empty on both tenants; and three
forbidden OSS engine names (LiteLLM, OPA, and the "llm-guard" tag) print directly on screen at
exactly the moments a skeptical reader would be looking closest. An unguided investor who pokes at
this section for five minutes — which the brief says they will — comes away doubting the chain more
than believing it, which is the opposite of what this section exists to prove.

## BLOCKERS
(cheapest fix first)

1. **`/operations/runs` — the top four rows of the platform's master run list are literally named
   `[autotest] Claim event feed · Assess claim risk`.** This is the exact placeholder-data pattern
   the brief calls fatal by name ("`[autotest]`, `probe`"), on the single screen most likely to be a
   stranger's first "show me a real run" click. Screenshot: `insurer/operations_runs.png` (top 4 of
   8 visible rows). Smallest fix: delete/exclude autotest-tagged runs from the seed data or filter
   them out of `listAllRuns` for non-admin/demo contexts.

2. **`/runtime/models/cache` — `BACKEND: redis` names the engine on the face of the screen.** "redis"
   is on the brief's forbidden-OSS-name list, printed as a plain field value, not a tooltip.
   Screenshot: `insurer/runtime_models_cache.png`. Smallest fix: route the field through
   `publicLabel()` → "in-memory response cache."

3. **`/runtime/models` — the gateway's card prints a raw internal endpoint:
   `http://offgrid-s1.local:8800/v1`.** Internal hostname, internal port, plaintext http, on the
   second line of the page. Screenshot: `insurer/runtime_models.png`. Smallest fix: show a friendly
   label ("Primary gateway · on-prem cluster") by default; put the literal URL behind a "copy
   endpoint" affordance instead of printing it.

4. **`/runtime/api-budgets/keys` — zero API keys exist, on both tenants.** "No API keys yet — create
   one to authenticate a client to the gateway," with a prominent green "New key" CTA, on tenants
   that each have 6–9 published pipelines and (per the Clients tab) real recorded client traffic.
   This is the exact surface the brief names — "a key list must prove a key exists" — and it can't.
   Screenshots: `insurer/runtime_api-budgets_keys.png`, `bank/runtime_api-budgets_keys.png` (both
   identical empty state). Smallest fix: seed one named, masked key per tenant (e.g. "Claims app ·
   sk-***3f2a · created 90d ago · last used 6h ago").

5. **`/runtime/api-budgets/budgets` — zero budgets configured, on a product whose pitch is governed,
   capped consumption.** "Token budgets · 0" / "No budgets issued yet." Screenshot:
   `insurer/runtime_api-budgets_budgets.png`. Smallest fix: seed one or two budget rows so
   Allocated/Used/Remaining/Usage render real numbers, not an empty table.

6. **`/runtime/models/callbacks` — the literal string "LiteLLM" and a wall of raw internal proxy hook
   names, twice.** The "Callback sinks" panel lists, verbatim, under both ON SUCCESS and ON FAILURE:
   `_PROXY_LiteLLMManagedVectorStores`, `_PROXY_LiteLLMManagedFiles`, `_ProxyDBLogger`,
   `_PROXY_MaxBudgetPerSessionHandler`, `_PROXY_CacheControlCheck`,
   `_PROXY_SensitiveDataRoutingHandler`, `_PROXY_MaxParallelRequestsHandler_v3`,
   `_PROXY_MaxIterationsHandler`, `_PROXY_VirtualKeyModelMaxBudgetLimiter`. LiteLLM is on the
   brief's forbidden list and is right there in two identifier names, and the rest is Python-
   internals-shaped jargon no business reader can parse. The adjoining "Per-call record shape"
   sample also prints `"gateway": "g5"` — an internal box codename. Screenshots:
   `insurer/runtime_models_callbacks.png`, `bank/runtime_models_callbacks.png`. Smallest fix: filter
   the sink list through `publicLabel()` (or an explicit allowlist) to show only user-meaningful
   sinks — "Cache," "Audit logging," "Budget enforcement," "PII routing" — and rename `gateway` in
   the sample to a friendly deployment name.

7. **A completed, real, multi-step app run through a published pipeline shows $0.00 / 0 requests / 0
   tokens on that pipeline's own Cost tab.** `Renewal & Persistency Nudge` (run `apprun_430e5c5c`,
   8/4/2026, 3 steps, 100s duration, a real ₹69,000 reasoning trace) is chipped "Runs on: Cross-Sell
   Advisor." Its child agent run (`agent:run_0d632888`) shows a real 10-step governed timeline —
   OPA policy check, guardrails, retrieval, an LLM call that took 57s, grounding, signing. Yet
   `/runtime/pipelines/pl_seed_org_suraksha_cross-sell-advisor/cost` reads "Spend $0.00 · Requests 0
   · Tokens 0 · No spend attributed to this pipeline yet." This is the single most damaging finding
   in the section: it directly answers the brief's central question ("do the numbers hold up?") with
   no. Screenshots: `insurer/solutions_apps_app_96fe960f_runs_apprun_430e5c5c.png`,
   `insurer/agent_run_detail_scroll0-2.png`,
   `insurer/runtime_pipelines_pl_seed_org_suraksha_cross-sell-advisor_cost.png`. Smallest fix: this
   needs the run executor to tag its gateway calls with `pipeline:<id>` the same way the Cost tab's
   own copy says it should ("Cost attributed to runs tagged `pipeline:pl_seed_...`") — currently
   nothing is tagging them.

8. **The "Pipeline" column across the whole platform is not a pipeline.** In `/operations/runs` the
   `Pipeline` column shows `agent_e48f144d`, `agent_0f43eba9`, `app_96fe960f`, `agent_c154f63e` — the
   run's own agent/app id, not a governed Pipeline entity. Confirmed in code:
   `src/lib/runs-monitor.ts` line 41 documents `pipeline` as "the pipeline / workflow this run
   belongs to (app id, agent id, or conversation ref)" and sets it to `src.appId` / `src.agentId` /
   `model ?? 'chat'` (lines 263, 283, 304). The run detail page repeats the same mislabel: opening
   `/operations/runs/agent%3Arun_0d632888` shows a field literally labeled `Pipeline` with value
   `agent_0f43eba9`. On the one screen built to answer "which pipeline did this go through," the
   answer given is wrong. Screenshots: `insurer/operations_runs.png`,
   `insurer/agent_run_detail_scroll0.png`. Smallest fix: rename the column/field to "Owner" (its
   actual meaning) and, separately, thread the real bound pipeline id through so a run can show its
   true governed pipeline.

9. **Every built-in agent shows "No pipeline."** All 5 catalog agents (SOP Synthesizer, FNOL Intake
   Assistant, Sales Coach, KYC Verifier, Audit Watch) — on both tenants — carry a "No pipeline" badge
   on their list card and their detail page ("Model: gateway default," "Pipeline: none"). Confirmed
   in code: `src/lib/agents.ts`'s five `AGENTS` entries never set `pipelineId`. This is the one
   surface where the console's own governing invariant (agent → pipeline → gateway → model, no
   skips) is checkable at a glance, and every row fails the check. It also means these 5 agents have
   zero run history — opening any one of them (e.g. FNOL Intake Assistant) shows "0 shown · 0
   completed... No runs yet." on a live, populated tenant. Screenshots:
   `insurer/solutions_agents.png`, `insurer/solutions_agents_fnol-intake.png`,
   `insurer/solutions_agents_fnol-intake_runs.png`, `bank/solutions_agents.png` (identical). Smallest
   fix: set `pipelineId` on each of the 5 `AGENTS` entries in `src/lib/agents.ts` to a matching
   already-seeded pipeline (e.g. `fnol-intake` → the `motor-claim-fnol`/FNOL pipeline that already
   exists per tenant) — a config-level change, not a new subsystem.

10. **Every write control on this section's screens is armed, not disabled, for the read-only
    viewer — and does 403 on submit.** Verified live via curl: `POST /api/v1/admin/gateways` as the
    signed-in viewer session returns `403 {"error":"forbidden","reason":"read-only demo: this
    account can view everything but cannot make changes"}` — the backend gate is correct. But
    `useViewerMode()` (`src/components/ViewerModeProvider.tsx`) has zero consumers anywhere in
    `src/`, so nothing on screen warns the viewer before they click: "Add gateway"
    (`/runtime/gateways`, bright green, fully enabled), the pencil/trash icons on every gateway and
    pipeline card, "New pipeline" (`/runtime/pipelines`), "New key"
    (`/runtime/api-budgets/keys`), "Issue / adjust" (budgets). The brief marks this class top-
    severity on sight. Screenshots: `insurer/runtime_gateways.png`, `insurer/runtime_pipelines.png`,
    `insurer/runtime_api-budgets_keys.png`, `insurer/runtime_api-budgets_budgets.png`. Smallest fix:
    one shared check — `useViewerMode()` → render these buttons disabled with a "read-only demo"
    tooltip; it is a single reusable fix, not one per page.

11. **A real run's policy/guardrail trace prints two more forbidden engine names on screen.** The
    agent run detail's Timeline shows step 1 as `opa | policy | allow — OPA decision
    (offgrid/authz): true` and step 5 as `llm-guard | mask | no PII to mask` — "OPA" and "LLM Guard"
    are both named on the brief's forbidden list, and both appear as plain tags on the most
    important trace screen in the whole section (see BLOCKER 7 for why this run matters).
    Screenshot: `insurer/agent_run_detail_scroll0.png`. Smallest fix: map step-kind labels through
    `publicLabel()` — "opa" → "Policy gate," "llm-guard" → "PII/safety scan" — same mechanism as
    BLOCKER 6.

## RISKS

1. **`/runtime/models/cache` — every cache-effectiveness stat is a dash** (hit rate "n/a", cache hits
   "—", tokens/cost saved "—", volume "2 req"). There IS an honest explanation banner ("This gateway
   does not stamp a cache_hit marker on its request logs...") — the right instinct, not a silent
   failure — but the practical effect for an unguided viewer is a stat panel that's entirely dashes.
   Screenshot: `insurer/runtime_models_cache.png`.

2. **The flagship real run's grounding score is 0%.** `agent:run_0d632888`'s Timeline step 8 reads
   "grounding · 0/10 claims grounded (0%)," and the guardrail-checks strip shows `grounding: warn`.
   This is honest telemetry (not faked as green), which is a point in its favor, but a stranger who
   reads "0%" next to a headline capability ("grounded in the claims SOP") will read it as the
   feature not working. Screenshot: `insurer/agent_run_detail_scroll1.png`.

3. **The app run's own metadata says "version not recorded · policy version not recorded."**
   `/solutions/apps/app_96fe960f/runs/apprun_430e5c5c` header reads "3/3 steps · started ... ·
   version not recorded · policy version not recorded" — on the app that most demonstrates the
   product. A technical buyer checking "what policy applied to this run" gets an admission that it
   wasn't captured. Screenshot: `insurer/solutions_apps_app_96fe960f_runs_apprun_430e5c5c.png`.

4. **`/runtime/api-budgets/clients` — 8 rows, `Routing overrides: none` and `Provider: jwt` for
   every one** — a real-looking, populated table, but every column that isn't the token/uses/last-
   seen is identical across all 8 rows, which reads as under-differentiated on a second look.
   Screenshot: `insurer/runtime_api-budgets_clients.png`.

5. **`/solutions/tools` (Registered) — "Used by" is `–` for all 5 registered tools** on a tenant with
   real app runs that plausibly call them (Premium Persistency Lookup, Policy Admin Lookup, etc. —
   the exact tools the Renewal & Persistency Nudge run would use). Attribution isn't wired.
   Screenshot: `insurer/solutions_tools.png`.

6. **Gateway enabled-state is inconsistent between the two tenants for the identical provider set.**
   On insurer, Anthropic/DeepSeek/OpenAI show tag "disabled" with the Enabled toggle OFF. On bank,
   the same three (plus Zhipu) show tag "not configured" with the Enabled toggle ON (green) while
   still reporting "unavailable." Toggled-on-but-unavailable is confusing on its own, and the two
   tenants disagreeing about whether the same never-configured cloud providers are "disabled" or
   merely "not configured" is the kind of cross-tenant inconsistency the brief flags when both links
   are being sent out. Screenshots: `insurer/runtime_gateways.png`, `bank/runtime_gateways.png`.

7. **Pipeline "Quality" panel shows 0 evals attached / golden set size 0 on a `published` pipeline
   that has a live consuming app** (`Cross-Sell Advisor` → Renewal & Persistency Nudge). Screenshot:
   `insurer/runtime_pipelines_pl_seed_org_suraksha_cross-sell-advisor.png`.

## Appropriateness findings

- `http://offgrid-s1.local:8800/v1` (internal hostname + port, plaintext) on `/runtime/models` — see
  BLOCKER 3.
- `redis` engine name on `/runtime/models/cache` — see BLOCKER 2.
- `LiteLLM` (twice) and a wall of `_PROXY_*` internal hook names on `/runtime/models/callbacks` — see
  BLOCKER 6.
- `OPA` and `llm-guard` engine names in the flagship run's policy/guardrail timeline — see BLOCKER 11.
- `"gateway": "g5"` — an internal box codename — in the callbacks page's sample JSON payload, see
  BLOCKER 6.
- `offgrid-s1.local` recurs as the value of the **"IPs"** column on `/runtime/api-budgets/clients`
  for every one of the 8 client rows (e.g. "offgrid-s1.local ×15") — an internal hostname mislabeled
  as a client IP, on the face of the table. Screenshot: `insurer/runtime_api-budgets_clients.png`.
- `/operations/runs`' "Durable worker readiness" panel prints raw poller identifiers —
  `14467@offgrid-s1 dev`, `10184@offgrid-s1 dev`, `61595@offgrid-s1 ed96a823` — PIDs, the internal
  hostname again, and git-sha-shaped build tags, on a page otherwise meant to read as "is the
  platform running." Screenshot: `insurer/operations_runs.png`.
- No cross-tenant data leakage was found — insurer and bank tenants' pipelines, agents, apps, keys,
  and clients are each scoped correctly to their own org (org_suraksha vs org_bharat) throughout
  everything reviewed. No plaintext secrets/connection strings were found in this section (the
  cross-sell/claims tools' bearer tokens on `/runtime/api-budgets/clients` are truncated, e.g.
  `eyJhbG…y_uQ`, which is the right pattern — proves existence without revealing the value).

## What is genuinely strong here

- **The one real, completed run traced end to end is legitimately good evidence.** `Renewal &
  Persistency Nudge` → agent run `agent:run_0d632888` shows an actual 10-step governed pipeline: OPA
  allow decision, plan, pre-guardrails (pii/injection/rules all "pass"), retrieval from a named
  governed source, PII masking, LLM compose (57s, real latency), grounding scoring, post-guardrails,
  and Ed25519 cryptographic signing of the final answer — with real Indian-BFSI data (policy numbers,
  ₹ amounts, masked PII tokens like `[PERSON_fd7f1919]`). This is exactly the kind of trace the brief
  is looking for, and if the cost-attribution and pipeline-naming defects above were fixed, this
  would be the best screen in the entire console to show a stranger.
- **Apps correctly show their pipeline binding** — every app on `/solutions/apps` carries a "Runs on:
  <Pipeline Name>" chip (Claims Fraud Screening, Policy Underwriting, Cross-Sell Advisor), which is
  the invariant working correctly at the App layer even though it fails at the built-in-Agent layer.
- **The Pipeline detail Overview page** (`/runtime/pipelines/<id>`) is a genuinely complete, well-
  organized governance summary in one screen: lifecycle stepper, gateway/egress binding, data-
  ceiling allowlist, policy/guardrail override counts, quality gate status, and consumers — with no
  OSS engine names on the face of it.
- **`/runtime/api` (API docs & playground)** is clean and appropriately labeled — "Secrets store,"
  "Vector store," "Policy engine," "Workflow engine" — generic, business-safe names throughout, a
  good model for how the callbacks/cache pages above should read.
- **The `/runtime/models/cache` explanation banner** for why hit-rate isn't shown is an honest
  disclosure of a real limitation rather than a silently-empty or fabricated number — the right
  instinct, just landing as a RISK rather than a BLOCKER because of how it reads unguided.

## LATER
- `/build` (bare path) 404s — confirmed, clean on-brand 404 page, not a crash. Not nav-reachable
  (Models/Gateways/Pipelines/API&budgets all live under `/runtime/*`), so only a stale bookmark or
  typed URL would hit it.
- `scripts/audit-shoot.mjs`'s `fullPage: true` screenshot silently truncates at the viewport height
  (1000px) on pages whose main content scrolls inside an inner `overflow-y-auto` div rather than the
  document body (both run-detail pages hit this) — worth teaching the harness to scroll the actual
  scroll container, not just `window`, so future audits don't need a one-off workaround script.
- `/runtime/pipelines/<id>` for the "AI Quality Judge" system pipeline (bank tenant) shows
  "Data ceiling: none" where every other pipeline shows a numeric domain count — inconsistent
  formatting, no visible harm.
