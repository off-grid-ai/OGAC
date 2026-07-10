# Off Grid Console - Integrations & Operations Guide

Everything the console integrates with, how each piece works, and how to operate it. Read
`INTEGRATIONS.md` first for the architecture (ports + adapters); this doc is the **operator
runbook** - what runs, how to bring it up, how to verify it, how to swap it, and how to run it
in production.

---

## 1. The shape, in one paragraph

The console talks to every external system through a **capability port** (`src/lib/adapters/`).
Each port has one or more **adapters** (the concrete OSS tool). The **active** adapter per
capability is chosen by `OFFGRID_ADAPTER_<CAPABILITY>` - swapping a tool is one env var, never a
code change. The **Docker Compose** in `deploy/` brings up the real OSS, grouped into **profiles
that map 1:1 to capabilities**, so you run only what you've licensed. Two things come from the
Off Grid ecosystem - the **UI** and the **Off Grid AI Gateway**; everything else is the console's
own third-party OSS behind ports.

---

## 2. What's actually REQUIRED vs optional

Most "integrations" are optional and enabled per capability/plane. The hard requirements are tiny:

| Tier               | Component                                                                               | Why                                                        | Notes                                            |
| ------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| **Required**       | **Off Grid AI Gateway** (`:7878`)                                                       | All inference: embeddings, grounding-NLI, chat, multimodal | First-party; runs **separately**, not in compose |
| **Required**       | **PostgreSQL 16**                                                                       | Console state + append-only audit                          | `deploy` profile `data`, or your own PG          |
| Recommended        | OpenBao                                                                                 | Real secrets (else env vars)                               | profile `secrets`                                |
| Recommended        | OTel Collector + VictoriaMetrics/Logs                                                   | Traces/metrics/logs                                        | profile `observability`                          |
| Optional per plane | guardrails / policy / lineage / data-ingestion / agent-runtime / runtime-security tools | Only if that plane is licensed                             | see §3                                           |

> **So: the four containers you saw (OpenBao, OTel Collector, VictoriaLogs, VictoriaMetrics) are
> just the `secrets` + `observability` profiles.** They are not the whole set, and they are not
> all required - they're the two profiles brought up to test those capabilities.

---

## 2b. First-party core - always on, no OSS required

The console is the control plane for **all five layers of the agentic stack** - data, control,
AI, regulatory, and the consumption layer (Fleet Control). The **core primitives of each plane
are first-party and always on**; the OSS in §3 _augments_ them, it never _replaces_ them. Pull
every OSS container and the console still audits, logs traffic, and enforces guardrails.

| Plane                               | Module(s)                      | First-party core (always on)                                                                                 |
| ----------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Data**                            | `data`                         | connectors, ingest jobs, masking rules, datasets, DSAR erasure                                               |
| **Control**                         | `control`, `admin`             | **audit log**, **guardrail policy engine**, RBAC + ABAC, kill switch                                         |
| **AI**                              | `gateway`, `brain`, `agents`   | gateway routing, retrieval, grounding, golden-set evals, **pre-built AI agent use cases**                    |
| **Regulatory**                      | `regulatory`, `reports`        | compliance posture, framework coverage, DPIA/report exports                                                  |
| **Consumption** (Fleet + use cases) | `fleet`, `analytics`, `agents` | device enrollment, inventory & policies (MDM control commands coming soon), traffic analytics, **the pre-built AI agent use cases frontline users consume** |

`agents` deliberately spans two layers: it's an **AI-plane capability** (a runtime over the
gateway + Brain) and the **consumption-layer application** - the pre-built use cases (sales
productivity, claims/FNOL, onboarding/KYC, SOP synthesis from observed work) that frontline users
actually consume, sitting on top of the four planes. That's the "democratized intelligence at the
frontline" surface; Fleet Control is the other half of consumption (the operator's view of nodes).

**The three control-plane primitives, and how OSS augments (never owns) them:**

- **Audit logging** - `audit_events` (append-only, Postgres) via `appendAudit`; read at
  `/api/v1/audit`, surfaced in the Control plane. **This is the source of truth.** The
  observability OSS (OTel → VictoriaMetrics/SigNoz) is an _optional export wire_ off this log,
  not the log itself.
- **Traffic logging** - every gateway request lands an audit event: `model`, `tokens`,
  `latencyMs`, `leftDevice`, `outcome`, **plus the `checks[]` findings**. That _is_ the per-request
  traffic log; OTel mirrors it for dashboards.
- **Guardrail policies** - the `PolicyBundle` (egress allowed, guardrails list, allowed models)
  together with the findings spine (`src/lib/checks.ts`: PII / injection), normalized onto the
  audit record at the gateway hooks. External guardrail engines (Presidio / NeMo / Rebuff) are
  _optional adapters_ behind the same checks port.

So the OSS swaps in §3 are about **scale and depth** (a cluster-grade metrics store, a KMS, a
dedicated PII engine) - the _function_ exists first-party from day one.

## 3. Capabilities → integrations (the full map)

Status legend: **🟢 wired & tested** (adapter implemented, verified against the live tool) ·
**🟡 native** (served first-party today) · **⚪ mapped** (in the integration map + license audit;
adapter/containerization is future work, listed so the surface is honest).

### 3.1 Inference - `inference` 🟢 (REQUIRED)

- **Tool:** Off Grid AI Gateway (first-party, OpenAI-compatible, MCP-native, multimodal).
- **Port:** `InferencePort` (`embed`, `health`). **Adapters:** `gateway` (default), `local`
  (deterministic offline fallback - no network).
- **Operate:** runs separately on `127.0.0.1:7878`. Set `OFFGRID_GATEWAY_URL`. Never a third-party
  LLM - the gateway is the single egress for all model calls.
- **Verify:** `curl $OFFGRID_GATEWAY_URL/v1/models` → 200. In-console: `GET /api/v1/admin/adapters?health=1`.

### 3.2 Retrieval / Knowledge (Brain) - `retrieval` 🟢

- **Tool:** LanceDB (embedded vector store). Embeddings via the gateway (`/v1/embeddings`, 384-dim).
- **Port:** native (`src/lib/brain.ts` → `getInference().embed`). **Swap:** the vector store is a
  bridge; pgvector is the natural server-side alternative (you already run Postgres).
- **Operate:** on-disk at `LANCEDB_PATH` (default `./.lancedb`). No container needed.
- **Verify:** `POST /api/v1/admin/evals/run` → recall score (exercises embed + search end-to-end).
- **Ingestion:** the Brain is also the ingestion layer (source → extract → chunk → embed → store,
  with provenance). `POST /api/v1/admin/brain/ingest` accepts `kind` ∈ `text | file | image |
database`: text/file index directly, **images are captioned via the gateway (multimodal)** then
  indexed, a database row becomes a textual record. The vector-DB UI (Brain → **Ingest** menu)
  feeds it files/images/datasets. Each doc keeps its source as provenance (`File · ...`, `Image · ...`,
  `Database · ...`).
- **Verify ingest:** `POST .../brain/ingest {kind:"text",title,text}` → 201, doc count +1, and the
  new doc routes back via `/admin/retrieve`.

### 3.2b Retrieval router (the spine) - `src/lib/retrieval/` 🟢

- **What:** detects a query's intent and routes it to the right destination - the Brain (KB), a
  structured **database**, or a configured **tool/service** - then fuses results (RRF) with
  provenance on every hit. The Brain is one leaf behind it.
- **Operate:** `POST /api/v1/admin/retrieve {query}` → `{ decision, hits[] }`;
  `GET /api/v1/admin/sources` lists destinations. Routing is heuristic (offline, deterministic);
  a gateway classifier can refine it. Sources are pluggable (`RetrievalSource`).
- **Tool source = the tool registry.** `GET|POST /api/v1/admin/tools` (+ `PATCH|DELETE .../{id}`)
  registers HTTP/MCP tools with a "when to use" description; the router matches query intent
  against it. Managed in **Brain → Tools & services**. Routing to a tool yields a `tool:<id>` ref.
- **Verify:** `retrieve "how do I handle a death claim?"` → kb · `"how many rows..."` → database ·
  `"sync the crm"` → tool.

### 3.3 Grounding / attribution - `grounding` 🟢

- **Tools:** `gateway-nli` (entailment via the gateway model, default) · `lexical` (offline
  token-overlap baseline). **Standalone** - no Brain dependency.
- **Operate:** `OFFGRID_GROUNDING_MODEL` selects the gateway model. `OFFGRID_ADAPTER_GROUNDING=lexical`
  forces the offline baseline.
- **Verify:** `POST /api/v1/admin/grounding/verify {answer, sources[]}` → per-claim verdicts + score.

### 3.4 Guardrails - `guardrails` 🟢 (Presidio swap in-path)

- **Today:** the first-party checks spine (`src/lib/checks.ts`): PII + injection hooks, results
  normalized onto the audit record. PII detection runs through the **`PiiPort`**.
- **In-path swap:** `OFFGRID_ADAPTER_GUARDRAILS=presidio` routes the PII scan through Microsoft
  Presidio (`/analyze`); the check reports `PII (presidio): ...`. Falls back to the regex if Presidio
  is unreachable. (NeMo Guardrails / Rebuff remain mapped for injection.) Out-of-process (HTTP).
- **Verify:** `make verify` (Presidio entity assertion) or any audited request stamps `checks[]`.

### 3.5 Observability - `observability` 🟢

- **Tools:** OpenTelemetry Collector (OTLP in) → VictoriaMetrics (metrics) + VictoriaLogs (logs) +
  Jaeger (traces). SigNoz is the rich-UI embed alternative; Langfuse v3 ingests the same spans as
  LLM traces.
- **Port:** `ObservabilityPort` (`emitSpan`). When `OFFGRID_OTLP_URL` is set, `emitSpan` exports
  real OTLP/HTTP JSON; otherwise it's a no-op (`OTEL_DEBUG=true` echoes locally). Set
  `OFFGRID_LANGFUSE_OTLP_URL` + `OFFGRID_LANGFUSE_AUTH` to **also** fan each span to Langfuse v3
  (verified: span → `/api/public/otel/v1/traces` → queryable trace).
- **Operate:** `make observability` (profile). Collector config: `deploy/otel-collector.yaml`.
- **Verify:** `docker compose logs otel-collector | grep offgrid-console` after any audited action.

### 3.6 Secrets / Identity - `secrets` 🟢 + identity 🟢

- **Tools:** OpenBao (KV v2 secrets, default `secret/data/<key>` → `.value`); `env` adapter
  (process env) as the offline default. Identity/SSO: Auth.js with Google, Microsoft Entra, **and
  Keycloak** (all self-activating on env presence) + dev-login.
- **Port:** `SecretsPort` (`get`, `has`). Falls back to env when OpenBao is unreachable.
- **Operate (secrets):** `make secrets`. Set `OFFGRID_OPENBAO_URL` + `OFFGRID_OPENBAO_TOKEN`
  (+ `OFFGRID_OPENBAO_MOUNT`, default `secret`).
- **Operate (identity/Keycloak):** `make identity` → set `AUTH_KEYCLOAK_ID/_SECRET/_ISSUER`. A
  "Continue with Keycloak" button then appears on `/signin`. New users default to `viewer`. See
  the Keycloak cookbook in `INTEGRATIONS.md` for realm/client setup.
- **Verify:** secrets - write `curl -H "X-Vault-Token: ..." -XPOST $URL/v1/secret/data/k ...` then read
  through the adapter; identity - open `/signin`, the configured provider buttons render.

### 3.7 Data plane / ingestion - `data` 🟢 core (⚪ ingestion optional)

- **Today:** PostgreSQL (state + audit) via Drizzle - REQUIRED.
- **Mapped (optional):** Debezium (CDC), Meltano (EL), Kafka, Spark, Iceberg, Trino (query),
  SeaweedFS (object store). Enabled only for the Data plane.
- **Operate:** `make data`. `DATABASE_URL=postgres://offgrid:offgrid@127.0.0.1:5432/offgrid_console`.

### 3.8 Policy & authorization - 🟢 (OPA swap in-path)

- **Today:** native RBAC + ABAC (deny-overrides) via the **`PolicyPort`** - `/admin/abac/evaluate`.
- **In-path swap:** `OFFGRID_ADAPTER_POLICY=opa` delegates the decision to Open Policy Agent
  (`POST /v1/data/offgrid/authz` → `{result:{allow}}`); the response `engine` reads `opa`. Falls
  back to ABAC if OPA is unreachable. (Cedar / OpenFGA remain mapped.)
- **Verify:** `make verify` (OPA allow/deny assertions).

### 3.9 Lineage & provenance - 🟢 (Marquez swap in-path)

- **Today:** the **`LineagePort`** - `native` is a no-op (lineage implicit in the audit trace).
- **In-path swap:** `OFFGRID_ADAPTER_LINEAGE=marquez` emits real OpenLineage run events on every
  ingest + retrieval (`brain.ingest` / `brain.retrieve` jobs), best-effort and non-blocking. Pairs
  with grounding for end-to-end answer provenance.
- **Signing (`SigningPort`):** `OFFGRID_ADAPTER_PROVENANCE=ed25519` upgrades export signing from
  HMAC (shared secret) to asymmetric ed25519 - verifiable with only the public key
  (`GET /api/v1/admin/sign`), no secret shared. C2PA / Sigstore remain mapped behind the same port.
- **Verify:** `make verify` (OpenLineage round-trip), the Marquez web UI (`:3001`), and the
  sign→verify→tamper→public-key-only round-trip on `/api/v1/admin/sign`.

### 3.10 Agent runtime & durability - ⚪

- **Mapped:** Agno (lightweight), Pydantic AI, LangGraph, Temporal (durable). Start with one
  lightweight runtime; add durability only when work needs it. The Agents module ships pre-built
  use cases today (`/api/v1/admin/agents`).

### 3.11 Runtime security - ⚪

- **Mapped:** E2B / Firecracker (sandboxing), Falco (runtime detection). For tool/code execution.

### 3.12 Evals & red-team - 🟢 native (⚪ external optional)

- **Today:** first-party golden-set evals over the Brain (`/api/v1/admin/evals`).
- **Mapped:** Promptfoo, DeepEval, Ragas, Garak (red-team), Inspect.

---

## 4. Running the OSS stack

```bash
cd deploy
make config            # validate compose (offline)
make up                # full stack
# or bring up only what you need (profiles = capabilities):
make data              # Postgres
make secrets           # OpenBao
make observability     # OTel Collector + VictoriaMetrics + VictoriaLogs
make ps                # status
make smoke             # health-check every service
make down              # stop (keeps volumes)
```

Requires a running Docker daemon (OrbStack/Docker Desktop). All images permissive-licensed
(`LICENSES.md`). The gateway is **not** here - start it separately on `:7878`.

---

## 5. Wiring the console to the stack

Copy the relevant lines from `deploy/.env.example` into `.env.local` (repo root) and restart the
console. Activating a real backend is one env var:

```bash
OFFGRID_ADAPTER_SECRETS=openbao          # secrets ← OpenBao
OFFGRID_OPENBAO_URL=http://127.0.0.1:8200
OFFGRID_OPENBAO_TOKEN=offgrid-dev-token

OFFGRID_ADAPTER_OBSERVABILITY=signoz     # observability ← OTel/VictoriaMetrics
OFFGRID_OTLP_URL=http://127.0.0.1:4318

DATABASE_URL=postgres://offgrid:offgrid@127.0.0.1:5432/offgrid_console
OFFGRID_GATEWAY_URL=http://127.0.0.1:7878
```

Confirm the bindings: `GET /api/v1/admin/adapters?health=1` or **Admin → Integrations · adapters**.

---

## 6. Verifying each integration

**Two levels.** `make smoke` proves each service is _reachable_ (answers `/health`). `make verify`
proves the _behavior contract_ of the in-path adapters - it sends the exact request each one sends
and asserts the response, so green means "the swap actually works," not just "the container is up."

```bash
cd deploy && make smoke      # reachability: every service → HTTP 200
cd deploy && make verify     # behavior: Presidio detects PII · OPA allow/deny · Marquez round-trip
```

`make verify` (script: `scripts/verify-adapters.sh`) is the honest answer to "how do I know the
integrations work?" - it's repeatable and asserts on real responses. Last run: **11/11 pass**
(Presidio PII · OPA allow · OPA deny · Marquez emit · Marquez query · Langfuse v3 OTLP · Keycloak
OIDC discovery · OpenBao KV round-trip · Redis SET/GET · OpenSearch index/search).

Per-integration manual checks:

```bash
# Guardrails (Presidio): the request shape PiiPort sends
curl -s -XPOST localhost:5002/analyze -H 'content-type: application/json' \
  -d '{"text":"jane@acme.com","language":"en"}'      # → EMAIL_ADDRESS entity

# Policy (OPA): the decision shape PolicyPort reads
curl -s -XPOST localhost:8181/v1/data/offgrid/authz -H 'content-type: application/json' \
  -d '{"input":{"role":"compliance","resource":"audit"}}'   # → {"result":{"allow":true}}

# Lineage (Marquez): after an ingest/retrieve, the job graph is queryable
curl -s localhost:9000/api/v1/namespaces/offgrid-console/jobs   # → brain.ingest / brain.retrieve

# Secrets (OpenBao): write, then read back through the adapter
curl -s -H "X-Vault-Token: offgrid-dev-token" -XPOST \
  http://127.0.0.1:8200/v1/secret/data/demo -d '{"data":{"value":"hello"}}'
#   → getSecrets().get('demo') returns "hello"

# Observability: trigger any audited action, then
docker compose -f deploy/docker-compose.yml logs otel-collector | grep offgrid-console

# Grounding: standalone, no Brain
curl -s -XPOST localhost:3000/api/v1/admin/grounding/verify -H 'content-type: application/json' \
  -d '{"answer":"A death claim needs the certificate.","sources":[{"text":"Capture the death certificate."}]}'

# Retrieval + embeddings (via gateway): runs the golden set
curl -s -XPOST localhost:3000/api/v1/admin/evals/run
```

---

## 6b. API surface (the contract)

The full, live spec is OpenAPI 3.1 at **`/openapi.json`**, rendered as an interactive playground
at **`/docs`** (Scalar). Node endpoints authenticate with device tokens; admin endpoints with an
SSO session. Grouped index:

**Node ↔ console** (device tokens): `POST /api/v1/devices/enroll` · `GET /api/v1/devices/{id}/policy`
· `POST /api/v1/devices/{id}/audit` · `GET /api/v1/devices/{id}/commands`.

**Control plane:** `GET /api/v1/devices` · `GET /api/v1/audit` · `GET|POST /api/v1/admin/policy`
· `POST /api/v1/admin/enroll-token` · `POST /api/v1/admin/devices/{id}/kill`.

**Admin / multi-tenant:** `GET|POST /api/v1/admin/tenants` · `PATCH|DELETE .../tenants/{id}` ·
`GET|POST /api/v1/admin/abac-rules` · `DELETE .../abac-rules/{id}` · `POST /api/v1/admin/abac/evaluate`.

**AI plane - Brain & retrieval:** `GET|POST /api/v1/admin/brain/documents` ·
`POST /api/v1/admin/brain/ingest` (text|file|image|database) · `GET /api/v1/admin/brain/search?q=` ·
`GET /api/v1/admin/sources` · `POST /api/v1/admin/retrieve` (the router).

**AI plane - grounding & evals:** `POST /api/v1/admin/grounding/verify` ·
`GET|POST /api/v1/admin/golden-cases` · `DELETE .../golden-cases/{id}` · `GET /api/v1/admin/evals` ·
`POST /api/v1/admin/evals/run`.

**AI plane - tools:** `GET|POST /api/v1/admin/tools` · `PATCH|DELETE .../tools/{id}` (the router's
tool registry).

**AI plane - agents:** `GET /api/v1/admin/agents`.

**Regulatory:** `GET /api/v1/admin/reports` · `GET /api/v1/admin/reports/{id}/export` ·
`GET /api/v1/admin/compliance/export`.

**Integrations:** `GET /api/v1/admin/adapters?health=1` (capability→adapter bindings).

## 6c. Tier-3 embeds (rich OSS UIs we don't rebuild)

Some tools have rich UIs not worth rebuilding (SigNoz dashboards, OpenBao admin). The console
surfaces them as **SSO'd iframes** to the customer's _own_ running instance - **Admin → Embedded
consoles**. An embed appears for any adapter with `render: 'embed'` once its URL env is set
(`OFFGRID_SIGNOZ_URL`, `OFFGRID_OPENBAO_URL`). The iframe is lazy-mounted (loads on expand) with an
open-in-new-tab fallback.

**License note:** an embed is a _separate, customer-run instance_ reached over the network - mere
aggregation. The tool's license never touches our core, so **even AGPL UIs (Grafana) are
embeddable**; copyleft would only bite if we _bundled/linked_ the tool into the closed core. SSO is
handled by the deployment's auth proxy in front of the tool. (SigNoz is MIT; Grafana/Loki are the
AGPL options - fine to embed, avoided only in the _bundled_ permissive stack - see `LICENSES.md`.)

## 7. Swapping a tool

1. Implement the port in `src/lib/adapters/<capability>.ts` (an object with `AdapterMeta` +
   the port methods).
2. Register it in that capability's array in `src/lib/adapters/registry.ts`.
3. Set `OFFGRID_ADAPTER_<CAPABILITY>=<id>`. Done - no caller changes.
4. Add a compose service (new profile entry) if it needs to run locally.
5. Permissive license only (MIT/Apache/BSD/ISC/MPL); integrate out-of-process. See `LICENSES.md`.

---

## 8. Troubleshooting

- **Adapter shows `unreachable`** (`/admin/adapters?health=1`): the gateway or tool isn't up, or
  the URL env is wrong. The console keeps working via fallbacks (env secrets, no-op OTel, lexical
  grounding, deterministic embeddings).
- **`docker compose up` can't connect:** the Docker daemon isn't running - start OrbStack/Docker.
- **Module-load env capture:** adapters read their URLs at process start; set env **before**
  starting the console (in `.env.local`), not at runtime.
- **OpenBao returns nothing:** dev mode stores under the `secret/` KV v2 mount; the value field is
  `.value`. Check the token and `OFFGRID_OPENBAO_MOUNT`.

---

## 9. Production notes

- **Never** ship dev tokens (`offgrid-dev-token`), `AUTH_DEV_LOGIN`, or OpenBao `-dev` mode.
- Terminate TLS in front of every service; the compose binds plaintext localhost ports for dev.
- Pin image tags (the compose uses `:latest` for convenience) and scan them in CI.
- Back up the Postgres volume; treat the audit table as append-only/WORM.
- For k8s, the Helm charts (roadmap) mirror these profiles as toggleable subcharts.

## 10. Agent QA, provenance, sandbox, Fleet Control - operate & verify

All follow the capability-port rule: a first-party default that always works + an OSS swap-in via
`OFFGRID_ADAPTER_<CAP>`, falling back to the default if unreachable.

- **Agent QA** - `OFFGRID_ADAPTER_EVALS` (golden | promptfoo | ragas), `OFFGRID_ADAPTER_DRIFT`
  (native PSI | evidently). Sidecars: `make qa` (Evidently `:8001`, Ragas `:8002`). Online scoring
  posts to Langfuse (`OFFGRID_LANGFUSE_URL/_AUTH`), gated by the `online-evals` flag +
  `OFFGRID_QA_SAMPLE_RATE`. **Schedule** `POST /admin/qa/sweep` (cron/CI) - 200 healthy / 503
  degraded; emits a `qa.sweep` span (alert on `degraded=true`). **Verify:** `make test-integrations`.
- **Provenance** - report exports carry an ed25519 detached manifest (`?manifest=1`); verify at
  `POST /admin/provenance/verify`. Images: `/admin/provenance/c2pa` (bundled signer, or
  `OFFGRID_C2PA_CERT/_KEY`). Sigstore: `/admin/provenance/sigstore` (public-good Fulcio/Rekor or
  `OFFGRID_FULCIO_URL/_REKOR_URL`; signing needs an OIDC token, verify is standalone).
- **Sandbox** - default `none` refuses. `OFFGRID_ADAPTER_SANDBOX=docker` + the `agent-code-exec`
  flag (default OFF) enables ephemeral, `--network none`, resource-capped containers. `/admin/sandbox/run`.
- **Fleet Control (MDM)** - default first-party registry. `OFFGRID_ADAPTER_MDM=fleetdm` +
  `OFFGRID_FLEET_URL` + `OFFGRID_FLEET_TOKEN`; `make mdm` (Fleet `:8070`, then create a token with
  `fleetctl`). **Verify:** `GET /admin/mdm/devices` (shows `backend`), FleetDM `/healthz`. Inventory,
  live osquery, software + CVE visibility, and policies are live. Device CONTROL commands (lock /
  wipe / config-profile push / settings enforcement) are coming soon - rendered disabled with a
  "Coming soon" label, never fired. Advanced MDM control is Fleet Premium, separately licensed. The
  first-party kill switch stays live regardless.
- **The interaction pipeline** (`agentrun.ts`) fires policy → guardrails → ground → provenance on
  every run; inspect a run's `steps[]` + `checks[]` + `provenance` via `GET /admin/agents/runs`.
