<div align="center">
  <img src="../public/logo.png" width="72" alt="Off Grid AI" />
  <h1>Off Grid AI Console — Features</h1>
  <p>Every part of running AI in a company, wired into one governed control plane.<br/>
  One gateway for every model, composable pipelines, and apps your whole team builds in plain language — on infrastructure you own.</p>
</div>

> Screenshots are from the live console running a demo bank tenant (synthetic Indian-BFSI data). Explore it read-only: **[onprem-console.getoffgridai.co](https://onprem-console.getoffgridai.co)**

---

## Control — one gateway every AI call passes through

The chokepoint that ends Shadow AI and makes everything else governable: one OpenAI-compatible endpoint to route, govern, observe, and kill every model call. Deny-overrides RBAC + ABAC decide who can use which model, data, and tool; every call, tool call, and byte of egress lands on one append-only record you can ship to your SIEM.

![The AI gateway — every model call through one governed, observable endpoint](../public/docs-shots/gateway.png)

![Policy engine — RBAC + ABAC access decisions, provably enforced](../public/docs-shots/policy.png)

![Append-only audit of every model call, tool call, and byte of egress](../public/docs-shots/audit.png)

---

## Knowledge — your content, grounded and cited

Agents answer from *your* SOPs and playbooks, not the model's guesses. A versioned knowledge base, a retrieval router that queries the right source, and grounding checks that verify each claim against its sources before it ships — with provenance on every hit.

![Org knowledge base — versioned, grounded, cited](../public/docs-shots/knowledge.png)

![Private governed chat, grounded in your knowledge with inline citations](../public/docs-shots/chat.png)

---

## Build — apps and agents in plain language

The Studio is where anyone on the team describes a workflow in plain language and gets a governed app: a five-screen lifecycle (build → input → running → review → reports), human-in-the-loop approvals, and every run bound to a pipeline so it inherits your rules.

![The Studio — business apps and agents built in plain language, each governed](../public/docs-shots/studio.png)

![The app lifecycle — build, run, review, report, all in one shell](../public/docs-shots/app-lifecycle.png)

![The review inbox — runs paused for a human decision; approve or reject and the run resumes](../public/docs-shots/app-review.png)

---

## Agent QA — proof the agents still do a good job

Automated QA that answers: are they working, and if not, which one regressed and when? Golden-set evals gate every release; an LLM-as-judge scores live traffic for quality and faithfulness and trends it over time; drift detection catches distribution shift before a customer or regulator does.

![Evaluator templates and golden sets — regression-test agents before release](../public/docs-shots/evals.png)

![Live observability — traces, metrics, and per-call cost per user, team, and project](../public/docs-shots/observability.png)

---

## Trust — tamper-evident, provable outputs

Prove what was produced, by whom, unaltered. Every report carries a detached signed manifest, offline-verifiable with only a public key; a queryable source → chunk → answer graph explains where any answer came from.

![Signed provenance — offline-verifiable manifests on every report](../public/docs-shots/provenance.png)

---

## Data — one governed source of truth

Connect enterprise systems, classify and set retention on every asset, and feed pipelines from one catalog — so the same governed data powers every app, agent, and report.

![Data connectors — enterprise systems into one governed catalog](../public/docs-shots/connectors.png)

![A composable pipeline — the governed contract every consumer runs against](../public/docs-shots/pipeline-overview.png)

---

## Regulatory — defensible to a regulator and a board

Turn the audit trail into the documents they actually ask for: DPDP / RBI / SEBI / IRDAI-aligned report packs generated from the record, a governance registry that makes model risk a board-level line item, and per-tenant isolation with on-prem residency.

![Regulatory frameworks and control catalog — audit-ready evidence](../public/docs-shots/regulatory.png)

---

## Consumption — one pane of glass, with the money in view

Where people meet the agents and you keep control: issue virtual keys with budgets, see and cap AI spend per person, team, and project, and charge it back — no surprise token bills.

![FinOps — virtual keys with budgets, per-key cost and chargeback](../public/docs-shots/finops.png)

![Usage and spend, in your currency, per team and project](../public/docs-shots/accounting.png)

---

<div align="center">
  <sub>Built on open source. Swap any underlying engine with one environment variable — never locked to a vendor.</sub>
</div>
