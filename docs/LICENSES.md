# Licensing & legal

Off Grid Console is **dual-licensed** and built so the whole platform can run **without paying any
third party** — no per-token fees, no API keys, no per-seat AI licence.

## The console itself
- **AGPL-3.0** for the open core, **+ a commercial license** for organizations that can't ship
  AGPL. (Open-core: the OSS core is free; paid features + the commercial license fund the project.)
- Contributions under a **CLA**.

## Bundled OSS — permissive only
Everything we **bundle / run in-process or in the default compose** is **permissive** (MIT /
Apache-2.0 / BSD / ISC / MPL-2.0 / PostgreSQL). Nothing copyleft is linked into the core.

| Capability | Tool | License |
|---|---|---|
| Inference | Off Grid AI Gateway (llama.cpp) | MIT |
| State/audit | PostgreSQL · Drizzle | PostgreSQL · Apache-2.0 |
| Retrieval | LanceDB · Qdrant · pgvector | Apache-2.0 / PostgreSQL |
| Guardrails | Microsoft Presidio | MIT |
| Policy | Open Policy Agent | Apache-2.0 |
| Identity | Auth.js · Keycloak | ISC · Apache-2.0 |
| Secrets | OpenBao | MPL-2.0 |
| Observability | OpenTelemetry · VictoriaMetrics · Jaeger · Langfuse | Apache-2.0 / MIT |
| Lineage | OpenLineage · Marquez | Apache-2.0 |
| Caching | Redis | BSD-3-Clause |
| SIEM | OpenSearch | Apache-2.0 |
| Flags | Unleash | Apache-2.0 |
| Agent runtime | Temporal | MIT |
| Evals | promptfoo · Ragas / DeepEval | MIT · Apache-2.0 |
| Drift | Evidently | Apache-2.0 |
| Provenance | ed25519 (first-party) · C2PA (CAI) · Sigstore | first-party · permissive · Apache-2.0 |
| Sandbox | Docker sandbox (first-party) | first-party |
| MDM / Fleet Control | FleetDM **Free** · osquery | **MIT** · Apache-2.0 |
| BI | Apache Superset | Apache-2.0 |

## Copyleft & paid — kept at arm's length (NOT bundled)
- **Metabase (AGPL)** — embed-only (a separate, customer-run instance = mere aggregation), never linked.
- **Fleet Premium** (`ee/`) — paid/source-available. We use **Fleet Free (MIT)** only. The Fleet
  Free core powers what ships today (host inventory, live osquery, software + CVE, policies). Device
  CONTROL (lock / wipe / config-profile push / settings enforcement) is coming soon, and advanced
  MDM control leans on Fleet Premium (separately licensed) - so it ships when a self-hostable MIT
  path is real, never by bundling the paid tier.
- **E2B cloud** — paid (API key). Not the default; the **Docker sandbox** (free) is. Self-hosted
  Firecracker (Apache-2.0) is the free isolation upgrade.
- **Sigstore public good** — free + keyless (no API key); self-host Fulcio/Rekor optionally.

## How we keep it clean
- OSS swap-ins run **out-of-process** (HTTP/embed), so a copyleft tool a customer chooses to run is
  mere aggregation, never linked into our core.
- Every new integration must be **permissive to bundle**, or **embed-only** if copyleft, or clearly
  marked **paid / configure-to-activate** so nothing claims to be free that isn't.
