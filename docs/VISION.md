# Off Grid — Vision

> **We make enterprises intelligent.**
>
> One integrated, on-premise platform that harnesses the intelligence *inside* an
> organization — its data, its documents, its people, its systems — together with the
> intelligence *outside* it — open-weight and cloud models — and puts every bit of it under
> the enterprise's own governance, compliance, and control. Nothing leaves their perimeter
> unless they say so.

This is the strategy document: what we are building, who it is for, why it wins, and why an
*integrated* platform beats the point tools it replaces. The phase plan lives in
[`ROADMAP.md`](./ROADMAP.md); the service-by-service inventory in
[`OSS_SERVICES_MATRIX.md`](./OSS_SERVICES_MATRIX.md). This document is the "why" above both.

---

## 1. The thesis

Every enterprise now wants AI. Almost none can safely get it. Their intelligence is trapped in
two places, and they can reach neither without giving something up:

- **The intelligence *inside* the org** — core banking records, policy documents, CRM history,
  the ERP, the tribal knowledge in SOPs and people's heads — is locked in silos, ungoverned for
  AI use, and impossible to query in natural language without shipping it to someone else's cloud.
- **The intelligence *outside* the org** — frontier cloud models and the fast-moving world of
  open-weight models — is powerful, but pointing it at internal data means sending regulated,
  customer-owned information to a third party. For a bank, an insurer, a hospital, that is a
  non-starter.

The market's answer so far has been a **pile of point tools**: a gateway to route model calls, a
separate observability tool to trace them, a separate eval tool to test them, a separate
governance tool to police them, a separate enterprise-search tool to reach internal data. Each is
SaaS. Each holds a copy of your prompts and often your data. Each is one more contract, one more
integration, one more seam where governance leaks.

**Off Grid collapses that pile into one platform that runs on the enterprise's own hardware.**
The moat is not any single capability — it is the *integration*: the gateway knows about the
policy engine, the policy engine knows about the PII scanner, the PII scanner's verdict lands in
the same audit trail the regulator reads, the retrieval layer respects the same access rules as
the chat window, and the cost of every token is attributed back to the team that spent it. One
control plane. One identity model. One audit ledger. One place an operator sits down and runs the
whole thing.

---

## 2. Who this is for

The console's consumer is an **organization's AI operations and governance function** — not an
individual end user (that is Off Grid Desktop/Mobile). For our beachhead, mid-market **BFSI in
India** (banks, insurers, brokerages, lenders), that function is four people with four jobs:

| Persona | Their job | What they need from us | Modules they live in |
|---|---|---|---|
| **Platform / AI ops** | Keep it running, fast, and cheap | Model routing, health, caching, fallback, one place to add a capability | Gateway, Services, Retrieval, Config, Backups, FinOps |
| **Risk / compliance officer** *(the BFSI kingmaker)* | Prove to a regulator it is controlled | Policy, PII masking, access control, tamper-evident audit, eval evidence, drift, lineage, regulatory reports | Policy, Guardrails, Access, SIEM, Evals, Drift, Lineage, Provenance, Regulatory |
| **Builder / developer** | Ship AI features on the private stack | RAG over internal data, agents, prompt library, an OpenAI-compatible API | Chat, Agents, Studio, Knowledge, Prompts, API |
| **Finance owner** | Decide if it's worth it | Cost per team/model/use-case, budgets, chargeback | FinOps, Analytics, Reports |

The compliance officer is the one who says yes or no. In regulated industries the buying decision
is not "is the AI good" — it is "can I defend this to my regulator." That reframes the whole
product: **governance is not a feature we add, it is the reason we exist**, and it is why we win
where a pure developer tool cannot.

---

## 3. The two intelligence flows (the core of the product)

Everything we build serves one of two flows. If a feature serves neither, it does not belong.

### 3a. Harness the intelligence *inside* the org

Turn siloed enterprise systems into something the org can ask questions of — safely.

- **Connectors** pull from the real systems of record (Postgres core-banking, MySQL policy-admin,
  MSSQL ERP, Kafka streams, S3/warehouse, CRM). *In place today: 6 live connectors over ~49k rows
  of seeded enterprise data.*
- **Ingestion → retrieval** chunks, embeds (on our own embedding model, on our own hardware), and
  indexes into a vector store (LanceDB embedded, Qdrant at scale). *In place: `rag.ts`,
  `brain.ts`, project-scoped knowledge with citations.*
- **Permissions-aware retrieval** — the answer only ever draws on sources the asker is allowed to
  see. This is where Glean-class enterprise search lives, but *inside the perimeter*, not in a
  vendor's cloud. *Foundation in place (ABAC + project isolation); real-time source-permission
  binding is roadmap.*
- **Grounded, cited answers** — every response carries `[Source: …]` provenance back to the
  internal document it came from, so a human (or an auditor) can verify it.

### 3b. Leverage the intelligence *outside* the org

Give the org the full spectrum of model capability without surrendering data.

- **A single OpenAI-compatible gateway** (`:8800`) fronts everything: open-weight models running
  on our own gateway nodes (Qwen, Gemma, image gen), and — when policy allows — cloud frontier
  models. *In place: the aggregator, multi-node routing, health, `src/lib/gateway.ts`.*
- **Leashed egress** — a request only reaches a cloud model if the routing rules permit it. The
  default is deny. `data_class = PII → block` means customer data *physically cannot* be routed
  off-box, regardless of who asks. *In place: `routing_rules`, `evaluateRouting()`, egress gate.*
- **Cost- and policy-gated** — every external call is checked against a budget and a policy before
  it leaves. *In place: FinOps virtual keys, `chat-governance.ts` budget checks.*

**The integration is the point:** the same gateway that reaches the outside world enforces the
same policies that protect the inside world, and writes to the same audit trail either way.

---

## 4. The governance spine (why regulated buyers choose us)

Between the two intelligence flows sits a governance spine that every request passes through. This
is the consolidation of what the market sells as five separate products:

- **Policy** — attribute-based access + policy-as-code (first-party ABAC, or OPA/Rego swap-in).
  Deny-by-default.
- **Guardrails / PII** — every prompt scanned before it moves; a regex floor that is always on,
  with Presidio for entity-grade detection and masking. A failure degrades safely, never opens.
- **Identity & access** — Keycloak/OIDC, one identity model across every module.
- **Secrets** — OpenBao KMS (or env fallback) for connector creds and signing keys.
- **Audit** — a tamper-evident ledger: every completion records model, tokens, whether data left
  the box, which guardrails fired with what verdict, latency, and the cost key. This is the
  artifact a regulator reads.
- **Evals & drift** — golden-set regression tests and LLM-as-judge scoring gate quality; drift
  detection flags when a model or its inputs move. Evidence, not vibes.
- **Lineage & provenance** — OpenLineage (Marquez) traces source→answer; HMAC/Sigstore/C2PA sign
  answers and exported reports so they are verifiable after the fact.
- **Regulatory reporting** — governance registry (DPO attestations, impact assessments, RACI,
  vendor reviews) and one-click compliance exports with citations.

Every one of these exists in code today behind a clean adapter seam (see the inventory in
[`OSS_SERVICES_MATRIX.md`](./OSS_SERVICES_MATRIX.md)). The work ahead is depth and consolidation —
turning capabilities into surfaces an officer can actually operate — not green-field building.

---

## 5. The landscape — and where we win

The AI-infrastructure market in 2026 is consolidating, and the direction of consolidation is our
thesis being proven by other people's M&A.

### The signal that matters most

**Palo Alto Networks acquired Portkey** (announced Apr 30 2026, closed May 29 2026, ~$120–140M) to
serve as the **core AI gateway inside Prisma AIRS, its AI *security* platform**
([Palo Alto press](https://www.paloaltonetworks.com/company/press/2026/palo-alto-networks-completes-acquisition-of-portkey-to-secure-ai-agents),
[The New Stack](https://thenewstack.io/palo-alto-portkey-ai-gateway/)). Read that again: a gateway
company was bought by a security company to become a *governance* control plane. The market is
saying, with a nine-figure cheque, that **the gateway and the governance layer are one product.**
That is exactly what Off Grid is — except we are built that way from the start and we run
on-premise, where their SaaS cannot follow.

Similarly, **Cisco acquired Robust Intelligence** and **Palo Alto acquired Protect AI** — the
governance/security layer is being rolled up into the platforms. The point tools are becoming
features. We ship the platform.

### The category is otherwise a pile of point tools

| Category | Representative players | What they do | Where they stop |
|---|---|---|---|
| **AI gateway** | Portkey (→Palo Alto), LiteLLM, Kong AI Gateway, Cloudflare AI Gateway, TrueFoundry | Route/fallback/cache model calls, key mgmt, basic cost + observability | Mostly SaaS or a thin proxy; governance is shallow; no internal-knowledge layer |
| **Eval & observability** | Maxim AI, Langfuse, Braintrust, LangSmith, Arize | Trace, test, score LLM/agent behavior | Point tool; self-host exists but it's *one* slice; no gateway, no data plane, no compliance registry |
| **AI governance** | Credo AI, Holistic AI, Robust Intelligence (→Cisco), Fiddler | Model risk, policy, compliance mapping | Governance *about* AI, detached from the runtime that enforces it; SaaS |
| **Enterprise knowledge** | Glean, Credal, Vectara, Dust | Permissions-aware RAG over internal SaaS data | SaaS; your data is indexed in *their* cloud; no model gateway, no governance spine |

Each of these is a real, funded company solving one slice. **No one owns all four slices in one
product, on the customer's own hardware.** LangSmith and Braintrust offer self-hosting for *their
slice*; Glean is permissions-aware but *in their cloud*; Portkey is now a security vendor's SaaS
gateway. The convergence is happening — through acquisition, bolted together after the fact.

### Our moat

1. **Integration, not assembly.** Anyone can `docker pull` Langfuse, Presidio, OPA, Qdrant. The
   moat is that in Off Grid they are *one product* — shared identity, shared audit, shared policy,
   a single UX an operator learns once. The value is in the seams, and the seams are the hard part.
2. **On-premise / sovereign by construction.** For regulated BFSI, "your data never leaves the
   box" is not a preference, it is the buying criterion. Most competitors are SaaS and structurally
   cannot offer true on-prem or air-gap. We are on-prem first; cloud is the exception we gate, not
   the default we assume ([sovereign-AI context](https://www.truefoundry.com/blog/air-gapped-ai-deploying-enterprise-llms-in-highly-regulated-industries)).
3. **The application / use-case layer.** We do not stop at plumbing. Agents, Studio, project-scoped
   knowledge, and the API turn the governed platform into shipped BFSI use-cases (FNOL, KYC,
   claims triage). The plumbing is table stakes; the outcomes are the product.
4. **Open core, no lock-in.** AGPL + adapter seams mean a customer can inspect, self-host, and
   swap any backend. Trust through verifiability — the same principle as the consumer products.

---

## 6. What "winning" looks like

- A compliance officer at a mid-market Indian insurer runs a quarter's worth of AI activity —
  every prompt, every model, every PII hit, every cloud-egress decision, every eval score — into a
  single signed report, and hands it to their regulator without a caveat.
- A developer at the same firm ships a claims-triage agent that reads the core-banking system and
  the policy documents, answers with citations, and *cannot* leak a customer's data to a cloud
  model because the routing rule forbids it — and they built it in a day on our API.
- The platform owner adds a new open-weight model to the fleet, sets a budget, and every team's
  usage shows up attributed and costed the next morning — no new vendor, no new contract.

All three sit at the same console. That is an intelligent enterprise: its own knowledge, the
world's models, its own governance, one surface.

---

## 7. Consequences for how we build

This vision sets the priorities the roadmap executes against:

1. **Consolidate, don't proliferate.** Six thin observability/analytics/finops/reports/siem/drift
   tiles are one job — "is my AI healthy, safe, and what is it costing." Build the *job*, not the
   tiles. Same for the governance surfaces.
2. **Every module is a real management surface.** Read-only is the bare minimum and not done. The
   cross-cutting CRUD mandate in the roadmap is a direct consequence of this vision: an operator
   must be able to *run* the system, not just watch it.
3. **Wire the capabilities we already have.** Several backends (connectors CRUD+sync, adapters) are
   built but not fully surfaced. Connecting existing capability to a usable surface beats new
   green-field work.
4. **Give the console a home.** An operator should land on a jobs-oriented overview — health,
   governance posture, cost, recent activity, quick actions — not a flat list of 39 modules.
5. **Prove the two flows end-to-end.** The clearest demonstration of the whole thesis is one
   internal-data question answered with citations, under policy, with the cloud-egress decision
   visible in the audit trail. That story is the product.

---

## The data plane — reaching the intelligence *inside* the org (LIVE 2026-07-08)

The thesis names two intelligences: outside (models) and **inside (the org's own data)**. The data
plane is how we reach the inside one — and the bet is that the **entire AWS data stack can be matched
by governed open source**, on the enterprise's own hardware, so their data never leaves the perimeter:
Glue → Airbyte, Athena → ClickHouse SQL, DMS/CDC → Debezium, Redshift → ClickHouse, Kinesis → Redpanda,
DataBrew → Great Expectations, S3 → SeaweedFS, plus Parquet. Full map: [`platform/DATA_PLANE_PARITY.md`](./platform/DATA_PLANE_PARITY.md).

Why it wins where point tools and the cloud stack don't:
- **One governed control plane over best-of-breed OSS** — a data sync is a *pipeline*, governed by the
  same spine as a model call: **PII redaction on the movement path**, classification-driven masking,
  data-allowlist ceiling, data-quality gate, lineage + audit, replay. Not a separate ungoverned ETL tool.
- **Works with the systems they already run, as-is** — connector breadth + CDC pull from the databases,
  warehouses, and SaaS an enterprise already has; they change nothing. This is what makes population-scale
  adoption feasible: we meet each enterprise where it is.
- **Sovereign + no lock-in** — every engine on their hardware; permissive OSS; the moat is ownership,
  air-gap, and the governance spine, not proprietary formats or a SaaS dependency.

Consumed by the console via ports-and-adapters and seeded with a 600k-row BFSI dataset. The remaining
leap is the **plain-language builder** so non-technical staff author these governed pipelines themselves —
the empowerment that turns "we have a data platform" into "everyone is intelligent."

Deployment topology is not owned by this strategy document. Node addresses, service placement, fleet
membership, and cluster membership are runtime registry data; console routes and product documents must
not hard-code them. The authoritative deployment configuration, recovery automation, and current health
records live in the private
[`off-grid-ai/onprem-fleet-orchestration`](https://github.com/off-grid-ai/onprem-fleet-orchestration)
repository.

---

*Sources for the competitive analysis: Palo Alto Networks press releases and The New Stack (Portkey
acquisition); Braintrust/Latitude/Product Leaders Day comparisons (eval landscape); TrueFoundry,
Lyzr, PredictionGuard (sovereign/air-gapped AI); Glean and Credal (enterprise knowledge). Captured
2026-07-04.*
