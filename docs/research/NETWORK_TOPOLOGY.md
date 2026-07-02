# Off Grid AI — Network Topology Research

**Date:** 2026-07-02  
**Scope:** Full network topology of the Off Grid AI stack (console + gateway + gungnir + edge proxies)

---

## 1. Full ASCII Topology

### 1a. Cloud / Internet-Facing (Cloudflare Tunnel)

```
Internet clients (browser, curl)
         │
         │  HTTPS (TLS terminated by Cloudflare edge)
         ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │                  Cloudflare Global Network                      │
  │   (tunnel: 00000000-0000-0000-0000-000000000000)               │
  └──────────────────────────────┬──────────────────────────────────┘
                                 │  outbound TCP (cloudflared daemon)
                   ┌─────────────┴──────────────┐
                   │     Office LAN / S1         │
                   │  (127.0.0.1)             │
                   │                             │
    Hostname routing by Cloudflare tunnel ingress:
    ┌──────────────────────────────────────────────────────────┐
    │ onprem-console.getoffgridai.co → 127.0.0.1:3000          │ Next.js console
    │ gateway.getoffgridai.co        → 127.0.0.1:8800          │ Off Grid Gateway
    │ console-status.getoffgridai.co → 127.0.0.1:80            │ Caddy (dev Caddyfile)
    │ console-landing.getoffgridai.co→ 127.0.0.1:80            │ Caddy (dev Caddyfile)
    │ gungnir.getoffgridai.co        → 127.0.0.1:80            │ Caddy → 192.168.1.60:7799
    │ *                              → http_status:404          │
    └──────────────────────────────────────────────────────────┘
```

### 1b. On-Premises LAN (On-Prem Caddyfile — S1 at 192.168.1.84)

```
LAN Clients (office WiFi)
         │
         │  HTTP :80  (plain HTTP, LAN-only names via dnsmasq)
         ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │   Caddy 2.8  (offgrid-edge container, docker-compose.edge.yml)  │
  │   Runs on S1 = 192.168.1.84                                     │
  └───────────────────────┬─────────────────────────────────────────┘
                          │
          ┌───────────────┴──────────────────┐
          │ Path routing on onprem-console.getoffgridai.co
          │                                   │
          │  /v1/* or /healthz                 │  everything else
          ▼                                   ▼
  ┌─────────────────────┐           ┌─────────────────────────┐
  │  Gateway pool        │           │  Console app pool        │
  │  (round-robin)       │           │  (round-robin)           │
  │  G1: 192.168.1.82   │           │  S1: 192.168.1.84:3000   │
  │  G2: 192.168.1.83   │  :7878    │  S2: 192.168.1.85:3000   │
  │  G3: 192.168.1.86   │           │                          │
  └─────────────────────┘           └──────────────────────────┘

  local.getoffgridai.co → 192.168.1.84:3100  (landing page)
```

### 1c. Dev Caddyfile (deploy/Caddyfile — runs on S1 :80, used by cloudflared)

```
  Caddy :80 (dev Caddyfile, no TLS)
         │
         ├── console-status.getoffgridai.co
         │       └── forward_auth → oauth2-proxy :4180
         │           └── reverse_proxy → 127.0.0.1:9100  (node-exporter)
         │
         ├── console-landing.getoffgridai.co
         │       └── forward_auth → oauth2-proxy :4180
         │           └── reverse_proxy → 127.0.0.1:3100  (landing page)
         │
         ├── gungnir.getoffgridai.co
         │       └── forward_auth → oauth2-proxy :4180
         │           └── reverse_proxy → 192.168.1.60:7799  (Gungnir)
         │
         ├── onprem-console.getoffgridai.co  (ungated)
         │   127.0.0.1 (direct IP)
         │       └── reverse_proxy → 127.0.0.1:3000  (console)
         │
         └── gateway.getoffgridai.co  (ungated)
                 └── reverse_proxy → 127.0.0.1:8800  (gateway)
```

### 1d. Complete Service Map (all ports)

```
┌────────────────────────────────────────────────────────────────────────┐
│  S1 = 127.0.0.1  (primary server)                                   │
│                                                                         │
│  :3000   Next.js console (offgrid-console app)                         │
│  :8800   Off Grid AI Gateway (NOT in compose — first-party binary)     │
│  :3100   Landing page                                                   │
│  :9100   node-exporter (Prometheus metrics)                             │
│  :80     Caddy (dev Caddyfile → cloudflared target)                    │
│                                                                         │
│  Compose services (profile-dependent):                                  │
│  :5432   Postgres + pgvector                                            │
│  :8333   SeaweedFS (S3 API)          9333: master                       │
│  :6333   Qdrant                                                         │
│  :8200   OpenBao (vault)                                                │
│  :8080   Keycloak (SSO)                                                 │
│  :8181   OPA                                                            │
│  :5002   Presidio Analyzer           5001: Anonymizer                   │
│  :8428   VictoriaMetrics             9428: VictoriaLogs                 │
│  :4317   OTel Collector (gRPC)       4318: HTTP                         │
│  :16686  Jaeger UI                                                      │
│  :3030   Langfuse                                                       │
│  :9000   Marquez API                 3001: Marquez Web  5010: admin     │
│  :7233   Temporal server             8081: Temporal UI                  │
│  :6379   Redis                                                          │
│  :9200   OpenSearch                  5601: Dashboards                   │
│  :4242   Unleash                                                        │
│  :8001   Evidently sidecar           8002: Ragas sidecar                │
│  :8088   Apache Superset                                                │
│  :8070   FleetDM                                                        │
│                                                                         │
│  Internal (not exposed):                                                │
│  langfuse-db :5432 (container-only)                                     │
│  langfuse-clickhouse :8123/:9000 (container-only)                       │
│  langfuse-minio :9000/:9001 (container-only)                            │
│  langfuse-redis :6379 (container-only)                                  │
│  marquez-db (container-only)                                            │
│  temporal-db (container-only)                                           │
│  fleet-mysql (container-only)                                           │
│  fleet-redis (container-only)                                           │
│  unleash-db (container-only)                                            │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  S2 = 192.168.1.85  (second console instance)                          │
│  :3000   Next.js console (replica)                                     │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  G1 = 192.168.1.82  Gateway node 1                                     │
│  G2 = 192.168.1.83  Gateway node 2                                     │
│  G3 = 192.168.1.86  Gateway node 3                                     │
│  :7878  Off Grid AI Gateway (OpenAI-compatible /v1)                    │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  Fleet node = 192.168.1.60  (Gungnir)                                  │
│  :7799   Gungnir dashboard + API                                       │
│  Calls out to: 127.0.0.1:8800/v1 (gateway aggregator)              │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  S1 = 192.168.1.84  (on-prem edge / Caddy per onprem Caddyfile)        │
│  :80     Caddy (LAN edge, docker-compose.edge.yml)                     │
│  :4180   oauth2-proxy (Keycloak forward auth — implied, not in compose)│
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Domains and Subdomains

| Domain | Where it resolves | Gated? | Target |
|--------|-------------------|--------|--------|
| `onprem-console.getoffgridai.co` | Cloudflare tunnel → S1:3000 | No (self-auth) | Next.js console |
| `gateway.getoffgridai.co` | Cloudflare tunnel → S1:8800 | No (API-key auth) | Off Grid Gateway |
| `console-status.getoffgridai.co` | Cloudflare tunnel → S1:80 → Caddy | Yes (oauth2-proxy) | node-exporter :9100 |
| `console-landing.getoffgridai.co` | Cloudflare tunnel → S1:80 → Caddy | Yes (oauth2-proxy) | landing page :3100 |
| `gungnir.getoffgridai.co` | Cloudflare tunnel → S1:80 → Caddy | Yes (oauth2-proxy) | Gungnir at 192.168.1.60:7799 |
| `onprem-console.getoffgridai.co` (LAN) | dnsmasq → 192.168.1.84 → Caddy | No | S1:3000 + S2:3000 (LB) |
| `local.getoffgridai.co` | dnsmasq → 192.168.1.84 | No | landing page :3100 |

Note: `console-api.getoffgridai.co` does **not** exist yet (see §9).

---

## 3. What Caddy Terminates

**dev Caddyfile** (`deploy/Caddyfile`, mounted by `docker-compose.edge.yml`):
- `auto_https off` — no TLS termination (Cloudflare tunnel handles TLS end-to-end)
- `admin off`
- **Auth:** `forward_auth` to `oauth2-proxy` at `127.0.0.1:4180` on the gated routes. This is a Keycloak-backed OIDC proxy — Caddy checks `/oauth2/auth` on each request and redirects to Keycloak login on 401/403.
- No rate limiting configured in Caddy itself.
- Passes `X-Auth-Request-User` and `X-Auth-Request-Email` headers downstream after successful auth.

**on-prem Caddyfile** (`deploy/onprem/Caddyfile`, LAN-only):
- `auto_https off` — LAN names are not internet-reachable
- No auth middleware — LAN-only traffic is implicitly trusted
- **Load balancing:** `round_robin` with active health checks on both console pool and gateway pool
- No rate limiting in Caddy

**TLS summary:** All TLS is handled by Cloudflare at the edge. Neither Caddy instance manages certificates.

---

## 4. How the Gateway at :8800 Fits

The Off Grid AI Gateway is explicitly **not** in docker-compose — it is a first-party binary that runs separately on each gateway node (G1/G2/G3) at port `7878` and on S1 at port `8800` (the "aggregator" entry point).

Flow:
```
client → gateway.getoffgridai.co
       → Cloudflare tunnel → S1:8800 (direct, ungated)

client → onprem-console.getoffgridai.co/v1/*  (LAN)
       → Caddy :80 → round_robin G1:7878 / G2:7878 / G3:7878
```

The gateway exposes an OpenAI-compatible `/v1` API. It handles:
- Token issuance and per-user/per-project budgets (FinOps — first-party, not a compose service)
- Model routing across the GPU nodes
- Semantic/exact response caching via Redis (when `OFFGRID_ADAPTER_CACHING=redis`)

Gungnir calls `127.0.0.1:8800/v1` directly (the S1 aggregator endpoint).

---

## 5. docker-compose.edge.yml vs Main Compose

| | `docker-compose.yml` | `docker-compose.edge.yml` |
|---|---|---|
| **Purpose** | Full capability stack — all 13 planes / ~35 services | Single Caddy reverse proxy, nothing else |
| **Profile system** | Yes — 13 profiles (`data`, `ai`, `secrets`, etc.) | None — single service |
| **What it runs** | Postgres, Keycloak, Qdrant, OpenBao, OPA, Presidio, VictoriaMetrics, Langfuse, Temporal, Redis, OpenSearch, etc. | One `caddy:2.8-alpine` container |
| **When used** | Server-side (compose up per deployment config) | On any machine that needs to act as the edge proxy (the `offgrid-edge` service) |
| **Port** | Various (host-mapped to compose services) | `${OFFGRID_PUBLIC_PORT:-80}:80` |
| **Caddyfile** | N/A | Mounts `./Caddyfile` (generated by `setup.sh`) |

`setup.sh` generates the `Caddyfile` next to `docker-compose.edge.yml`, then brings up only the edge container. The main compose is brought up separately on the backend servers.

---

## 6. Off Grid AI Gungnir

**Repo:** `off-grid-ai-gungnir/`  
**What it is:** A QA/fleet-management tool — serves a dashboard + API on `:7799`. It appears to be an LLM-judge / evaluation harness that inspects recorded sessions (captured frames + timelines + bug notes) and generates reports via the gateway.

**Compose (`off-grid-ai-gungnir/docker-compose.yml`):**
- Single service `gungnir`, built from local Dockerfile
- Exposed externally on `:7799`
- Environment: `GUNGNIR_BACKEND=gateway`, calls out to `GUNGNIR_ORACLE_URL` (default `http://127.0.0.1:8800/v1`) for inference
- Mounts two volumes: `/data/repos` (feature maps, batches, sessions) and `/app/recordings` (frames, timelines, bug notes)

**Network position:** Deployed on `192.168.1.60`. Reachable externally via `gungnir.getoffgridai.co` through Cloudflare tunnel → Caddy → oauth2-proxy (Keycloak-gated).

---

## 7. Ports: External vs Internal-Only

### Externally reachable (via Cloudflare tunnel or LAN Caddy)

| Port | Service | Exposed via |
|------|---------|-------------|
| 443 (HTTPS) | Cloudflare edge | Internet (all domains) |
| 80 | Caddy edge | LAN only |
| 3000 | Next.js console | Via Caddy / tunnel (mapped to domain) |
| 8800 | Gateway aggregator | Via tunnel directly |
| 7799 | Gungnir | Via Caddy + oauth2-proxy |
| 9100 | node-exporter | Via Caddy + oauth2-proxy |
| 3100 | Landing page | Via Caddy + oauth2-proxy |
| 7878 | Gateway nodes G1/G2/G3 | Via Caddy LB (path /v1/*) |

### Host-exposed (bound to 0.0.0.0 in compose, reachable on LAN if firewall allows)

These are all `ports:` bindings in `docker-compose.yml` — accessible from LAN without auth unless a firewall blocks them:

| Port | Service |
|------|---------|
| 5432 | Postgres |
| 8333/9333 | SeaweedFS |
| 6333 | Qdrant |
| 8200 | OpenBao |
| 8080 | Keycloak |
| 8181 | OPA |
| 5001/5002 | Presidio |
| 8428/9428 | VictoriaMetrics/Logs |
| 4317/4318 | OTel Collector |
| 16686 | Jaeger |
| 3030 | Langfuse |
| 9000/3001/5010 | Marquez |
| 7233/8081 | Temporal |
| 6379 | Redis |
| 9200/5601 | OpenSearch/Dashboards |
| 4242 | Unleash |
| 8001/8002 | Evidently/Ragas |
| 8088 | Superset |
| 8070 | FleetDM |

### Internal-only (Docker network, no host port binding)

| Service |
|---------|
| langfuse-db, langfuse-clickhouse, langfuse-minio, langfuse-redis |
| marquez-db, temporal-db, unleash-db |
| fleet-mysql, fleet-redis |

---

## 8. Cloudflare Tunnel

**Yes, there is a Cloudflare tunnel.** Config at `deploy/onprem/cloudflared-tunnel.yml`:

- Tunnel ID: `00000000-0000-0000-0000-000000000000`
- Credentials file: `/Users/admin/.cloudflared/<uuid>.json` (on the host running `cloudflared`)
- The `cloudflared` daemon runs on the host (not in compose), making an outbound connection to Cloudflare's edge

Ingress rules in the tunnel:
1. `onprem-console.getoffgridai.co` → `http://127.0.0.1:3000` (console direct)
2. `gateway.getoffgridai.co` → `http://127.0.0.1:8800` (gateway direct)
3. `console-status.getoffgridai.co` → `http://127.0.0.1:80` (Caddy — gated via oauth2-proxy)
4. `console-landing.getoffgridai.co` → `http://127.0.0.1:80` (Caddy — gated)
5. `gungnir.getoffgridai.co` → `http://127.0.0.1:80` (Caddy — gated)
6. `*` → `http_status:404`

**Important note:** Domains 1 and 2 (console and gateway) bypass Caddy entirely — they go straight to the local service. This means:
- The console has no auth middleware from the tunnel side (it relies on its own auth — Keycloak/NextAuth)
- The gateway has no auth middleware from the tunnel side (it relies on API-key auth built into the gateway binary)

**`CLOUDFLARE_API_TOKEN`** referenced in `.env.keygen` (mobile repo) is unrelated — that is for the mobile/keygen service's DNS/certificate management, not this tunnel.

---

## 9. What's Missing for `console-api.getoffgridai.co`

`console-api.getoffgridai.co` does not exist in any Caddyfile, tunnel ingress, or DNS config. To make it work as a unified API gateway for the console's REST API, the following gaps must be filled:

### Gap 1: Cloudflare tunnel ingress rule missing
Add to `deploy/onprem/cloudflared-tunnel.yml`:
```yaml
- hostname: console-api.getoffgridai.co
  service: http://127.0.0.1:3000   # same Next.js process, /api/* routes
```
Or if the intent is to separate the API from the UI:
```yaml
- hostname: console-api.getoffgridai.co
  service: http://127.0.0.1:8800   # route directly to the gateway
```

### Gap 2: Caddy routing rule missing (dev Caddyfile)
Add to `deploy/Caddyfile` if Caddy should sit in front:
```
http://console-api.getoffgridai.co {
    reverse_proxy 127.0.0.1:3000
}
```

### Gap 3: DNS record
A CNAME pointing `console-api.getoffgridai.co` to the Cloudflare tunnel hostname must be created in Cloudflare DNS. Cloudflare creates this automatically when you add an ingress rule to the tunnel via the dashboard, but not from a local `cloudflared-tunnel.yml` file alone.

### Gap 4: Ambiguity — what is "the console API"?
The current architecture has two things that could be called the API:
- **Next.js `/api/*` routes** — the console's own backend API (auth, gateway tokens, admin, etc.), served by the same Next.js process on `:3000`
- **Gateway `/v1/*`** — the OpenAI-compatible inference API on `:8800`

If `console-api` is meant to be a unified facade for both, a Caddy site-block with path routing (like the on-prem Caddyfile does) needs to be added:
```
http://console-api.getoffgridai.co {
    @gw path /v1/* /healthz
    handle @gw {
        reverse_proxy 127.0.0.1:8800
    }
    handle {
        reverse_proxy 127.0.0.1:3000
    }
}
```

### Gap 5: CORS
If `console-api.getoffgridai.co` is a different origin from `onprem-console.getoffgridai.co`, the Next.js API routes and gateway will need explicit CORS headers for cross-origin browser requests.

### Gap 6: Auth alignment
The console app authenticates via Keycloak/NextAuth (session cookies). An API-first subdomain would need either:
- Bearer token support in the console's API routes (currently exists via `OFFGRID_ADMIN_TOKEN` for admin endpoints)
- Or the gateway tokens issued by `/api/v1/gateway/tokens` to be accepted on `/v1/*`

Currently, `gateway.getoffgridai.co` is ungated at the Caddy/tunnel level and relies on API-key auth inside the gateway binary. Unifying under a single `console-api` subdomain would need this auth to be consistent.

---

## Summary

The network has three distinct layers:

1. **Internet edge:** Cloudflare tunnel (TLS termination at Cloudflare, outbound connection from host, no inbound firewall ports needed)
2. **Application edge (dev):** Caddy `deploy/Caddyfile` on S1, providing auth (oauth2-proxy/Keycloak) for status/landing/gungnir, plain reverse proxy for console and gateway
3. **On-prem LAN edge:** Caddy `deploy/onprem/Caddyfile` on S1 (192.168.1.84), load-balancing across two console instances and three gateway nodes, no auth (LAN-trusted)

The gateway (`:8800`/`:7878`) is **behind Caddy** on the LAN path (routed via path `/v1/*`) but **bypasses Caddy** on the internet path (direct tunnel ingress rule). Rate limiting is entirely absent from Caddy — it must live inside the gateway binary itself.

The `console-api.getoffgridai.co` domain requires: a tunnel ingress rule, a Caddy site block (or direct tunnel bypass), a Cloudflare DNS record, and an auth/CORS strategy decision.
