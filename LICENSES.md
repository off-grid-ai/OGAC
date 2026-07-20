# Off Grid Console — OSS license & legal audit

**Status:** working audit for the dual-license model — the **Off Grid AI Source-Available License
1.0** and a **commercial license**. Re-confirm each dependency license at release (some projects relicense —
flagged ⚠️ below).

## The decisive fact: architecture, not just license

The console **orchestrates** the underlying OSS tools as **separate processes over their
APIs / network protocols** (containers, HTTP, gRPC). It does **not** statically or
dynamically link their code into our binary, and it does **not** white-label or embed their
UIs. Legally this is **mere aggregation**:

- Our code is **not a derivative work** of an AGPL/GPL tool it merely calls over a socket.
- AGPL's network-copyleft applies to **that tool's own source** (already public), not to the
  console.
- SSPL / Elastic-License / BUSL restrictions target **offering that specific software as a
  managed service**. Our model ships software the **customer self-hosts on their own infra** —
  we are not running it as a SaaS for third parties.

This separation is the single most important compliance safeguard, and it's the same
"single interface, no linking, no white-label" principle we hold architecturally.

**A commercially licensed Off Grid component may be proprietary.** Because we keep OSS tools
out-of-process (aggregation, not linking), our own modules — console, gateway, Brain, agents — can
be distributed commercially without inheriting copyleft. The one hard rule: a proprietary module
must talk to an AGPL/GPL/SSPL/ELv2/BUSL tool **only over its API / a separate
process** — never by linking its code into the closed binary. Permissive (MIT/Apache/BSD)
tools may be linked into a closed-source build freely.

## Verdict by edition

- **Community edition:** all listed tools are usable. Permissive deps combine freely; AGPL
  tools (run as separate services) are fine; SSPL/ELv2/BUSL tools are kept as **optional,
  separate-process integrations** (not required dependencies of the first-party core).
- **Commercial edition:** safe to bundle/ship the **permissive** stack. For the
  **copyleft/source-available** tools (⚠️), do one of: (a) ship as **separate
  containers/services** the customer runs (aggregation — recommended default), (b) **swap**
  to the permissive equivalent listed, or (c) obtain a **commercial license** from the vendor.
  Never link their code into our proprietary binary.

## Tool-by-tool

| Tool                                                | License                                               | Edition notes                                                                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Off Grid AI Gateway**                             | Off Grid AI Source-Available License 1.0 / commercial | ✅ first-party; community use up to 25 users or separate commercial terms                                                                                |
| llama.cpp / vLLM / Ollama                           | MIT / Apache-2.0 / MIT                                | ✅ both editions                                                                                                                                         |
| NeMo Guardrails / Guardrails AI / Presidio / Rebuff | Apache-2.0 / Apache-2.0 / MIT / Apache-2.0            | ✅ both                                                                                                                                                  |
| OpenTelemetry                                       | Apache-2.0                                            | ✅ both                                                                                                                                                  |
| Langfuse                                            | MIT (core)                                            | ✅ core both; some **EE features are commercial-licensed** — use OSS edition or buy EE                                                                   |
| **Grafana / Loki / Tempo**                          | **AGPL-3.0** ⚠️                                       | separate services (aggregation) or **swap → SigNoz (MIT) / VictoriaMetrics+Logs (Apache-2.0) / OpenObserve (Apache-2.0)**; or Grafana commercial license |
| **Arize Phoenix**                                   | **Elastic License 2.0** ⚠️                            | self-host ship OK; not as our SaaS. Swap → **Langfuse (MIT)** / Opik (Apache-2.0)                                                                        |
| Promptfoo / DeepEval / Ragas / Garak / Inspect      | MIT / Apache-2.0 / Apache-2.0 / Apache-2.0 / MIT      | ✅ both                                                                                                                                                  |
| Open Policy Agent / Cedar / OpenFGA                 | Apache-2.0                                            | ✅ both                                                                                                                                                  |
| Keycloak                                            | Apache-2.0                                            | ✅ both                                                                                                                                                  |
| Auth.js (NextAuth)                                  | ISC                                                   | ✅ both                                                                                                                                                  |
| **HashiCorp Vault**                                 | **BUSL-1.1** ⚠️                                       | self-host OK; competing-hosted-service restricted. Swap → **OpenBao (MPL-2.0)**                                                                          |
| **LanceDB** / LlamaIndex / BGE                      | Apache-2.0 / MIT / MIT                                | ✅ both (our Brain store)                                                                                                                                |
| Debezium / Kafka / Spark / Iceberg / Trino          | Apache-2.0                                            | ✅ both                                                                                                                                                  |
| **Airbyte**                                         | **ELv2** (core) ⚠️                                    | self-host ship OK; not as our SaaS. Swap → **Meltano (MIT)** or use Debezium                                                                             |
| **MinIO**                                           | **AGPL-3.0** ⚠️                                       | separate service or **swap → SeaweedFS (Apache-2.0)** / Ceph; or MinIO commercial license                                                                |
| OpenLineage / Marquez / Sigstore                    | Apache-2.0                                            | ✅ both                                                                                                                                                  |
| Agno / Pydantic AI / LangGraph / Temporal           | MPL-2.0 / MIT / MIT / MIT                             | ✅ both                                                                                                                                                  |
| E2B / Firecracker / Falco                           | Apache-2.0                                            | ✅ both                                                                                                                                                  |
| PostgreSQL / Drizzle                                | PostgreSQL / Apache-2.0                               | ✅ both                                                                                                                                                  |

**Console's own dependencies** (Next.js, React, Tailwind, shadcn/ui, Magic UI, Aceternity,
recharts, next-auth, drizzle-orm, pg, lucide) are **MIT / ISC / Apache-2.0** — ✅ both editions.

## Watch-list (the only ⚠️ items) + default action

1. **Grafana / Loki / Tempo (AGPL)** and **MinIO (AGPL)** → run as separate containers
   (aggregation) for both editions; for a clean commercial story, prefer the permissive swaps
   (SigNoz / VictoriaMetrics; SeaweedFS).
2. **Airbyte / Arize Phoenix (ELv2)** → fine when the customer self-hosts; do **not** offer
   them as our hosted SaaS. Permissive swaps available (Meltano; Langfuse).
3. **HashiCorp Vault (BUSL)** → swap to **OpenBao** (MPL-2.0 fork) to avoid the BUSL question.
4. **Langfuse EE** → stay on the MIT OSS edition unless EE is licensed.

## Recommended zero-friction third-party build (permissive dependencies only)

To avoid third-party copyleft obligations and fork maintenance, ship the **permissive dependency
option in every layer** — MIT / Apache-2.0 / BSD / ISC / MPL-2.0 only. These dependencies can be
used without imposing their license on first-party Off Grid AI code:

- **Gateway:** Off Grid AI Gateway · llama.cpp · vLLM · Ollama
- **Guardrails:** Presidio · NeMo Guardrails · Guardrails AI
- **Observability:** OpenTelemetry · Langfuse · **SigNoz / VictoriaMetrics+Logs** (not Grafana/Loki)
- **Evals:** Promptfoo · DeepEval · Ragas · Garak · Inspect
- **Policy/Authz:** Open Policy Agent · Cedar · OpenFGA
- **Identity/Secrets:** Keycloak · Auth.js · **OpenBao** (not Vault)
- **Brain/RAG:** LanceDB · LlamaIndex · BGE
- **Data:** Debezium · Kafka · Spark · Iceberg · Trino · **SeaweedFS** (not MinIO) · **Meltano** (not Airbyte)
- **Lineage:** OpenLineage · Marquez · Sigstore
- **Agents:** Agno (MPL) · Pydantic AI · LangGraph · Temporal
- **Runtime security:** E2B · Firecracker · Falco
- **Datastore:** PostgreSQL · Drizzle

**The 5 to avoid + chosen permissive swap:** Grafana/Loki/Tempo (AGPL) → SigNoz/VictoriaMetrics ·
MinIO (AGPL) → SeaweedFS · Airbyte (ELv2) → Meltano · Arize Phoenix (ELv2) → Langfuse ·
HashiCorp Vault (BUSL) → OpenBao. Swap these and the entire shipped stack is permissive.

## Copyright / assets

- **Architecture diagrams** (`public/diagrams/*`): first-party Wednesday assets (the
  `cro/proposals` navigator). ✅ no third-party rights.
- **Off Grid logo** (`public/logo.png`): Wednesday's mark. ✅
- **UI component code** (shadcn / Magic UI / Aceternity): MIT, copy-in by design. ✅
- **lucide icons**: ISC. ✅
- **Menlo** typeface: referenced via `font-family` (system font), not embedded/redistributed. ✅

## Release checklist

- [ ] Re-confirm each ⚠️ license at release (relicensing happens).
- [ ] Decide per ⚠️ tool: separate-service vs swap vs commercial license; record the choice.
- [ ] Ship a `NOTICE` / third-party-licenses file with the distribution.
- [ ] Keep every OSS tool out-of-process (no linking into the commercial binary).
- [ ] Commercial edition: include only permissive deps in the linked build; copyleft tools
      are optional add-on services.
