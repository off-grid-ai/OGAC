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

| Capability      | Default adapter          | Swappable for (OSS)  | License of OSS |
| --------------- | ------------------------ | -------------------- | -------------- |
| `inference`     | Off Grid AI Gateway      | (always the gateway) | first-party    |
| `retrieval`     | LanceDB                  | pgvector · Qdrant    | Apache/PG      |
| `grounding`     | Gateway NLI              | Lexical (offline)    | first-party    |
| `guardrails`    | Off Grid checks (native) | Microsoft Presidio   | MIT            |
| `policy`        | Off Grid RBAC + ABAC     | Open Policy Agent    | Apache-2.0     |
| `identity`      | Auth.js                  | Keycloak             | Apache-2.0     |
| `secrets`       | Process env              | OpenBao              | MPL-2.0        |
| `observability` | OpenTelemetry (OTLP)     | SigNoz · Langfuse    | MIT/Apache     |
| `lineage`       | (OpenLineage emit)       | Marquez              | Apache-2.0     |
| `caching`       | In-process (exact)       | Redis (+ semantic)   | BSD-3          |
| `siem`          | Off Grid audit store     | OpenSearch           | Apache-2.0     |
| `flags`         | Off Grid flags (env)     | Unleash              | Apache-2.0     |

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
that brings up the permissive OSS so every integration is testable:

```bash
cd deploy && make up && make smoke   # or: make secrets | make observability | make data
```

Then point the console at them (`deploy/.env.example` → `.env.local`) and flip the adapter:
`OFFGRID_ADAPTER_SECRETS=openbao` reads from OpenBao's KV; `OFFGRID_ADAPTER_OBSERVABILITY=signoz`

- `OFFGRID_OTLP_URL` makes `emitSpan` export real OTLP to the collector. Profiles map to
  capabilities, so you run only what you've licensed. See `deploy/README.md`.

## Adding an adapter

1. Implement the port in `src/lib/adapters/<capability>.ts` with an `AdapterMeta`.
2. Register it in the capability's array in `src/lib/adapters/registry.ts`.
3. Permissive license only (MIT/Apache/BSD/ISC/MPL) — see `LICENSES.md`. Out-of-process
   integration keeps copyleft tools at arm's length (mere aggregation).
4. For `render: 'embed'`, set `embedUrl` and wire the SSO'd iframe (Tier-3).
