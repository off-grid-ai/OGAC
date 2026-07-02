# Off Grid Console — Unified API Catalog Research

_Research date: 2026-07-02. Source of truth: `deploy/docker-compose.yml`, `deploy/docker-compose.edge.yml`, `deploy/onprem/Caddyfile`, `docs/OSS_SERVICES_MATRIX.md`, and `src/app/api/` route tree._

---

## 1. Service inventory — ports, routes, specs, auth

| Service | Internal port | Public Caddy route (onprem) | OpenAPI / Swagger spec URL | Auth method |
|---|---|---|---|---|
| **Keycloak** | 8080 | Not directly exposed (console proxies OIDC) | `http://keycloak:8080/realms/offgrid/.well-known/openid-configuration` (OIDC discovery); Admin REST: `http://keycloak:8080/` → no native Swagger, but third-party spec at https://www.keycloak.org/docs-api/26.0/rest-api — no embedded `/swagger-ui` | Admin credentials (KC_BOOTSTRAP_ADMIN); bearer token for user-facing OIDC |
| **OPA** | 8181 | Not exposed | `http://opa:8181/` — OPA does **not** ship a Swagger UI; REST shape documented at https://www.openpolicyagent.org/docs/latest/rest-api/ (no `/openapi.json` endpoint) | None in dev (can add `--authentication=token` flag) |
| **OpenBao** | 8200 | Not exposed | `http://openbao:8200/v1/sys/internal/specs/openapi` — OpenBao inherits Vault's OpenAPI endpoint; full spec at that path (`GET /v1/sys/internal/specs/openapi`) | Root token (`BAO_DEV_ROOT_TOKEN_ID`; header `X-Vault-Token`) |
| **Qdrant** | 6333 | Not exposed | `http://qdrant:6333/openapi/openapi-3.1.0.json` (JSON), viewable at `http://qdrant:6333/dashboard/#/swagger` | None by default; optional API key via `--api-key` flag |
| **OpenSearch** | 9200 | Not exposed | No native Swagger UI; OpenSearch ships an `/_plugins/_security/api` path in the security plugin (disabled here with `DISABLE_SECURITY_PLUGIN=true`). REST reference: https://opensearch.org/docs/latest/api-reference/ | None in dev (`DISABLE_SECURITY_PLUGIN=true`) |
| **Marquez** | 9000 (host) → 5000 (container) | Not exposed | `http://marquez:5000/api/v1/openapi` — Marquez serves its OpenAPI JSON at that path; Swagger UI at `http://marquez:5000/` (the default index redirects to the UI) | None (no auth in default deploy) |
| **Temporal** | 7233 (gRPC) | Not exposed | No HTTP/OpenAPI; Temporal uses gRPC + protobuf. UI at port 8081 is a web app, not an API surface. SDK-level reference at https://docs.temporal.io — no `/openapi.json` | mTLS or API keys (disabled in auto-setup dev image) |
| **Langfuse** | 3030 (host) → 3000 (container) | Not exposed | `http://langfuse:3000/api/public/openapi.json` — Langfuse ships an OpenAPI 3.1 spec; Swagger UI at `http://langfuse:3000/api/public/swagger` | Bearer token (public/secret key pair; `Authorization: Bearer <public-key>:<secret-key>`) |
| **Superset** | 8088 | Not exposed | `http://superset:8088/swagger/v1` — Superset ships Swagger UI natively (enabled by default in v4.x); JSON spec at `/api/v1/openapi.json` | JWT session token (via `/api/v1/security/login`); guest token for embeds |
| **FleetDM** | 8070 | Not exposed | `http://fleet:8070/api/v1/kolide/swagger` (legacy path) or spec at `http://fleet:8070/api/openapi.json` — Fleet ships a Swagger spec at that path, viewable via Swagger UI | Bearer token (`Authorization: Bearer <fleet-api-token>`); token created via `fleetctl get api-token` |
| **Presidio Analyzer** | 5002 (host) → 3000 (container) | Not exposed | `http://presidio-analyzer:3000/` — Presidio ships FastAPI which auto-generates Swagger UI at `/docs` and OpenAPI JSON at `/openapi.json` | None |
| **Presidio Anonymizer** | 5001 (host) → 3000 (container) | Not exposed | `http://presidio-anonymizer:3000/docs` — same FastAPI `/docs` and `/openapi.json` | None |
| **Unleash** | 4242 | Not exposed | `http://unleash:4242/api/swagger.json` — Unleash ships an OpenAPI spec; Swagger UI at `http://unleash:4242/api/docs` (enabled in server 6.x) | Bearer `Authorization: *:<admin-token>` for admin API; `Authorization: <client-token>` for SDK API |
| **Redis** | 6379 | Not exposed | No HTTP API, no OpenAPI spec. Accessed via redis-cli protocol only | Password (not set in dev) |
| **Caddy admin API** | 2019 (admin, disabled in onprem) | Disabled in onprem (`admin off` in Caddyfile) | When enabled: `http://localhost:2019/config/` (REST); no Swagger — JSON config API documented at https://caddyserver.com/docs/api | None by default when localhost-only; can add token |
| **VictoriaMetrics** (opt-in) | 8428 | Not exposed | `http://victoriametrics:8428/` — VictoriaMetrics exposes a Prometheus-compatible API; no OpenAPI spec. Query via `/api/v1/query` (PromQL) | None |
| **Jaeger** (opt-in) | 16686 | Not exposed | Jaeger UI at 16686; no formal OpenAPI spec shipped in-image; API reference at https://www.jaegertracing.io/docs/ | None |
| **Marquez Web** | 3001 (host) → 3000 (container) | Not exposed | Frontend UI only — no API surface | Session cookie |
| **Temporal UI** | 8081 | Not exposed | Frontend UI only — no API surface | None |
| **OpenSearch Dashboards** | 5601 | Not exposed | Frontend UI only — no API surface | None |
| **Off Grid Gateway** | 7878 (host, first-party) | `onprem-console.getoffgridai.co /v1/*` and `/healthz` → round-robin pool (192.168.1.82/83/86:7878) | `/openapi.json` TBD — first-party service; no confirmed spec yet | Bearer token (gateway client tokens, managed via console) |

---

## 2. Services with confirmed native OpenAPI specs

These services expose a machine-readable OpenAPI (or Swagger) spec and can be aggregated:

| Service | Spec URL (internal) | Spec format | Swagger UI URL |
|---|---|---|---|
| OpenBao | `http://openbao:8200/v1/sys/internal/specs/openapi` | OpenAPI 3.0 JSON | None built-in; render with external UI |
| Qdrant | `http://qdrant:6333/openapi/openapi-3.1.0.json` | OpenAPI 3.1 JSON | `http://qdrant:6333/dashboard/#/swagger` |
| Marquez | `http://marquez:5000/api/v1/openapi` | OpenAPI JSON | `http://marquez:5000/` (redirects to Swagger UI) |
| Langfuse | `http://langfuse:3000/api/public/openapi.json` | OpenAPI 3.1 JSON | `http://langfuse:3000/api/public/swagger` |
| Superset | `http://superset:8088/api/v1/openapi.json` | OpenAPI 3.0 JSON | `http://superset:8088/swagger/v1` |
| FleetDM | `http://fleet:8070/api/openapi.json` | OpenAPI 3.0 JSON | `http://fleet:8070/api/v1/kolide/swagger` |
| Presidio Analyzer | `http://presidio-analyzer:3000/openapi.json` | OpenAPI 3.0 JSON | `http://presidio-analyzer:3000/docs` |
| Presidio Anonymizer | `http://presidio-anonymizer:3000/openapi.json` | OpenAPI 3.0 JSON | `http://presidio-anonymizer:3000/docs` |
| Unleash | `http://unleash:4242/api/swagger.json` | Swagger 2.0 / OpenAPI JSON | `http://unleash:4242/api/docs` |

Services **without** a native OpenAPI spec: Keycloak (external spec only), OPA, Temporal (gRPC), Redis, VictoriaMetrics, OpenSearch, Caddy admin, Jaeger.

---

## 3. Next.js API routes — `src/app/api/`

### Auth
| Route | Description |
|---|---|
| `GET/POST /api/auth/[...nextauth]` | NextAuth.js handler — OIDC sign-in/sign-out/callback via Keycloak |

### Chat
| Route | Description |
|---|---|
| `GET/POST /api/v1/chat/stream` | Streaming LLM completions through the gateway |
| `GET/POST /api/v1/chat/run` | Non-streaming agent/tool run |
| `GET/POST/DELETE /api/v1/chat/conversations` | List/create conversations |
| `GET/PATCH/DELETE /api/v1/chat/conversations/[id]` | Get/update/delete a single conversation |
| `GET/POST /api/v1/chat/projects` | List/create projects |
| `GET/PATCH/DELETE /api/v1/chat/projects/[id]` | Get/update/delete a project |
| `GET/POST /api/v1/chat/projects/[id]/documents` | Documents attached to a project |
| `GET/POST /api/v1/chat/projects/[id]/memory` | Per-project memory blocks |
| `POST /api/v1/chat/projects/[id]/share` | Share a project |
| `GET /api/v1/chat/projects/shared` | List shared projects |
| `GET/POST /api/v1/chat/artifacts` | List/create generated artifacts |
| `GET/PATCH/DELETE /api/v1/chat/artifacts/[id]` | Get/update/delete an artifact |
| `POST /api/v1/chat/artifacts/complete` | Mark artifact generation complete |
| `POST /api/v1/chat/attach` | Attach a file/URL to a conversation |
| `GET/POST /api/v1/chat/memory` | Global memory blocks for the current user |
| `GET /api/v1/chat/models` | List available models from gateway |
| `GET/PATCH /api/v1/chat/prefs` | User chat preferences |
| `GET/PATCH /api/v1/chat/settings` | Chat-level settings |
| `GET/POST /api/v1/chat/skills` | List/create skills |
| `GET/PATCH/DELETE /api/v1/chat/skills/[id]` | Get/update/delete a skill |
| `GET/POST /api/v1/chat/skills/[id]/actions` | Actions for a skill |
| `POST /api/v1/chat/speech` | Text-to-speech synthesis |
| `POST /api/v1/chat/transcribe` | Speech-to-text transcription |
| `GET /api/v1/chat/data` | Retrieve structured data from conversation |
| `GET /api/v1/chat/documents/[docId]` | Get a single chat document |

### Knowledge
| Route | Description |
|---|---|
| `GET/POST /api/v1/knowledge/collections` | List/create knowledge collections |
| `GET/POST /api/v1/knowledge/collections/[id]/documents` | Documents within a collection |
| `GET/PATCH/DELETE /api/v1/knowledge/documents/[docId]` | Get/update/delete a knowledge document |

### Devices
| Route | Description |
|---|---|
| `GET/POST /api/v1/devices` | List all devices / register a new device |
| `POST /api/v1/devices/enroll` | Enroll a device with an enrollment token |
| `GET /api/v1/devices/[id]/audit` | Audit log for a specific device |
| `POST /api/v1/devices/[id]/commands` | Send a remote command to a device |
| `GET/POST /api/v1/devices/[id]/policy` | Get/set policy for a device |

### Gateway
| Route | Description |
|---|---|
| `GET/POST /api/v1/gateway/config` | Read/write gateway config (merged from DB + live gateway) |
| `GET/POST /api/v1/gateway/tokens` | List/create gateway client tokens |
| `GET /api/v1/gateway/traffic` | Live traffic metrics from the gateway |
| `GET /api/v1/gateway/analytics` | Aggregated gateway usage analytics |
| `GET /api/v1/gateway/finops` | Per-user/project cost data from the gateway |
| `GET /api/v1/gateway/logs` | Raw gateway request logs |
| `GET /api/v1/gateway/nodes` | List gateway inference pool nodes |
| `GET/DELETE /api/v1/gateway/nodes/[name]` | Get or remove a specific gateway node |

### FinOps / Budgets
| Route | Description |
|---|---|
| `GET/POST /api/v1/finops/budgets` | List/create token budgets |
| `GET/PATCH/DELETE /api/v1/finops/budgets/[id]` | Get/update/delete a budget |

### Prompts
| Route | Description |
|---|---|
| `GET/POST /api/v1/prompts` | List/create prompt templates |
| `GET/PATCH/DELETE /api/v1/prompts/[id]` | Get/update/delete a prompt |
| `GET /api/v1/prompts/common` | Shared/common prompt library |

### Audit
| Route | Description |
|---|---|
| `GET /api/v1/audit` | Paginated audit log query |

### Vector DB
| Route | Description |
|---|---|
| `GET /api/v1/vectordb` | Inspect vector DB (collections, stats, scatter-plot data) |

### Admin routes (require `requireAdmin`)
| Route | Description |
|---|---|
| `GET/POST /api/v1/admin/agents` | List/create agent definitions |
| `GET/PATCH/DELETE /api/v1/admin/agents/[id]` | Get/update/delete an agent |
| `GET /api/v1/admin/agents/runs` | Agent run history |
| `GET/POST /api/v1/admin/run` | Trigger an admin-level agent run |
| `GET/POST /api/v1/admin/keys` | API key management |
| `GET/PATCH/DELETE /api/v1/admin/keys/[id]` | Get/update/delete an API key |
| `GET/POST /api/v1/admin/tools` | Tool definitions (MCP/function tools) |
| `GET/PATCH/DELETE /api/v1/admin/tools/[id]` | Get/update/delete a tool |
| `GET/POST /api/v1/admin/connectors` | Data source connectors |
| `GET/PATCH/DELETE /api/v1/admin/connectors/[id]` | Get/update/delete a connector |
| `POST /api/v1/admin/connectors/[id]/sync` | Trigger a connector sync |
| `GET/POST /api/v1/admin/roles` | RBAC role definitions |
| `GET/PATCH/DELETE /api/v1/admin/roles/[id]` | Get/update/delete a role |
| `GET/POST /api/v1/admin/users` | User management |
| `GET/PATCH/DELETE /api/v1/admin/users/[id]` | Get/update/delete a user |
| `GET/POST /api/v1/admin/tenants` | Tenant (org) management |
| `GET/PATCH/DELETE /api/v1/admin/tenants/[id]` | Get/update/delete a tenant |
| `GET/POST /api/v1/admin/governance` | Governance policies |
| `GET/PATCH/DELETE /api/v1/admin/governance/[id]` | Get/update/delete a policy |
| `GET/POST /api/v1/admin/policy` | OPA policy management |
| `GET /api/v1/admin/policy/history` | Policy change history |
| `GET/POST /api/v1/admin/abac-rules` | ABAC rule definitions |
| `GET/PATCH/DELETE /api/v1/admin/abac-rules/[id]` | Get/update/delete an ABAC rule |
| `POST /api/v1/admin/abac/evaluate` | Evaluate an ABAC decision |
| `GET/POST /api/v1/admin/masking-rules` | PII masking rule definitions |
| `GET/PATCH/DELETE /api/v1/admin/masking-rules/[id]` | Get/update/delete a masking rule |
| `POST /api/v1/admin/pii/scan` | On-demand PII scan of text |
| `GET/POST /api/v1/admin/secrets` | OpenBao KV secret read/write/list |
| `GET/POST /api/v1/admin/flags` | Feature flag read via Unleash |
| `GET /api/v1/admin/adapters` | List active adapter selections |
| `GET/POST /api/v1/admin/routing` | Model routing rules |
| `GET/PATCH/DELETE /api/v1/admin/routing/[id]` | Get/update/delete a routing rule |
| `POST /api/v1/admin/routing/evaluate` | Evaluate a routing rule |
| `GET /api/v1/admin/analytics` | Aggregated observability analytics |
| `GET/POST /api/v1/admin/audit-search` | Full-text audit search via OpenSearch |
| `GET/POST /api/v1/admin/traces` | Langfuse trace list |
| `GET /api/v1/admin/traces/[id]` | Single trace + span waterfall |
| `GET /api/v1/admin/lineage-graph` | Marquez job→dataset lineage graph |
| `GET/POST /api/v1/admin/brain/documents` | Brain document index |
| `POST /api/v1/admin/brain/ingest` | Ingest documents into Brain |
| `POST /api/v1/admin/brain/search` | Semantic search in Brain |
| `POST /api/v1/admin/reindex` | Re-index Brain into Qdrant |
| `GET/POST /api/v1/admin/datasets` | Evaluation dataset management |
| `GET/POST /api/v1/admin/evals` | Evaluation runs |
| `POST /api/v1/admin/evals/run` | Trigger an evaluation pass |
| `GET/POST /api/v1/admin/golden-cases` | Golden test-case library |
| `GET/PATCH/DELETE /api/v1/admin/golden-cases/[id]` | Get/update/delete a golden case |
| `GET /api/v1/admin/qa/status` | QA / drift / eval status |
| `GET /api/v1/admin/qa/score` | Current QA scores |
| `POST /api/v1/admin/qa/sweep` | Trigger a QA sweep |
| `POST /api/v1/admin/qa/drift` | Run drift detection |
| `GET /api/v1/admin/finops` | FinOps cost summary |
| `GET/POST /api/v1/admin/reports` | Compliance/regulatory reports |
| `GET /api/v1/admin/reports/[id]/export` | Export a report (PDF/CSV) |
| `GET/POST /api/v1/admin/compliance` | Compliance status |
| `POST /api/v1/admin/compliance/export` | Export compliance data |
| `POST /api/v1/admin/erasure` | GDPR/data erasure requests |
| `GET/POST /api/v1/admin/prompts` | Admin prompt library |
| `GET /api/v1/admin/prompts/[id]/versions` | Prompt version history |
| `GET/POST /api/v1/admin/sources` | Knowledge source management |
| `GET /api/v1/admin/ingest-jobs` | Ingest job queue status |
| `GET/POST /api/v1/admin/sandbox/run` | Sandboxed code execution |
| `GET/POST /api/v1/admin/grounding/verify` | Claim grounding verification |
| `GET/POST /api/v1/admin/provenance/c2pa` | C2PA provenance assertion |
| `GET/POST /api/v1/admin/provenance/sigstore` | Sigstore signing |
| `POST /api/v1/admin/provenance/verify` | Verify provenance of an artifact |
| `POST /api/v1/admin/sign` | Sign an artifact |
| `GET/POST /api/v1/admin/embeds` | Superset embed guest-token minting |
| `GET /api/v1/admin/superset-token` | Get a Superset guest token |
| `GET /api/v1/admin/mdm/devices` | FleetDM device list (read-only) |
| `GET /api/v1/admin/devices/[id]/kill` | Send kill-switch command to device |
| `GET /api/v1/admin/enroll-token` | Generate a device enrollment token |
| `GET/POST /api/v1/admin/org-settings` | Organisation-level settings |
| `GET/POST /api/v1/admin/cache` | Cache inspection and flush |
| `GET /api/v1/admin/compose` | Docker Compose stack status |
| `GET/POST /api/v1/admin/agent-runtime` | Agent runtime adapter selection |
| `GET/POST /api/v1/admin/access/clients` | Keycloak OIDC client management |
| `GET/PATCH/DELETE /api/v1/admin/access/clients/[id]` | Get/update/delete a Keycloak client |
| `POST /api/v1/admin/access/clients/[id]/secret` | Rotate a Keycloak client secret |
| `GET/POST /api/v1/admin/access/roles` | Keycloak realm role management |
| `GET/PATCH/DELETE /api/v1/admin/access/roles/[name]` | Get/update/delete a realm role |
| `GET/POST /api/v1/admin/access/users` | Keycloak user management |
| `GET/PATCH/DELETE /api/v1/admin/access/users/[id]` | Get/update/delete a Keycloak user |
| `POST /api/v1/admin/access/users/[id]/roles` | Assign roles to a Keycloak user |
| `POST /api/v1/admin/access/users/[id]/password` | Reset a Keycloak user password |
| `GET/POST /api/v1/admin/scim/v2/Users` | SCIM 2.0 user provisioning |
| `GET/POST /api/v1/admin/scim/v2/Groups` | SCIM 2.0 group provisioning |
| `GET /api/v1/admin/scim/v2/ServiceProviderConfig` | SCIM service-provider metadata |

---

## 4. Unified API catalog — design

### What it is

A single Swagger UI deployment that aggregates specs from every HTTP service in the stack. A visitor goes to `https://console-api.getoffgridai.co` (or `/api-catalog` on the existing console hostname) and sees one page with a service picker — each service is a separate spec loaded on demand.

### Index document (`/openapi-catalog.json` or a simple JSON index)

```json
{
  "catalog": [
    {
      "name": "Off Grid Console API",
      "description": "First-party Next.js API — chat, admin, gateway, FinOps, knowledge",
      "url": "/api/openapi.json"
    },
    {
      "name": "Qdrant (vector store)",
      "description": "Collection management, upsert, search",
      "url": "http://qdrant:6333/openapi/openapi-3.1.0.json"
    },
    {
      "name": "OpenBao (secrets vault)",
      "description": "KV v2 read/write/list, dynamic secrets",
      "url": "http://openbao:8200/v1/sys/internal/specs/openapi"
    },
    {
      "name": "Marquez (data lineage)",
      "description": "OpenLineage ingest, job/dataset graph query",
      "url": "http://marquez:5000/api/v1/openapi"
    },
    {
      "name": "Langfuse (LLM tracing)",
      "description": "Traces, observations, scores, cost",
      "url": "http://langfuse:3000/api/public/openapi.json"
    },
    {
      "name": "Superset (BI)",
      "description": "Charts, datasets, dashboards, guest tokens",
      "url": "http://superset:8088/api/v1/openapi.json"
    },
    {
      "name": "FleetDM (MDM)",
      "description": "Hosts, policies, live queries, software inventory",
      "url": "http://fleet:8070/api/openapi.json"
    },
    {
      "name": "Presidio Analyzer (PII detection)",
      "description": "Analyze text for PII entities",
      "url": "http://presidio-analyzer:3000/openapi.json"
    },
    {
      "name": "Presidio Anonymizer (PII redaction)",
      "description": "Anonymize/redact PII in text",
      "url": "http://presidio-anonymizer:3000/openapi.json"
    },
    {
      "name": "Unleash (feature flags)",
      "description": "Flag evaluation, strategies, variants, metrics",
      "url": "http://unleash:4242/api/swagger.json"
    }
  ]
}
```

Services without a native spec (Keycloak, OPA, OpenSearch, Temporal, Redis) are either:
- Linked to their upstream documentation URL in the index (informational entry, no Swagger UI rendering), or
- Covered by a hand-authored spec checked into the repo at `docs/openapi/<service>.yaml`.

### Console API spec generation

The console itself has ~140 API routes but no generated spec. Two implementation paths:

1. **`next-swagger-doc` + `swagger-ui-react`**: annotate each `route.ts` with JSDoc `@swagger` blocks; serve the aggregated JSON at `/api/openapi.json`. Lightweight, stays in the Next.js process.
2. **`zod-openapi` (preferred)**: wrap the existing Zod request/response schemas (if present) in `openapi()` calls; auto-generate the spec at build time. No JSDoc required.

### Caddy routing for `console-api.getoffgridai.co`

```caddyfile
http://console-api.getoffgridai.co {
  # The catalog index and Swagger UI shell (served by Next.js or a tiny static container)
  handle /catalog* {
    reverse_proxy 192.168.1.84:3000 192.168.1.85:3000 {
      lb_policy round_robin
    }
  }

  # Proxy individual service specs through the catalog host so browser CORS works
  # (all spec URLs become same-origin from Swagger UI's perspective)
  handle /specs/qdrant* {
    uri strip_prefix /specs/qdrant
    reverse_proxy qdrant:6333
  }
  handle /specs/openbao* {
    uri strip_prefix /specs/openbao
    reverse_proxy openbao:8200
  }
  handle /specs/marquez* {
    uri strip_prefix /specs/marquez
    reverse_proxy marquez:5000
  }
  handle /specs/langfuse* {
    uri strip_prefix /specs/langfuse
    reverse_proxy langfuse:3000
  }
  handle /specs/superset* {
    uri strip_prefix /specs/superset
    reverse_proxy superset:8088
  }
  handle /specs/fleet* {
    uri strip_prefix /specs/fleet
    reverse_proxy fleet:8070
  }
  handle /specs/presidio-analyzer* {
    uri strip_prefix /specs/presidio-analyzer
    reverse_proxy presidio-analyzer:3000
  }
  handle /specs/presidio-anonymizer* {
    uri strip_prefix /specs/presidio-anonymizer
    reverse_proxy presidio-anonymizer:3000
  }
  handle /specs/unleash* {
    uri strip_prefix /specs/unleash
    reverse_proxy unleash:4242
  }
  # Catch-all: console API
  handle {
    reverse_proxy 192.168.1.84:3000 192.168.1.85:3000 {
      lb_policy round_robin
    }
  }
}
```

### What the Swagger UI page contains

The catalog entry point at `console-api.getoffgridai.co/catalog` renders a single Swagger UI instance with a dropdown or tab bar at the top: one entry per service. Selecting a service loads its spec from the corresponding `/specs/<service>` proxy path. The page also includes:

- Auth helper panel: shows which token/credential is needed per service (gateway bearer token, OpenBao X-Vault-Token, etc.) and links to the console's key-management UI to mint the relevant token.
- Read-only toggle: for production deployments, write operations (DELETE, POST with side effects) can be visually flagged or hidden.
- Health badges: a small status indicator next to each service name, polling the same healthcheck endpoints Caddy uses.

### What is not yet feasible

- **Keycloak**: no embedded spec; link to the official REST API reference at `keycloak.org/docs-api/26.0/rest-api` instead.
- **OPA**: REST is simple and undocumented as OpenAPI; point to the OPA REST API docs page.
- **Temporal**: gRPC-only; link to the Temporal proto/SDK reference.
- **OpenSearch**: link to the OpenSearch REST API reference; the security plugin (disabled) does provide a Swagger at `/_plugins/_security/api` when enabled.
- **Redis**: no HTTP API.

---

## 5. Summary of gaps

1. **Console API has no generated OpenAPI spec** — the highest-value gap given the breadth of routes.
2. **No Caddy virtual host for `console-api.getoffgridai.co`** exists yet — the onprem Caddyfile only has `onprem-console.getoffgridai.co` and `local.getoffgridai.co`.
3. **Keycloak, OPA, OpenSearch, Temporal** have no machine-readable spec in the container — these would need hand-authored YAML stubs or external doc links.
4. **CORS**: every service's spec endpoint will CORS-block Swagger UI unless proxied through Caddy (the routing above solves this).
5. **Auth flow in the UI**: users need to obtain a Keycloak token for the console API, plus separate credentials for each service — the catalog UI needs a "get token" affordance per service row.
