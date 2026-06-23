# Integration points — the adapter layer

How the console talks to every underlying system. The rule: **callers depend on a capability
port, never on a specific tool.** Swapping a third-party tool is a registry/env change, not a
rewrite — that's what keeps the OSS stack swappable and in sync without us maintaining a fork.

Code: `src/lib/adapters/`.

## The contract

Each underlying system is reached through a **capability port** — a small TypeScript interface
in `src/lib/adapters/types.ts`. An adapter is an object that implements a port and carries an
`AdapterMeta`:

```ts
interface AdapterMeta {
  id: string; // 'gateway', 'signoz', 'openbao', …  (the swap key)
  capability: Capability;
  vendor: string; // shown in the console
  license: string; // SPDX id; permissive only — see LICENSES.md
  render: 'native' | 'embed' | 'headless';
  embedUrl?: string; // for render: 'embed'
  description: string;
}
```

`render` declares how the tool's own UI is surfaced — the tiered integration model:

| `render`   | Meaning                                         | Examples                  |
| ---------- | ----------------------------------------------- | ------------------------- |
| `native`   | We build the UI against the port (full brand)   | gateway, checks, LanceDB  |
| `embed`    | Rich UI we don't rebuild — SSO'd, themed iframe | SigNoz, OpenBao           |
| `headless` | No UI; pure backend seam                        | OTel emitter, env secrets |

## Capabilities & ports today

| Capability      | Default adapter         | Swappable for (OSS)  | How the OSS is wired      |
| --------------- | ----------------------- | -------------------- | ------------------------- |
| `inference`     | Off Grid AI Gateway     | (always the gateway) | in-path (the one gateway) |
| `retrieval`     | LanceDB                 | pgvector · Qdrant    | in-path (vector search)   |
| `grounding`     | Gateway NLI             | Lexical (offline)    | in-path (entailment)      |
| `guardrails`    | Off Grid checks (regex) | Microsoft Presidio   | **in-path** (PiiPort)     |
| `policy`        | Off Grid RBAC + ABAC    | Open Policy Agent    | **in-path** (PolicyPort)  |
| `lineage`       | native (no-op)          | Marquez              | **in-path** (LineagePort) |
| `observability` | OpenTelemetry (OTLP)    | SigNoz · Langfuse    | in-path (span fan-out)    |
| `identity`      | Auth.js                 | Keycloak             | **in-path** (OIDC login)  |
| `secrets`       | Process env             | OpenBao              | in-path (SecretsPort)     |
| `caching`       | In-process (exact)      | Redis (+ semantic)   | in-path (cache lookup)    |
| `siem`          | Off Grid audit store    | OpenSearch           | embed UI + log shipping   |
| `flags`         | Off Grid flags (env)    | Unleash              | embed UI                  |
| `bi`            | (none)                  | Superset · Metabase  | embed UI                  |

**In-path vs embed.** _In-path_ adapters actually perform the work when selected — flipping
`OFFGRID_ADAPTER_GUARDRAILS=presidio` routes real PII scans through Presidio; the call site
(`getPii().scan()`) never knows which engine answered. _Embed_ adapters surface a rich OSS UI
behind an SSO'd iframe (mere aggregation; their license never touches our core). Every in-path
OSS adapter **falls back to the first-party engine if its service is unreachable**, so a swap is
always reversible and never a hard dependency.

First-party defaults mean the console works with **zero OSS**; each OSS entry is a one-env-var
swap (`OFFGRID_ADAPTER_<CAP>`). The full runnable stack is `deploy/docker-compose.yml` (one
canonical file, profiled by capability → variants derive from it). FinOps (cost) and token
issuance + per-user/per-project usage are **first-party** capabilities (we own the gateway), not
OSS — tracked on the audit record.

**What the console reuses from Off Grid — and what it doesn't.** From the Off Grid ecosystem the
console reuses exactly two things: the **UI** (design system) and the **Off Grid AI Gateway**
(multimodal, MCP-native). It pulls in **no other Off Grid packages** — not `@offgrid/rag`, no
desktop/mobile code — and otherwise stands on its own stack (Postgres, the vector store,
observability, etc. are the console's own third-party OSS, integrated behind these ports).
**All model/inference goes through the one gateway** (embeddings, grounding/NLI, vision); the
console never talks to a third-party LLM. The offline inference adapter is only a no-network
fallback, not a vendor swap.

**Grounding is standalone.** The `grounding` capability verifies an answer against caller-supplied
sources (`POST /api/v1/admin/grounding/verify`) with **no dependency on the Brain or any store** —
a customer can buy grounding to verify their own RAG stack. Default adapter runs entailment through
the gateway; the lexical adapter is a deterministic offline baseline.

## Choosing an adapter

The active adapter is the first registered for a capability, overridable per deployment with
one env var — no code change:

```
OFFGRID_ADAPTER_INFERENCE=local       # air-gapped: deterministic embeddings, no network
OFFGRID_ADAPTER_OBSERVABILITY=signoz  # ship traces to a SigNoz embed
OFFGRID_ADAPTER_SECRETS=openbao
```

Callers only ever do:

```ts
import { getInference } from '@/lib/adapters/registry';
const vec = await getInference().embed(text); // gateway or fallback — caller doesn't care
```

The Brain (`src/lib/brain.ts`) embeds exclusively through `getInference()`; swapping the model
endpoint never touches retrieval code.

## Inspecting bindings

- API: `GET /api/v1/admin/adapters` → `{ capability, active, alternatives, healthy? }[]`.
  `?health=1` probes the live inference backend.
- UI: **Admin → Integrations · adapters** lists the active adapter, license, UI mode, and what
  each capability can be swapped for.

## Running the real OSS (testable end-to-end)

The adapters aren't stubs — they talk to real services. `deploy/` ships a profiled Docker Compose
that brings up the permissive OSS so every integration is testable. Profiles map 1:1 to
capabilities, so you run only what you've licensed.

```bash
cd deploy
cp .env.example ../.env.local        # 1. copy the env template, edit URLs if needed
make up                              # 2. bring up the full stack (or: make policy | guardrails | …)
make smoke                           # 3. reachability — every service answers /health
make verify                          # 4. BEHAVIOR — the swaps actually change behavior (see below)
```

`make smoke` proves a service is _up_. `make verify` proves the _contract_: it sends the exact
request each in-path adapter sends and asserts on the response (Presidio detects an email entity,
OPA returns allow/deny, Marquez accepts an OpenLineage event and the job graph is then queryable).
A green `verify` is the difference between "reachable" and "wired." Script:
`scripts/verify-adapters.sh`.

## Configure each integration (cookbook)

Every integration is the same three moves: **bring it up → set the env → confirm it works.** Put
the env lines in `.env.local` (copy from `deploy/.env.example`). Restart the console after editing.

### Guardrails → Microsoft Presidio (PII detection, in-path)

```bash
cd deploy && make guardrails                 # presidio-analyzer on :5002, anonymizer on :5001
```

```ini
OFFGRID_ADAPTER_GUARDRAILS=presidio
OFFGRID_PRESIDIO_URL=http://127.0.0.1:5002
```

Confirm: `curl -s -XPOST localhost:5002/analyze -H 'content-type: application/json' \`
`-d '{"text":"jane@acme.com","language":"en"}'` → returns an `EMAIL_ADDRESS` entity. In the
console, the `pii` check on any request now reports `PII (presidio): …`. Unset the env to revert
to the built-in regex.

### Policy → Open Policy Agent (Rego decisions, in-path)

```bash
cd deploy && make policy                      # OPA on :8181
# load your policy under package offgrid.authz with an `allow` rule:
curl -XPUT localhost:8181/v1/policies/offgrid --data-binary @your-policy.rego
```

```ini
OFFGRID_ADAPTER_POLICY=opa
OFFGRID_OPA_URL=http://127.0.0.1:8181
```

Confirm: `POST /api/v1/admin/abac/evaluate {"role":"compliance","resource":"audit"}` → the
response `engine` field reads `opa` (vs `abac` for the built-in). OPA must expose
`/v1/data/offgrid/authz` returning `{"result":{"allow":bool}}`. Down/unset → falls back to ABAC.

### Lineage → Marquez (OpenLineage graph, in-path)

```bash
cd deploy && make lineage                     # marquez API :9000, web UI :3001
```

```ini
OFFGRID_ADAPTER_LINEAGE=marquez
OFFGRID_MARQUEZ_URL=http://127.0.0.1:9000
OFFGRID_LINEAGE_NAMESPACE=offgrid-console
```

Confirm: ingest a doc or run a retrieval, then open the Marquez web UI (`:3001`) → namespace
`offgrid-console` shows `brain.ingest` / `brain.retrieve` jobs with their input→output datasets.
Default (`native`) is a no-op — lineage stays implicit in the audit log.

### Observability → OTLP collector (+ SigNoz / Langfuse, in-path)

```bash
cd deploy && make observability               # OTel Collector :4318 → VictoriaMetrics / Jaeger
```

```ini
OFFGRID_OTLP_URL=http://127.0.0.1:4318        # emitSpan exports real OTLP here
OFFGRID_ADAPTER_OBSERVABILITY=signoz          # optional: label/route to SigNoz
# Langfuse direct OTLP (LLM traces) — compose runs Langfuse v3 with a headless key pair, so this
# works out of the box (AUTH = base64("public:secret")). Bring up: `make llmops`.
OFFGRID_LANGFUSE_OTLP_URL=http://127.0.0.1:3030/api/public/otel
OFFGRID_LANGFUSE_AUTH=cGstbGYtb2ZmZ3JpZC1jb25zb2xlOnNrLWxmLW9mZmdyaWQtY29uc29sZQ==
```

Confirm: trigger any traced action (an agent run), then find the span in Jaeger (`:16686`); with
the Langfuse vars set the same span also lands in Langfuse (`:3030`, login `dev@offgrid.local` /
`offgrid-dev-pw`). `make verify` asserts the OTLP round-trip automatically. **Langfuse v3** ships
as a 5-container set (web + worker + ClickHouse + MinIO + Redis), scoped to the `llmops` profile —
heavier than the rest, so only `make llmops`/`make up` start it.

### Provenance → ed25519 signing (public-key, in-path, no OSS needed)

Exported answers are signed so they're tamper-evident. The default is HMAC (shared secret);
ed25519 produces **asymmetric** signatures a third party can verify with only the public key — the
real provenance property. No container required (first-party crypto).

```ini
OFFGRID_ADAPTER_PROVENANCE=ed25519
# production: pin a stable keypair (else one is generated per process)
# OFFGRID_ED25519_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
```

Confirm: `POST /api/v1/admin/sign {"payload":{…}}` → returns `{signature, algorithm:"Ed25519",
publicKey}`; re-POST with that `signature` → `{valid:true}`; tamper the payload → `{valid:false}`;
`GET /api/v1/admin/sign` returns the public key alone, with which anyone can verify offline (no
shared secret). C2PA Content Credentials / Sigstore are the heavier external upgrades behind this
same port.

### Identity → Keycloak (SSO login, in-path)

Keycloak is a real **sign-in provider** (OIDC), not just an embed — it self-activates in Auth.js
when its client env is set, and a "Continue with Keycloak" button appears on `/signin`.

```bash
cd deploy && make identity          # Keycloak on :8080 (admin / offgrid-dev)
cd deploy && make identity-setup    # provision realm + OIDC client + test user, prints the env
```

`make identity-setup` (script: `scripts/keycloak-setup.sh`) is idempotent — it creates the
`offgrid` realm, a confidential `offgrid-console` client with the right redirect URI, and a test
user, then prints the exact env block. Paste it into `.env.local`:

```ini
AUTH_KEYCLOAK_ID=offgrid-console
AUTH_KEYCLOAK_SECRET=<printed by the script>
AUTH_KEYCLOAK_ISSUER=http://localhost:8080/realms/offgrid
```

Confirm: restart the console, open `/signin` → the "Continue with Keycloak" button redirects to
Keycloak and back (test user `advisor` / `advisor-pw`). `make verify` asserts the OIDC discovery
doc automatically. New users default to the `viewer` role (map realm roles → console roles as a
follow-up). To set up against your own realm by hand: create an OIDC client (confidential, standard
flow) with redirect `http://localhost:3000/api/auth/callback/keycloak` and copy its secret.

### Secrets → OpenBao · Cache → Redis · SIEM → OpenSearch · Flags → Unleash

```ini
OFFGRID_ADAPTER_SECRETS=openbao      ; OFFGRID_OPENBAO_URL=http://127.0.0.1:8200
OFFGRID_ADAPTER_CACHING=redis        ; OFFGRID_REDIS_URL=redis://127.0.0.1:6379
OFFGRID_ADAPTER_SIEM=opensearch      ; OFFGRID_OPENSEARCH_URL=http://127.0.0.1:9200
OFFGRID_ADAPTER_FLAGS=unleash        ; OFFGRID_UNLEASH_URL=http://127.0.0.1:4242
```

Bring each up with its profile (`make secrets|identity|… `), confirm with `make smoke`. The full
env reference with every URL is `deploy/.env.example`; every service's config knobs are in
`CATALOG.md`.

## Adding an adapter

1. Implement the port in `src/lib/adapters/<capability>.ts` with an `AdapterMeta`.
2. Register it in the capability's array in `src/lib/adapters/registry.ts`.
3. Permissive license only (MIT/Apache/BSD/ISC/MPL) — see `LICENSES.md`. Out-of-process
   integration keeps copyleft tools at arm's length (mere aggregation).
4. For `render: 'embed'`, set `embedUrl` and wire the SSO'd iframe (Tier-3).
