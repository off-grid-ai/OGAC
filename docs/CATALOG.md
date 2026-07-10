# Integration catalog — every service: what · why · when · how to configure

The full inventory the console can run with. Each entry: **what** it is, **why/when** to use it,
and **how to configure** (compose profile → env → adapter id). The console works with **none** of
these (first-party defaults); each is an opt-in swap. All permissive-licensed — see `LICENSES.md`.

> Pattern for every swap: `cd deploy && make <profile>` → set `OFFGRID_ADAPTER_<CAP>=<id>` +
> the service URL in `.env.local` → restart the console → confirm in **Admin → Integrations ·
> adapters** (active + healthy). Remove the env var to revert to the first-party default.

---

## Required core

### Off Grid AI Gateway · `:7878` · first-party (external)

- **What:** the OpenAI-compatible, MCP-native, multimodal inference endpoint. The single egress.
- **Why:** every model call (chat, embeddings, grounding-NLI, vision) goes through it — the
  chokepoint where policy/guardrails/audit apply.
- **Configure:** `OFFGRID_GATEWAY_URL=http://127.0.0.1:7878`. Runs separately, never in compose.

### PostgreSQL + pgvector · `:5432` · PostgreSQL licence · profile `data`

- **What:** console state, the append-only audit log, AND the server-scale Brain vector store.
- **Why:** one durable store you already operate; pgvector serves the Brain at scale.
- **Configure:** `DATABASE_URL=…`; for the Brain set `OFFGRID_ADAPTER_RETRIEVAL=pgvector`.

---

## Data plane

### SeaweedFS · `:8333` · Apache-2.0 · profile `data`

- **What/why:** S3-compatible object store for documents/artifacts (the MinIO swap — permissive).
- **When:** you need raw/masked document zones or large-blob storage. **Configure:** `OFFGRID_SEAWEEDFS_URL`.

### Qdrant · `:6333` · Apache-2.0 · profile `ai`

- **What/why:** dedicated vector DB — an alternative Brain store for large fleets / high QPS.
- **When:** you outgrow LanceDB/pgvector. **Configure:** `OFFGRID_ADAPTER_RETRIEVAL=qdrant` + `OFFGRID_QDRANT_URL`.

---

## Secrets & identity

### OpenBao · `:8200` · MPL-2.0 · profile `secrets`

- **What/why:** KMS-backed secrets (KV v2) — the HashiCorp Vault swap, permissive.
- **When:** production secrets beyond env vars. **Configure:** `OFFGRID_ADAPTER_SECRETS=openbao` +
  `OFFGRID_OPENBAO_URL` + `OFFGRID_OPENBAO_TOKEN`.

### Keycloak · `:8080` · Apache-2.0 · profile `identity`

- **What/why:** full IAM — SSO / SAML / OIDC / federation. Default is Auth.js (Google/Entra).
- **When:** enterprise SSO/SAML, many realms. **Configure:** `OFFGRID_ADAPTER_IDENTITY=keycloak` +
  `OFFGRID_KEYCLOAK_URL`. Surfaced as a Tier-3 admin embed.

---

## Guardrails & policy

### Microsoft Presidio (analyzer `:5002` / anonymizer `:5001`) · MIT · profile `guardrails`

- **What/why:** production PII detection + anonymization. Default is the first-party regex checks.
- **When:** real PII/PHI workloads. **Configure:** `OFFGRID_ADAPTER_GUARDRAILS=presidio` + `OFFGRID_PRESIDIO_URL`.

### Open Policy Agent · `:8181` · Apache-2.0 · profile `policy`

- **What/why:** policy-as-code (Rego) decisions. Default is first-party RBAC + ABAC.
- **When:** complex authorization auditors recognize. **Configure:** `OFFGRID_ADAPTER_POLICY=opa` + `OFFGRID_OPA_URL`.

---

## Observability & tracing

### OpenTelemetry Collector · `:4318/:4317` · Apache-2.0 · profile `observability`

- **What/why:** one OTLP wire in, fans out to any backend. The seam `emitSpan` exports to.
- **Configure:** `OFFGRID_OTLP_URL=http://127.0.0.1:4318`. Config: `deploy/otel-collector.yaml`.

### VictoriaMetrics `:8428` / VictoriaLogs `:9428` · Apache-2.0 · profile `observability`

- **What/why:** metrics + logs backends (the Grafana/Loki swap — permissive, lightweight).
- **Configure:** `OFFGRID_SIGNOZ_URL` points dashboards at VictoriaMetrics; logs ingest via the collector.

### Jaeger · `:16686` · Apache-2.0 · profile `observability`

- **What/why:** distributed-trace backend — the queryable **app-layer trace UI** (spans incl. agent runs).
- **When:** you need to follow a request across steps/services. **Configure:** collector exports traces → Jaeger.

### Langfuse (+db) · `:3030` · MIT · profile `llmops`

- **What/why:** **LLM & agent tracing** — prompt/response, cost, sessions, prompt A/B, nested agent spans.
- **When:** content-level LLM observability + prompt management. **Configure:** `OFFGRID_ADAPTER_OBSERVABILITY=signoz`
  style + `OFFGRID_LANGFUSE_URL`. Tier-3 embed.

---

## Lineage, durability, infra

### OpenLineage + Marquez (+web `:3001`, api `:9000`, db) · Apache-2.0 · profile `lineage`

- **What/why:** dataset/job/run lineage — source→chunk→answer provenance as a queryable graph.
- **When:** regulators want lineage to source records. **Configure:** `OFFGRID_ADAPTER_LINEAGE=marquez` + `OFFGRID_MARQUEZ_URL`.

### Temporal (+ui `:8081`, server `:7233`, db) · MIT · profile `agents`

- **What/why:** durable workflow engine for long-running / multi-step agents.
- **When:** agents need retries, timers, durability. **Configure:** `OFFGRID_TEMPORAL_URL`.

### Redis · `:6379` · BSD-3 · profile `caching`

- **What/why:** scale backend for the response cache + rate limiting (first-party cache is in-process).
- **When:** multi-instance / high volume. **Configure:** `OFFGRID_ADAPTER_CACHING=redis` + `OFFGRID_REDIS_URL`.

### OpenSearch (+dashboards `:5601`) · `:9200` · Apache-2.0 · profile `siem`

- **What/why:** SIEM — full-text search + dashboards over the audit stream (the audit log ships here).
- **When:** security teams need search/alerting. **Configure:** `OFFGRID_OPENSEARCH_URL` (+ `_DASHBOARDS_URL`).

### Unleash (+db) · `:4242` · Apache-2.0 · profile `flags`

- **What/why:** feature-flag service — the backbone of modular capability/module control at scale.
- **When:** toggle modules/capabilities per tenant/env. **Configure:** `OFFGRID_ADAPTER_FLAGS=unleash` + `OFFGRID_UNLEASH_URL`.

### Apache Superset · `:8088` · Apache-2.0 · profile `bi`

- **What/why:** BI / data exploration — SQL Lab, charts, pivot/transpose, dashboards (the Metabase swap;
  Metabase is AGPL → embed-only). First run: `docker compose exec superset superset init`.
- **When:** analysts need to explore/transpose data. **Configure:** `OFFGRID_SUPERSET_URL`. Tier-3 embed.

## Agent QA — evals, scoring & drift

The capability that answers "are the agents still doing a good job?" Full reference:
**[Agent QA handbook](/handbook/agent-qa)**. Three lanes, each a swappable port (first-party default +
OSS swap-in, graceful fallback).

### Off Grid golden set · first-party · always on

- **What/why:** offline eval — `query → expected source` scored as recall over the Brain. The
  zero-OSS default for the evals lane. **When:** baseline regression check. **Configure:** none;
  edit cases in the console. Run: `POST /api/v1/admin/evals/run`.

### promptfoo · MIT · CLI (no container)

- **What/why:** offline eval — assertion matrix across prompts/providers, run against the gateway.
- **When:** CI regression gating. **Configure:** `OFFGRID_ADAPTER_EVALS=promptfoo` + the `promptfoo`
  binary on PATH (or `OFFGRID_PROMPTFOO_BIN`). Falls back to golden.

### Ragas + DeepEval (sidecar) · `:8002` · Apache-2.0 · profile `qa`

- **What/why:** offline RAG metrics — faithfulness, answer relevancy, context recall. Bundled Python
  sidecar that runs Ragas through the on-device gateway (judge + embeddings); the console assembles
  the dataset (Brain contexts + gateway answers + golden ground-truth).
- **When:** measure grounding quality of a RAG agent. **Configure:** `OFFGRID_ADAPTER_EVALS=ragas` +
  `OFFGRID_RAGAS_URL`. `make qa`. Falls back to golden if the model/sidecar is unavailable.

### Langfuse online scoring · MIT · profile `llmops`

- **What/why:** online eval — LLM-as-judge (via the gateway) scores live interactions for quality +
  faithfulness and writes them to Langfuse, where the trend over time is the degradation signal.
- **When:** continuous QA on production traffic. **Configure:** `OFFGRID_LANGFUSE_URL` +
  `OFFGRID_LANGFUSE_AUTH`; gated by the `online-evals` flag. `POST /api/v1/admin/qa/score`.

### Off Grid drift (PSI) · first-party · always on

- **What/why:** drift/degradation — Population Stability Index + mean-drop over the eval-score
  history. The zero-OSS default for the drift lane. **When:** spot regressions without extra infra.
  **Configure:** none. `GET /api/v1/admin/qa/drift`.

### Evidently (sidecar) · `:8001` · Apache-2.0 · profile `qa`

- **What/why:** drift — real Evidently `DataDriftPreset` over baseline vs current eval-score windows.
  Bundled Python sidecar. **When:** report-grade drift test suites. **Configure:**
  `OFFGRID_ADAPTER_DRIFT=evidently` + `OFFGRID_EVIDENTLY_URL`. `make qa`. Falls back to first-party PSI.

## Fleet Control — device management (MDM)

### Off Grid device registry · first-party · always on

- **What/why:** the nodes enrolled in this console — provision, push policy, pull audit, kill-switch.
  The zero-OSS default for Fleet Control. **Configure:** none. Endpoint: `GET /admin/mdm/devices`.

### FleetDM · `:8070` · MIT (Fleet Free) · profile `mdm`

- **What/why:** osquery-based, cross-platform device fleet (macOS/Windows/Linux/iOS/Android) - device
  inventory, live queries, software + CVE visibility, policies, GitOps - reached over its REST API.
  The production swap-in for Fleet Control; our "nodes" map to Fleet "hosts". **Fleet Free is MIT**
  (free OSS); **Fleet Premium is paid and NOT required.**
- **Coming soon:** device CONTROL - the MDM commands that act on a device (lock / wipe /
  config-profile push / settings enforcement / Apple APNs enrollment). In the console these render
  disabled with a "Coming soon" label rather than firing. Advanced MDM control is Fleet Premium,
  separately licensed. The inventory/query/policy views above stay live.
- **When:** real fleet-scale device inventory and posture. **Configure:** `OFFGRID_ADAPTER_MDM=fleetdm` +
  `OFFGRID_FLEET_URL` + `OFFGRID_FLEET_TOKEN`. `make mdm`, then create a token with `fleetctl`
  (see the compose comment). Falls back to the first-party registry if unreachable.

## Provenance & tamper-evidence

Make answers, exports, and assets verifiable. All options below are free OSS — no fees, no API keys.

### ed25519 export manifests · first-party · always on

- **What/why:** detached, signed provenance for report exports — the file's SHA-256 + metadata,
  signed with an asymmetric key so anyone verifies with only the **public** key (no shared secret).
- **When:** every report download. **Configure:** none (`OFFGRID_SIGNING_KEY`/`OFFGRID_ADAPTER_PROVENANCE`
  optional). Export: `/admin/reports/[id]/export?format=pdf|md&manifest=1`; verify:
  `POST /admin/provenance/verify`.

### C2PA Content Credentials · permissive (CAI) · `c2pa-node` (no container)

- **What/why:** the industry-standard signed manifest **embedded in image assets** (PNG/JPEG).
  Bundled test signer by default (no fees/keys); `OFFGRID_C2PA_CERT/_KEY` for a real identity.
- **When:** signing generated/exported images. **Note:** images only — text/PDF use the ed25519
  manifest above. Endpoint: `POST /admin/provenance/c2pa` (sign / verify).

### Sigstore · Apache-2.0 · `sigstore-js` (no container)

- **What/why:** keyless signing/attestation — OIDC identity → short-lived Fulcio cert → Rekor
  transparency log → a self-contained bundle anyone verifies. No long-lived key.
- **When:** attesting artifacts/exports with a public audit trail. **Configure:** public-good
  Fulcio/Rekor (free, no key) or `OFFGRID_FULCIO_URL`/`OFFGRID_REKOR_URL` to self-host; signing
  needs an OIDC token (`OFFGRID_SIGSTORE_IDENTITY_TOKEN`). Endpoint: `POST /admin/provenance/sigstore`.

## Sandbox — isolated agent code execution

### Off Grid Docker sandbox · first-party · default beyond no-exec

- **What/why:** runs agent-authored code in an **ephemeral container** — `--network none`, memory/CPU/PID
  caps, read-only root, dropped caps, non-root, hard timeout. Free, no API key, no Linux/KVM host.
- **When:** an agent must run code. **Configure:** `OFFGRID_ADAPTER_SANDBOX=docker` + enable the
  `agent-code-exec` flag (default OFF). Default is `none` (refuses). Endpoint: `POST /admin/sandbox/run`.
- **Swap-ins:** E2B (cloud microVMs — **paid**, not default), self-hosted Firecracker (free, Linux/KVM),
  Falco (free, runtime threat detection on the host). The Docker sandbox is the free OSS default.

---

## At a glance

| Capability          | Default (first-party) | OSS swap                                 | Profile                |
| ------------------- | --------------------- | ---------------------------------------- | ---------------------- |
| inference           | Off Grid Gateway      | —                                        | (external)             |
| retrieval           | LanceDB               | pgvector · Qdrant                        | data · ai              |
| secrets             | env                   | OpenBao                                  | secrets                |
| identity            | Auth.js               | Keycloak                                 | identity               |
| guardrails          | checks                | Presidio                                 | guardrails             |
| policy              | RBAC+ABAC             | OPA                                      | policy                 |
| observability       | OTLP no-op            | OTel→VictoriaMetrics · Jaeger · Langfuse | observability · llmops |
| lineage             | (emit)                | Marquez                                  | lineage                |
| caching             | in-process            | Redis                                    | caching                |
| siem                | audit store           | OpenSearch                               | siem                   |
| flags               | env                   | Unleash                                  | flags                  |
| bi                  | —                     | Superset (· Metabase embed)              | bi                     |
| agents (durability) | in-process            | Temporal                                 | agents                 |
| evals               | golden set            | promptfoo · Ragas (sidecar)              | qa                     |
| drift               | PSI (first-party)     | Evidently (sidecar)                      | qa                     |
| online scoring      | LLM-as-judge → Langfuse | —                                      | llmops                 |
| provenance          | ed25519 manifest      | C2PA (images) · Sigstore                 | (in-process)           |
| sandbox             | none (no-exec)        | Docker (free) · E2B paid · Firecracker   | (docker/host)          |
| mdm (Fleet Control) | device registry       | FleetDM (osquery, MIT)                    | mdm                    |
