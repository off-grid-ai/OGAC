# Demo lens — Gateway / services / devices + Operations observability

Reviewer: conference-demo reviewer (stage lens only).
Scope: `/runtime/gateways`, `/operations/services`, `/operations/devices` (+ `gateway/**` impls);
`operations/health/**`, `operations/metrics/**`.
Inputs: `docs/audit/2026-08-05/gateway.md`, `docs/audit/2026-08-05/operations-observability.md` (re-scored,
not re-derived) + screenshots shot live from `127.0.0.1:3005` and judged as projected 16:9 images.

Severity: **DEMO-BLOCKER** / **DEMO-RISK** / **POST-DEMO**.

## Findings

### 1. [DEMO-BLOCKER] `/operations/services` — every one of ~34 cards reads "⟳ checking", forever
**What the audience sees:** the biggest, most impressive surface in this section — "every service in
your private AI stack, with live health" — and not one green dot. Every card's status line is a
spinner plus the grey word `checking`, next to an internal hostname (`offgrid-s1.local:4000`,
`onprem-console.getoffgridai.co`, `in-process`). Screenshot: `/tmp/audit/demo-ops/operations_services.dark.png`.
**Why:** `ServicesDirectory.tsx:136-144` `if (!res.ok || !alive) return;` + `catch {}` leaves
`health = {}`, so a 403 or any failed batch health fetch is *visually identical to still loading*, and
it re-polls every 30s without ever changing. Same on the detail page (`ServiceDetail.tsx:52,64`:
"Live probe: Checking", "Latency: —", "Collecting first sample…").
**Stage cost:** this is the "here is your own private AI infrastructure, running" screen. If it renders
all-spinners on the conference network (or on any probe failure), the story inverts: it looks like
nothing is running. The correct pattern already exists in this repo
(`WorkerReadinessPanel.tsx:31-38`, `DeviceSoftware.tsx:31-33`) and is simply not applied here.

### 2. [DEMO-BLOCKER] The service cards' gate chips are ellipsized to noise — `DEPLOY… REACHA… FUNCTI… SEEDED CONSOL…`
**What the audience sees:** five tiny pill badges per card, four of them truncated mid-word, in ~9px
uppercase. Illegible on a laptop; pure texture from row 10. Beside them a second unreadable line,
`CAPABILITY AUDIT  6/7 in workflow` — and on several cards `0/1 in workflow`, `1/4`, `1/7`,
`4/10`. A ratio with no stated denominator meaning, mostly reading as "mostly not done".
**Stage cost:** a wall of truncated jargon chips and bad-looking fractions is the single strongest
"work in progress" signal on any screen in my scope. Either widen/relabel the chips to 2–3 readable
words, or hide the gate chips and the `n/m in workflow` line on the LIST and keep them on the detail.

### 3. [DEMO-BLOCKER] Raw engine and infra names are the user-visible labels across services
**Where:** `services-directory.ts` labels/descriptions — "LiteLLM Router", "PostgreSQL + pgvector",
"LLM Guard through the sharded guardrail aggregator", "Cloudflare Tunnel", "SeaweedFS", "LanceDB",
"Qdrant", "Redis", "Keycloak", "Open Policy Agent", "Caddy", "Prometheus", "FleetDM (osquery)";
plus `ServiceDetail.tsx:250` renders `dependency.serviceId` **verbatim**, so `postgres`, `redis`,
`opensearch`, `litellm`, `keycloak`, `qdrant`, `openbao`, `temporal`, `langfuse` appear as chips.
Internal hostnames and ports (`offgrid-s1.local:8800`, `:4000`, `:8010`) are on the card face.
**Stage cost:** to a technical audience this is fine and even credible. To the business half of the
room it is a screenshot of somebody's docker-compose. The founder should either state up front
"these are the open-source engines we run for you" (turning it into an asset) or the list should lead
with the capability name and demote the engine to the detail page. This is a copy change, not a refactor.

