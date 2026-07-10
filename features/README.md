<div align="center">
  <img src="../public/logo.png" width="72" alt="Off Grid AI" />
  <h1>Off Grid AI Console — Features</h1>
  <p>Every part of running AI in a company, wired into one governed control plane.<br/>
  One gateway for every model, composable pipelines, and apps your whole team builds in plain language — on infrastructure you own.</p>
  <p><strong><a href="https://onprem-console.getoffgridai.co/docs">Take the live product tour →</a></strong> · <a href="https://onprem-console.getoffgridai.co">explore the running console</a></p>
</div>

> Screenshots are from the live console running a demo bank tenant (synthetic Indian-BFSI data).

---

## Build — apps and agents in plain language

The heart of it: anyone on the team describes what they need in plain language and gets a governed app back — no platform-team ticket, no code. Each app is a five-screen lifecycle (build → input → running → review → reports), tested in a sandbox before it touches anything real, and bound to a pipeline so it inherits every rule automatically.

- **The Studio** — one place to build both single-step agents and multi-step workflows; describe the job, get a working governed app.
- **The five-screen lifecycle** — every app carries its own build, input, run-monitor, human review, and reports surfaces.
- **Human-in-the-loop** — anything that needs a person pauses for one; they approve or reject and the run resumes on its own.
- **Composable tools** — apps call registered tools and other apps, plus primitives (web search, read-url); arbitrary action is refused by default.

![The Studio — business apps and agents built in plain language, each governed](../public/docs-shots/studio.png)

![The review inbox — runs paused for a human decision; approve or reject and the run resumes](../public/docs-shots/app-review.png)

---

## Control — one gateway every AI call passes through

The chokepoint that ends Shadow AI and makes everything else governable: one OpenAI-compatible endpoint to route, govern, observe, and halt every model call.

- **AI Gateway** — a single endpoint for every model call: one place to route, govern, observe, and kill.
- **Guardrails (PII + injection)** — every prompt is screened for sensitive data and prompt-injection before it reaches a model.
- **Policy (RBAC + ABAC)** — deny-overrides access decisions: who can use which model, data, and tool, provably enforced.
- **Identity & SSO** — Google, Microsoft, and enterprise SSO (SAML/OIDC); enterprise login with no bespoke user store.
- **Secrets management** — env by default, a hardened vault for production; no plaintext keys anywhere, rotated centrally.
- **Append-only audit + SIEM** — every model call, tool call, and byte of egress on one immutable record; ship it to your SIEM for search and dashboards.
- **Kill switch** — one control halts all AI org-wide, the switch a board signs off on.

![The AI gateway — every model call through one governed, observable endpoint](../public/docs-shots/gateway.png)

![Policy engine — RBAC + ABAC access decisions, provably enforced](../public/docs-shots/policy.png)

![Append-only audit of every model call, tool call, and byte of egress](../public/docs-shots/audit.png)

---

## Knowledge — your content, grounded and cited

Agents answer from *your* SOPs and playbooks, not the model's guesses.

- **Org knowledge base** — a versioned knowledge base over your own content; embedded on-disk, or a dedicated vector store at scale.
- **Retrieval router** — detects intent and queries the right source (knowledge base, database, or tool), with provenance on every hit.
- **Grounding & citation checks** — verifies each claim against its sources, so hallucination is caught before it ships.
- **Response cache** — exact and semantic caching cuts cost and latency on repeated prompts.
- **Model routing** — smart, conditional, geo-aware routing across models, with a cloud leash you control.

![Org knowledge base — versioned, grounded, cited](../public/docs-shots/knowledge.png)

![Private governed chat, grounded in your knowledge with inline citations](../public/docs-shots/chat.png)

---

## Agent QA — proof the agents still do a good job

Automated QA that answers: are they working, and if not, which one regressed and when?

- **Offline evals** — golden-set recall plus assertion matrices and retrieval metrics; regression-test agents before release.
- **Online scoring** — a model-as-judge scores live traffic for quality and faithfulness and trends it over time; a falling score is your alarm.
- **Drift & degradation** — population-stability and test suites detect distribution shift and quality decay.
- **Live observability** — traces, metrics, and per-call cost per user, team, and project.

![Evaluator templates and golden sets — regression-test agents before release](../public/docs-shots/evals.png)

![Live observability — traces, metrics, and per-call cost per user, team, and project](../public/docs-shots/observability.png)

---

## Trust — tamper-evident, provable outputs

Prove what was produced, by whom, unaltered.

- **Signed exports** — every report carries a detached ed25519 manifest, offline-verifiable with only a public key.
- **C2PA content credentials** — industry-standard signed manifests embedded in generated images.
- **Sigstore attestation** — keyless signing of artifacts with a public transparency-log trail.
- **Data lineage** — a queryable source → chunk → answer graph explains where any answer came from.

![Signed provenance — offline-verifiable manifests on every report](../public/docs-shots/provenance.png)

---

## Autonomy — run agents safely and durably

The substrate for agents that act, not just answer.

- **Sandboxed code execution** — agent-authored code runs in an ephemeral, network-isolated, resource-capped container; off by default, gated by policy.
- **Durable workflows** — multi-step agents survive a crash and resume, the floor for trusting autonomy.
- **Tool registry** — agents call only registered, scoped tools; arbitrary action is refused by default.
- **Feature flags** — toggle modules and capabilities per tenant or environment, with instant rollback.

![The app lifecycle — durable runs you can monitor, pause, and resume](../public/docs-shots/app-lifecycle.png)

---

## Regulatory — defensible to a regulator and a board

Turn the audit trail into the documents they actually ask for.

- **Report packs** — DPDP / RBI / SEBI / IRDAI-aligned packs generated from the audit record.
- **Governance registry & DPIA** — model risk becomes a tracked, board-level line item.
- **Multi-tenant + data residency** — per-tenant isolation and on-prem deployment keep data where the law requires.

![Regulatory frameworks and control catalog — audit-ready evidence](../public/docs-shots/regulatory.png)

---

## Consumption — one pane of glass, with the money in view

Where people meet the agents and you keep control.

- **FinOps + virtual keys** — issue keys with budgets; per-user and per-project cost and chargeback, no surprise token bills.
- **BI / data exploration** — explore usage and data in built-in dashboards, without exporting it.
- **Agents & reports** — pre-built use cases (claims/FNOL, KYC, SOP synthesis) ready to run and govern.
- **Fleet control** *(coming soon)* — provision, govern, and observe every AI-enabled device from one console; agent-enrolled inventory works today, full device control is coming.

![FinOps — virtual keys with budgets, per-key cost and chargeback](../public/docs-shots/finops.png)

![Usage and spend, in your currency, per team and project](../public/docs-shots/accounting.png)

---

<div align="center">
  <p><strong><a href="https://onprem-console.getoffgridai.co/docs">See it live — the full product tour, screen by screen →</a></strong></p>
  <sub>Built on open source. Swap any underlying engine with one environment variable — never locked to a vendor.</sub>
</div>
