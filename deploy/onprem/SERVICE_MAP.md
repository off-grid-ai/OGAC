# Off Grid — service & subdomain map

The authoritative "what runs where" for the on-prem fleet. Keep this in sync when
you add a node, a subdomain, or a service.

## Public subdomains (Cloudflare tunnel → Caddy → upstream)

| Subdomain | Serves | Upstream | Auth |
|-----------|--------|----------|------|
| `onprem-console.getoffgridai.co` | The Console (this app) | `127.0.0.1:3000` | Keycloak session |
| `ai.getoffgridai.co` | **AI Gateway** (OpenAI-compatible LLM aggregator) | `127.0.0.1:8800` | API key / Keycloak JWT |
| `gateway.getoffgridai.co` | Network gateway (public API edge) | Caddy → console `/api/*` | Public + WAF/rate-limit |
| `gateway.getoffgridai.co/files/*` | **Public file store** (SeaweedFS S3, media) | Caddy `handle_path /files/*` → `127.0.0.1:8333` | **GET/HEAD public; writes need Keycloak bearer** (forward_auth → `/api/auth/verify-write`) |
| `console-status.getoffgridai.co` | Status page | `127.0.0.1:9100` | Keycloak session |
| `console-landing.getoffgridai.co` | Landing page (`console-landing-page`, native `next start`, **launchd `co.getoffgridai.landing`**; deploy `console-landing-page/deploy/push.sh`) | `127.0.0.1:3100` | Keycloak session (Caddy `gated`) |
| `gungnir.getoffgridai.co` | **Provit** (Prove It — visual QA) | `192.168.1.60:7799` | Keycloak session |

> **Provit runs on S2 (`192.168.1.60`)** as a node process under launchd `co.getoffgridai.provit`
> (`/Users/admin/provit`, `src/ui/server.ts`, log `server.log`). If provit.* 502s, it's usually
> the process **crash-looping** — fix: `ssh admin@192.168.1.60` then
> `sudo launchctl kickstart -k system/co.getoffgridai.provit`. (S1 can SSH to S2.)
>
> **Caddy edge gotcha:** never `caddy run` manually — a rogue 2nd instance fights the launchd
> one (`co.getoffgridai.edge`) for :80 with a stale config → intermittent 502s on gated
> subdomains. Fix: `sudo pkill -9 -f 'caddy run'` then `sudo launchctl kickstart -k
> system/co.getoffgridai.edge`. Verify only ONE `caddy run` process remains.

> Note the DNS name is still `gungnir.*`; the product is **Provit**. Rename the
> subdomain to `provit.getoffgridai.co` when convenient and set `OFFGRID_PROVIT_URL`.

## Nodes

| Node | IP | Runs |
|------|----|----|
| **S1** (control plane + backends) | `127.0.0.1` | Console (native `next start`), **gateway aggregator :8800**, Caddy edge, Cloudflare tunnel, queue worker, and the **`offgrid-services-a`/`-extra` Docker stacks**: Postgres, Keycloak, **OpenSearch :9200, Marquez :9000, OpenBao :8200**, OPA :8181, Qdrant :6333, Temporal :7233/:8081, SeaweedFS, VictoriaMetrics, Evidently + the seeded data-source containers. Console reaches all of these over **127.0.0.1** (localhost — not gated by Local-Network privacy). |
| **g6** (server #2 — aux tier) | `192.168.1.66` | Langfuse `:3030`, Unleash `:4242`, Superset `:8088`, FleetDM `:8070`, Presidio `:5002/:5001`, Redis (the canonical aux-tier copy the console points at). MAXED 15.5/16 GB. Console reaches these via S1 Caddy loopback proxies (LAN not directly reachable by the console daemon). |
| **S2** (data plane) | `192.168.1.60` | **LIVE (2026-07-08):** the data engine under OrbStack — warehouse-clickhouse `:8124`, redpanda `:19092/:9644`, 6× airbyte-* `:8005/:8006`, great-expectations `:8003`. Console reaches these via S1 Caddy loopbacks `127.0.0.1:8941–8944`. (S2 had auto-restarted a redundant `offgrid-services-b` aux tier on reboot — **stopped**, since g6 is the canonical copy — to free the 16GB box for the data plane.) |

### Data plane (LIVE on S2, 2026-07-08) — `warehouse` / `streaming` / `etl` / `dataquality` profiles

The data engine (ClickHouse warehouse + Redpanda + Airbyte + Great Expectations; dbt as a job),
running under **OrbStack** on S2. Full bringup + runtime + env wiring: [`DATA_PLANE.md`](DATA_PLANE.md).
Services + host ports:

| Service | Profile | Host port(s) | Purpose |
|---------|---------|--------------|---------|
| `warehouse-clickhouse` | `warehouse` | 8124 (HTTP), 9001 (native) | Analytics warehouse (BI/dbt read it) — distinct from langfuse-clickhouse |
| `redpanda` | `streaming` | 19092 (Kafka), 9644 (admin), 18083 (schema) | Kafka-API broker |
| `airbyte-*` (6 containers) | `etl` | 8005 (API), 8006 (UI) | Connectors + CDC (own Postgres + Temporal) |
| `great-expectations` | `dataquality` | 8003 | Data-quality sidecar (mirrors evidently/ragas) |

Console env (SET LIVE on S1 `.env.local` 2026-07-08): `OFFGRID_WAREHOUSE_URL`, `OFFGRID_AIRBYTE_URL`,
`OFFGRID_REDPANDA_ADMIN_URL`/`_BROKERS`, `OFFGRID_DATAQUALITY_URL` — via edge-Caddy loopbacks
`127.0.0.1:8941–8944` (LAN not reachable by the console daemon). The four engines are registered in
the console health directory (`src/lib/services-directory.ts`: warehouse/airbyte/streaming/data-quality)
so they appear + health-probe on the Services page. Lake landing = existing SeaweedFS S3.

**Console consumers (ports-and-adapters + admin APIs)** — AWS-parity map: [`../../docs/platform/DATA_PLANE_PARITY.md`](../../docs/platform/DATA_PLANE_PARITY.md):
- `src/lib/adapters/warehouse.ts` (ClickHouse) → `GET /api/v1/admin/warehouse` (catalog), `GET /warehouse/[table]` (detail), `POST /warehouse/query` (read-only SQL = "Query"/Athena).
- `src/lib/adapters/airbyte.ts` (Airbyte) → `GET /api/v1/admin/etl`, `POST /etl/sync` ("Data movement" = Glue/DMS).
- `src/lib/adapters/data-quality.ts` (Great Expectations) → `GET /api/v1/admin/data-quality`, `POST /data-quality/run` ("Data quality").
- Data-plane management surface at `/data/*` (product language — OSS names never shown). Seed: `seed-warehouse.mjs` (600k-row `bfsi` schema).
- **Governance on the movement path:** PII redaction (Presidio, the same engine as model-access guardrails) + M4 classification-driven column masking + data-allowlist ceiling + Great-Expectations quality gate, all applied as data moves → warehouse; every sync emits into the spine (Marquez lineage + OpenSearch audit).

## AI Gateway aggregator (the LLM control point)

- **Process:** `console/scripts/gateway-aggregator.mjs` on S1, under launchd
  `co.getoffgridai.aggregator` (plist: `/Library/LaunchDaemons/co.getoffgridai.aggregator.plist`).
- **Listens:** `:8800`, OpenAI-compatible at `/v1/*`, MCP at `/mcp`.
- **Auth:** static API key via `x-api-key` **or** `Authorization: Bearer`. The key lives
  in the launchd plist (`OFFGRID_GATEWAY_API_KEY`) and in the console's `.env.local`
  (`OFFGRID_GATEWAY_API_KEY`) — **not committed to git**. Both must match.
- **Console wiring:** every server-side gateway call goes through `src/lib/gateway.ts`
  (`GATEWAY_URL` + `gatewayHeaders()`), which attaches the key. Set on the server:
  ```
  OFFGRID_GATEWAY_URL=http://127.0.0.1:8800
  OFFGRID_GATEWAY_API_KEY=<key from the plist>
  ```
- **Modalities live:** text, vision, embeddings, transcription, speech.
  (image generation/edit: not installed.)
- **Rate limiting / WAF is the Caddy edge's job, NOT the aggregator.** The public edge
  (`gateway.getoffgridai.co`, the root `caddy run` on S1) does rate limiting + WAF; the Next.js
  `src/middleware.ts` adds a 60 req/min per-IP layer. The aggregator legitimately exposes no
  rate-limit endpoint — don't file that as a gap.

### Cloud model routing (egress-leashed) — gap #26, Phase D

The aggregator round-robins **LOCAL** nodes only. When a routing rule (`routing-policy.ts`
`decideRouting`) resolves to `cloud`, the **console** forwards the OpenAI-compatible request to a
configured cloud provider — governance stays in the console, where routing rules, the egress
switch, FinOps cost, and the audit ledger already live. The aggregator is unchanged.

- **Providers (env-configured, keys NEVER in git):** `openai`, `anthropic` (via its OpenAI-compatible
  `/v1`), and a generic `compat` OpenAI-compatible base URL. See SERVER_STATE.md § Console env for the
  `OFFGRID_CLOUD_*` vars. A provider is only *wired* when it has both a base URL and an API key.
- **Governance (enforced in the pure `cloud-routing.ts` chokepoint, unit-tested):** a `block`/`local`
  decision or `data_class=pii` NEVER reaches cloud; **org egress OFF (`policies.egress_allowed`, default
  false) hard-stops all cloud** (a cloud route is leashed to block); a cloud route with no configured
  provider **falls back to local** (never fabricates a cloud response).
- **Attribution + audit:** a cloud call is audited as `gateway.egress` with the provider-namespaced
  model (`openai:gpt-4o-mini`) + real token usage, so FinOps prices the cloud spend; leashed /
  unavailable cloud routes emit `gateway.egress.blocked` (leash + honest-degradation proof).
- **Console surface:** Gateway → **Cloud providers** tab (`/api/v1/gateway/providers`) shows each
  provider configured + reachable + whether egress is on — a cloud model reads *available* only when
  all three hold (Services honest-health pattern). Keys are never returned.

### Gateway nodes → models (each node runs Off Grid Desktop/headless on `:7878`)

| Node | IP | Model | Modality |
|------|----|-------|----------|
| g1 | `192.168.1.57` | qwythos-9b | text + vision |
| g2 | `192.168.1.58` | qwen3.5-9b | text + vision |
| g3 | `192.168.1.32` | qwythos-9b | text + vision |
| g4 | `192.168.1.63` | qwythos-9b | text + vision |
| g5 | `192.168.1.65` | gemma-4-e4b | text + vision |
| ~~g6~~ | `192.168.1.66` | — (drained → **server #2 / aux tier**) | — |
| g7 | `192.168.1.62` | qwen3-coder-30b | text |
| g8 | `192.168.1.64` | (confirm before pulling) | — |

The aggregator round-robins per model across the nodes serving it. Live pool +
health: `curl -H 'x-api-key: <key>' http://127.0.0.1:8800/` → `gateways[]`.
To add a node: edit `POOL` in `gateway-aggregator.mjs`, redeploy, kickstart the
launchd job (see `GATEWAY_PROVISIONING.md`).

## Internal services (probed by the Services page)

| Service | Host:port | Health path | Notes |
|---------|-----------|-------------|-------|
| Keycloak | `127.0.0.1:8080` | `/health/ready` | IAM |
| Qdrant | `:6333` (env `OFFGRID_QDRANT_URL`) | `/healthz` | vector store |
| OpenSearch | S1 `127.0.0.1:9200` (`OFFGRID_OPENSEARCH_URL`) | `/_cluster/health` | SIEM/analytics/audit; index `offgrid-gateway` (Analytics), `offgrid-audit` (SIEM) |
| Temporal (UI) | S1 `127.0.0.1:8081` (API `:7233`) | `/` | workflows |
| OPA | S1 `127.0.0.1:8181` | `/health` | policy |
| OpenBao | S1 `127.0.0.1:8200` (`OFFGRID_OPENBAO_URL`) | `/v1/sys/health` | secrets; token `offgrid-dev-token`, KV v2 mount `secret` |
| Marquez | S1 `127.0.0.1:9000` (`OFFGRID_MARQUEZ_URL`) | `/api/v1/namespaces` | lineage; namespace `default` |
| Langfuse | g6 `:3030` via `127.0.0.1:8931` (edge-Caddy loopback) | `/api/public/health` | observability |
| Unleash | g6 `:4242` via `127.0.0.1:8932` (edge-Caddy loopback) | `/health` | flags |
| Superset | g6 `:8088` via `127.0.0.1:8933` (edge-Caddy loopback) | `/health` | BI / analytics embed |
| FleetDM | g6 `:8070` via `127.0.0.1:8934` (edge-Caddy loopback) | `/healthz` | MDM |
| Presidio | g6 `:5002` / `:5001` — **not yet wired** (needs edge-Caddy 8938/8939 + edge reload) | `/health` | PII masking (Guardrails on regex floor until wired) |

> **Two connectivity classes:** (1) **S1-local backends** (OpenSearch/Marquez/OpenBao/OPA/Qdrant/
> Temporal) — the console reaches them DIRECTLY at `127.0.0.1:<port>`; no proxy. (2) **g6 aux tier**
> (Langfuse/Unleash/Superset/FleetDM/Presidio) — on the LAN, which the SSH-launched `next-server`
> can't reach (macOS 15 Local-Network privacy), so the **edge Caddy** fronts each on `127.0.0.1:893x`
> and the console's `OFFGRID_*_URL` point at the loopback. Map: 8931 Langfuse · 8932 Unleash · 8933
> Superset · 8934 FleetDM · (8938 Presidio-analyzer / 8939 Presidio-anonymizer — staged in the
> Caddyfile, pending an edge-Caddy reload).

> If any of these show **Down** on the Services page, the `OFFGRID_*_URL` env var on
> S1 is pointing at `127.0.0.1` (only correct for services actually on S1). Set the
> real host in the console's `.env.local` and restart.
