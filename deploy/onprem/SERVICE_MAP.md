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
| `console-landing.getoffgridai.co` | Landing page | `127.0.0.1:3100` | Keycloak session |
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
| **S1** (control plane) | `127.0.0.1` | Console (native `next start`), Postgres (OrbStack), Keycloak, **gateway aggregator :8800**, queue worker, Caddy edge, Cloudflare tunnel |
| **g6** (server #2 — aux tier) | `192.168.1.66` | Langfuse `:3030`, Unleash `:4242`, Superset `:8088`, FleetDM `:8070`, Presidio `:5002/:5001`, Redis (provisioned 2026-07-05; **S2 replacement — S2 retired**). MAXED 15.5/16 GB. |
| **g5** (server #3 — node-c) | `192.168.1.65` | OpenSearch `:9200` (SIEM), Marquez `:9000` (lineage), OpenBao `:8200` (secrets) — `services-node-c.yml` (provisioning 2026-07-05; g6 was maxed so these moved to a 3rd server). Drained from the GW pool. |
| ~~S2~~ (retired) | `192.168.1.60` | ❌ offline since router reboot — aux tier moved to g6, node not required |

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

### Gateway nodes → models (each node runs Off Grid Desktop/headless on `:7878`)

| Node | IP | Model | Modality |
|------|----|-------|----------|
| g1 | `192.168.1.57` | qwythos-9b | text + vision |
| g2 | `192.168.1.58` | qwen3.5-9b | text + vision |
| g3 | `192.168.1.32` | qwythos-9b | text + vision |
| g4 | `192.168.1.63` | qwythos-9b | text + vision |
| ~~g5~~ | `192.168.1.65` | — (drained → **server #3 / node-c**: OpenSearch/Marquez/OpenBao) | — |
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
| OpenSearch | g5 `:9200` via `OFFGRID_OPENSEARCH_URL=http://127.0.0.1:8935` (Caddy loopback) | `/_cluster/health` | SIEM / logs (node-c) |
| Temporal (UI) | `127.0.0.1:8081` | `/` | workflows |
| OPA | `127.0.0.1:8181` | `/health` | policy |
| OpenBao | g5 `:8200` via `OFFGRID_OPENBAO_URL=http://127.0.0.1:8937` (Caddy loopback) | `/v1/sys/health` | secrets (node-c); token `offgrid-root` |
| Marquez | g5 `:9000` via `OFFGRID_MARQUEZ_URL=http://127.0.0.1:8936` (Caddy loopback) | `/api/v1/namespaces` | lineage (node-c) |
| Langfuse | g6 `:3030` via `127.0.0.1:8931` (Caddy loopback) | `/api/public/health` | observability |
| Unleash | g6 `:4242` via `127.0.0.1:8932` (Caddy loopback) | `/health` | flags |
| Superset | g6 `:8088` via `127.0.0.1:8933` (Caddy loopback) | `/health` | BI / analytics embed |
| FleetDM | g6 `:8070` via `127.0.0.1:8934` (Caddy loopback) | `/healthz` | MDM |
| Presidio | g6 `:5002` (analyzer) / `:5001` (anonymizer) | `/health` | PII masking |

> **Loopback proxies (S1 Caddy):** the console (SSH-launched `next-server`) can't egress to the LAN
> (macOS 15 Local-Network privacy). Caddy on S1 fronts each aux service on `127.0.0.1:893x` and the
> console's `OFFGRID_*_URL` point at the loopback, not the node IP. Map: 8931 Langfuse · 8932 Unleash ·
> 8933 Superset · 8934 FleetDM (all g6) · 8935 OpenSearch · 8936 Marquez · 8937 OpenBao (all g5).

> If any of these show **Down** on the Services page, the `OFFGRID_*_URL` env var on
> S1 is pointing at `127.0.0.1` (only correct for services actually on S1). Set the
> real host in the console's `.env.local` and restart.
