# E2E Vision Audit — bharatunion (bank) demo

**Tier:** E2E — real browser (Playwright) → real deployed server → real seeded data, zero mocks.
**Target:** `https://bharatunion-onprem-console.getoffgridai.co` (read-only viewer `demo-bank@getoffgridai.co`).
**Harness:** `scripts/shoot-all.mjs` (crawls every navigable route + state changes → `manifest.json`).
**Date:** 2026-07-11.

## How this was run

The harness lives on the `wave2-tenant-isolation-prompts-analytics-evals` branch (main console dir,
which has `node_modules`/Playwright and the deployed route set). It was run *from the main console
dir* (so route discovery matches deploy) with `--out` pointing into this worktree's `.shots/`. The
noise-filtered copy of the script (STEP 1) was used for every pass.

Passes captured (all in `.shots/`):

| dir | theme | viewport | scope | PNGs |
|---|---|---|---|---|
| `bank-light` | light | wide 1440×900 | full crawl (browser died at `/operations/config`) | 65 |
| `bank-light2` | light | wide | re-crawl of the routes the crash skipped (`/operations/*`, `/overview`, `/workspace/*`) | 18 |
| `bank-dyn` | light | wide | dynamic `[id]` detail routes (pipelines, gateway, governance, data, apps) | 22 |
| `bank-mobile` | light | mobile 390×844 | top routes | 46 |
| `bank-dark` | dark (requested) | wide | top routes | 46 |

The first light pass's browser process closed mid-crawl (exit 144) — every route from
`/operations/config` onward and every dynamic route came back `status:0`
("Target page … has been closed"). Those are **crawl artifacts, not app defects**; `bank-light2`
and `bank-dyn` re-captured them cleanly (exit 0), so coverage is complete.

## Verdict summary

- **PASS: the console is coherent, populated, and on-brand.** Every module renders full-width with
  sensible Indian BFSI seed data (INR, PAN/IFSC/CIBIL/NEFT, Indian names, bharatunion tables). CRUD
  affordances (create/edit/delete/run) are present across modules. No blank pages, no stack traces,
  no React error boundaries observed.
- **The 17 `broken-state text on page` failures in the light manifest are ALL false positives** of
  the harness heuristic (regex `/…|500|…/i` matches benign copy like "kill switch", "$500", status
  words). Every one was vision-confirmed to render correctly. See the harness note below.
- **Real defects found: 4** (1 high, 3 medium/low). Top defect: the operator home page names an OSS
  engine and shows it down.

**Counts:** routes/states audited by vision ≈ 45 distinct + spot-checks. PASS: ~41. SUSPECT: 3.
BROKEN (app-level): 1 (the overview LLM-GUARD card).

## Per-route table (audited by vision)

| Route | vp / theme | Verdict | Notes |
|---|---|---|---|
| `/overview` | wide/light | **BROKEN** | PII-GUARDRAILS card reads **"LLM-GUARD" / "engine unreachable"** — forbidden OSS name + down-state on the home page. See D1. |
| `/overview` | mobile/light | PASS | Stacks cleanly, hamburger nav. Same LLM-GUARD card (D1). |
| `/workspace/chat` | wide/light | PASS | Private-AI empty state, recent BFSI chats (KYC re-verify, 90-DPD dunning, NEFT reconciliation). Model selector = `qwythos-9b (vision)` — see D2. |
| `/workspace/chat` | mobile/light | SUSPECT | Chat sub-toolbar row is cramped/clipped (model selector truncated). Minor. |
| `/build/studio` | wide/light | PASS | 9 apps grid (Cross-Sell Advisor, Fraud Screening, Loan Underwriting…), 89% metric. |
| `/build/tools` | wide/light | PASS | 4 registered tools (Sanctions Screening, NEFT/IMPS Status, CIBIL Score Check, Core Banking Lookup) + full CRUD. (flagged broken = false positive) |
| `/build/review` | wide/light | PASS | Empty review queue, clean "all caught up" empty state. (false positive) |
| `/build/apps/runs` | wide/light | PASS | Populated App-runs table (Motor Claims FNOL Triage, Cross-Sell Advisor, statuses). (false positive) |
| `/build/apps/reports` | wide/light | PASS | 89 runs / 65 completed / HITL 18-approved / step mix — richly populated. |
| `/build/pipelines/[id]` (Cross-Sell Advisor) | wide/light | PASS | Full lifecycle + tabbed detail (Gateway&Routing, Policy, Guardrails, Quality, Drift, Observability, Audit, Cost, API, Versions). Reference list→detail pattern. |
| `/build/pipelines/[id]/guardrails` | wide/light | PASS | Mask-PII / injection / grounding / toxicity toggles, org-locked badges. Clean. |
| `/build/apps/[id]` (+ all subroutes) | wide/light | SUSPECT | Harness could not resolve any app id — `/build/apps` (Studio) does not expose `/build/apps/[id]` links to crawl. App detail *is* reachable via Studio cards, but the plain list has no drill-in href. See D4. |
| `/data` `/data/catalog` | wide/light | PASS | 12 datasets, 7 holding PII, bharatunion.* tables with PII tags (PAN, ACCOUNT_NUMBER, MEDICAL). |
| `/data/warehouse` | wide/light | PASS | 16 tables, 7,25,242 rows (Indian grouping), fact_/dim_ tables. (false positive) |
| `/data/warehouse` | mobile/light | PASS | Tab strip + stat cards scroll horizontally (intended); body doesn't break. |
| `/data/tool-catalog` | wide/light | PASS | MCP catalog (Filesystem/Git/GitHub/Sentry). (false positive) |
| `/data/lineage` | wide/light | PASS | Lineage graph. Exposes raw UUIDs (inherent to lineage). |
| `/data/catalog/[id]`, `/data/domains/[id]` | wide/light | PASS | Detail pages resolve + render. |
| `/data/connectors/[id]`, `/data/etl/[id]` | wide/light | SUSPECT | No id resolvable — connector/etl lists appear to have no drill-in links or are empty. Confirm seed. |
| `/governance` (Control) | wide/light | PASS | Policy v10, guardrails, allowed models, model-routing, version history. (false positive) |
| `/governance/regulatory` | wide/light | PASS | DPDP Act 2023, EU AI Act, ISO 42001, GDPR, NIST, HIPAA posture cards + DPIA download. (false positive) |
| `/governance/guardrails` | wide/light | PASS | PII detection + entity types + enable/scope CRUD. Shows the engine-unreachable state (related to D1). |
| `/governance/access`, `/teams`, `/secrets` (+ create dialogs) | wide/light | PASS | Lists + working create dialogs captured. |
| `/governance/teams/[id]`, `/access/[id]` | wide/light | PASS | Detail pages resolve + render. |
| `/insights` (Observability) | wide/light | PASS | Eval/drift/scoring/traced-runs. "LATEST EVAL SCORE: —" empty (no eval runs yet). See D3. |
| `/insights/analytics` | wide/light | PASS | Real charts (events/day, latency/day, tokens-by-model), populated. Strong page. |
| `/insights/finops` | wide/light | PASS | Spend/tokens/virtual-keys (Priya Sharma, Rahul Menon…). Spend $0.16 / budgets $0.00 (thin demo numbers). |
| `/insights/siem` | wide/light | PASS | 235 security events. Actor col all "unknown"; Detail col shows raw `agent:agent_xxxx` ids. See D3. |
| `/gateway/ai` (AI Gateway) | wide/light | PASS | Aggregator connected, modalities, model catalog "4 live · 24 total". URL shows double-slash `…:8800//v1`. See D3. |
| `/gateway/registry` (Gateways) | wide/light | PASS | Anthropic / DeepSeek / On-Prem Cluster (6/6 up) / OpenAI / OpenRouter / Zhipu (GLM) + Add/edit/delete CRUD. Cloud brand names are correct (NOT forbidden OSS names). |
| `/gateway/fleet/[id]` (Mumbai-BKC-Teller-01) | wide/light | PASS | Device detail: OS/role/policy/last-seen, assigned policy, allowed models incl. `qwythos-9b`. (flagged broken = false positive) See D2. |
| `/operations/admin` | wide/light | PASS | Org-wide system prompt ("Bharat Union's governed assistant… INR… never expose PAN/Aadhaar…"), pipeline binding + save. (false positive) |
| `/operations/backups` | wide/light | PASS | Backup-overdue alert, Run/Prune/Restore/Delete, schedule status. Full CRUD. (false positive) |
| `/operations/api-docs` | wide/light | PASS | (false positive) renders. |
| **All `bank-dark/*`** | wide/**dark** | **SUSPECT** | Every "dark" capture rendered in **LIGHT** mode — the `theme` cookie + `prefers-color-scheme:dark` did NOT switch the console. Dark mode is UNVERIFIED by this method. See D5. |

## Prioritized defect list

### D1 — [HIGH] Overview home page shows "LLM-GUARD" and "engine unreachable"
- **Where:** `/overview`, "Governance posture → PII GUARDRAILS" card (also surfaces on
  `/governance/guardrails` as the PII-detection engine state).
- **What:** The card literally renders **`LLM-GUARD`** with subtitle **`engine unreachable`**.
- **Why it's a defect (two problems):**
  1. **Forbidden OSS-engine name leak.** "LLM Guard" is on the never-show list. The operator's
     landing page must never name the underlying OSS engine — surface an outcome-level label
     (e.g. "PII & prompt-injection guardrails") instead.
  2. **Broken/unreachable state on the primary page.** Even relabeled, "engine unreachable" on the
     home dashboard reads as the platform being down. Either the guardrail engine is actually
     unreachable on the demo box (fix the deploy) or the health check is wrong (fix the probe).
- **Evidence:** `.shots/bank-light2/overview.png`, `.shots/bank-dark/overview.png`,
  `.shots/bank-mobile/overview.png`, `.shots/bank-light/governance_guardrails.png`.

### D2 — [MEDIUM] `qwythos-9b` model id surfaces across chat, gateway catalog, and fleet policy
- **Where:** `/workspace/chat` (model selector `qwythos-9b (vision)`), `/gateway/ai` (model catalog
  entry "qwythos-9b / Qwen 9B (fleet)", live), `/gateway/fleet/[id]` allowed-models
  (`qwythos-9b`).
- **What:** "qwythos" is on the forbidden OSS-engine name list, yet it appears user-facing as a
  served model id (presented as a Qwen-family fleet model).
- **Why it's a defect / needs a decision:** If `qwythos` is an internal codename for the local
  serving stack, it should be relabeled to the public model name (e.g. `qwen-9b-vision` or a
  product label). If it is a deliberate demo model id, confirm it is intentional and not a leaked
  engine name. Flagging as SUSPECT for the team to confirm.
- **Evidence:** `.shots/bank-light2/workspace_chat.png`, `.shots/bank-light/gateway_ai.png`,
  `.shots/bank-dyn/gateway_fleet_id_.png`.

### D3 — [LOW] Polish: raw ids, thin numbers, cosmetic URL
- **Raw ids user-facing:** `/insights/siem` Detail column shows `agent:agent_b76e819c` etc. (and
  Actor is uniformly "unknown"); `/data/lineage` lists raw UUIDs. Consider friendly labels /
  hiding internal ids in the SIEM detail column.
- **Empty eval state:** `/insights` "LATEST EVAL SCORE: —" and "No eval runs yet" — expected until a
  QA sweep runs, but on a demo it reads empty; consider seeding one eval run.
- **Thin FinOps numbers:** spend $0.16, budgets $0.00 across all virtual keys — reads under-seeded
  for a demo.
- **Cosmetic:** `/gateway/ai` aggregator URL renders with a double slash `http://offgrid-s1.local:8800//v1`.
- **Evidence:** `.shots/bank-light/insights_siem.png`, `insights.png`, `insights_finops.png`,
  `gateway_ai.png`, `data_lineage.png`.

### D4 — [LOW] `/build/apps` list has no crawlable drill-in to `/build/apps/[id]`
- **Where:** `/build/apps/[id]` and its 10 subroutes could not be resolved — the harness found no
  `/build/apps/<id>` href on the apps list. App detail *is* reachable from Studio cards, but a plain
  apps list with no deep-link href is a mild list→detail gap (per the IA rule). Confirm the apps
  index exposes real detail links.
- **Evidence:** `bank-dyn` manifest — all `/build/apps/[id]*` rows `notes: could not resolve a real id`.

### D5 — [MEDIUM, unverified] Dark mode not switchable via cookie / prefers-color-scheme
- **What:** Every `bank-dark` capture rendered identical to light despite `theme=dark` cookie,
  `colorScheme:'dark'` context, and `--theme=dark`. The top-bar theme toggle (moon icon) exists, so
  a dark theme probably ships — but it is **not driven by the `theme` cookie or the OS
  `prefers-color-scheme`**, so it can't be forced headlessly and could not be verified here.
- **Impact:** Dark-mode correctness/contrast is UNVERIFIED. Also: if a returning user's OS is dark,
  the console may ignore it (light-only until they click the toggle). Worth confirming the theme
  provider reads the OS/cookie.
- **Next check:** click the in-app moon toggle in a headed session, or wire the harness to click it
  after login, then re-audit contrast.
- **Evidence:** `.shots/bank-dark/*.png` (all light).

## Harness note (STEP 1 + a follow-up finding)

- **STEP 1 done:** console-error capture now ignores `cloudflareinsights.com` / `beacon.min.js`, so
  `ok` no longer flips false on every page from the harmless Cloudflare beacon CSP report. Committed.
- **Follow-up (recommend, not done here):** the `brokenState` regex
  `/application error|unhandled|something went wrong|500|stack trace/i` over-flags — `500` matches
  "$500 / 1500 / 500ms" and other tokens match benign copy ("kill switch", "review"). It produced
  **17/17 false positives** in this run. Tighten to word-boundaried / error-boundary-specific
  signals (e.g. Next.js error-boundary text, `Application error: a client-side exception`,
  HTTP-status ≥ 500 from the response, not body text) so `ok` is trustworthy.
- **Stability:** the first full light crawl's browser died at ~65 routes (exit 144) — long fullPage
  crawls should restart the context every N routes or run in smaller batches.

---

## 2026-07-12 — #240 fixes verified live + definitive both-tenant pass (in progress)

Post-fix clean-state pass on both tenants (`suraksha` insurer + `bharatunion` bank).

**Closed + verified live this session:**
- **In-app demo hellobar showed the wrong tenant's login** (insurer showed the bank's
  `demo-bank@`). Root cause was NOT seed/env — the shared `(console)` layout keyed the banner off
  `headers().get('host')`, which is host-ambiguous on a post-login **client RSC navigation** (correct
  on hard reload, wrong on client-nav). Fixed by resolving the tenant from the signed-in **org**
  (`currentTenantSlug()` → pure `slugForOrg()`), host as fallback. Verified 4/4 both tenants via the
  exact failing path. See memory `feedback-rsc-nav-host-ambiguous`.
- **Duplicate knowledge collection per tenant** ("Insurance Policies & SOPs" / "BFSI Policies &
  SOPs" — the seed ran twice, each copy with its own 3 docs). Deleted the newer copy + its docs +
  chunks on the live DB in a transaction (kept the 18:14 originals); 0 dupes remain; Knowledge UI
  now shows exactly one card per tenant. Code already prevents new dupes.

**Still open (NOT this repo — private fleet-orchestration seed scripts):**
- Bank-flavored FinOps data on the insurer tenant (`@bank.example` owners, "Personal Loan
  Underwriting Assist", "corebank → warehouse" pipeline) — needs a private-repo seed edit + reseed,
  and the `coreins` DB role. Flagged for the fleet-repo session.

**Definitive vision pass:** capturing all 72 static + 48 dynamic-template routes (+ tab states) for
both tenants (dark theme) into `scratchpad/vision-{insurer,bank}`, then per-screen vision review.
Findings appended below as batches land.
