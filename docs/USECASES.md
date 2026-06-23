# Use cases — end-to-end scenarios

How the planes combine to solve real problems. Each scenario names the modules involved and the
exact path through the system, so you can see _why_ the architecture is shaped the way it is.

---

## UC-1 · "A regulator (IRDAI / RBI / SEBI) comes asking about our AI"

**Planes:** Regulatory · Control · Data · AI.
**Path:** Reports → pick the regulator pack → **Generate**. The pack is built live: the regulatory
**status** (what's binding vs advisory), the **questions** they'll ask + where the evidence is, live
**framework coverage**, live **controls** (audit/RBAC/masking/grounding…), the **governance registry**
(policies/committees/processes with owners), **data residency** (egress + region routing rules),
and the **model/data inventory**. Attach the framework evidence pack. Nothing is hand-assembled — it
can't drift from reality.
**Outcome:** a defensible, status-honest response in minutes, mapped to in-force obligations.

---

## UC-2 · "Sensitive data must never leave the device / the country"

**Planes:** Control (routing) · AI (gateway).
**Path:** Control → Policy → `egressAllowed = false` (master leash). Control → Model routing → add
`data_class eq pii → local` and `region eq in → local`. The router evaluates by priority; a `cloud`
action with egress off is **downgraded to block**. Rules fold into the policy bundle the node pulls,
so the gateway enforces it as the chokepoint.
**Outcome:** PII/regulated traffic provably stays local; the audit `leftDevice` flag proves it.

---

## UC-3 · "A frontline advisor asks a question and we must trust the answer"

**Planes:** AI (Brain + router + grounding + agents).
**Path:** the query hits the **retrieval router** → routes to KB/DB/tool by intent → composes an
answer via the gateway → **grounds** it (does each claim follow from a cited source?) → records an
**agent-run trace** (plan → retrieve → handoff → ground → answer) with **provenance refs + verified
citations**.
**Outcome:** every answer is traceable to its sources, with a grounding score — not a black box.

---

## UC-4 · "Control and attribute AI cost by team / project"

**Planes:** FinOps · Control.
**Path:** FinOps → **Issue key** scoped to a user/project with a monthly budget. Calls are billed to
the key; cost = tokens × model price, metered from the audit log. FinOps shows spend **by model / by
person / by project / by key** + budget bars + the **on-device share** (local = $0).
**Outcome:** chargeback-ready usage, budget enforcement, and a visible "local dividend."

---

## UC-5 · "Prove what an AI decision was based on" (audit / dispute)

**Planes:** Control (audit) · AI (traces).
**Path:** every gateway call → an append-only **audit event** (model, tokens, latency, outcome,
checks, key→user/project, leftDevice). Distributed **traces** in Jaeger; **LLM traces** in Langfuse;
the **agent-run trace** holds the step tree + citations. SIEM (OpenSearch) for full-text search.
**Outcome:** reconstruct exactly what happened for any request — metadata, findings, provenance,
cost, and the trace. (Raw content only where content-capture is enabled — see OPERATIONS §boundary.)

---

## UC-6 · "Synthesize an SOP from how top performers actually work"

**Planes:** AI (agents) · Data · Brain.
**Path:** the **SOP Synthesizer** agent reads captured/observed work, drafts a citable SOP, and the
draft is ingested into the **Brain** with provenance — then retrievable by everyone via the router.
**Outcome:** tacit know-how becomes shared, cited process.

---

## UC-7 · "We only want to buy part of it"

**Planes:** any subset.
**Path:** every capability is a port with a first-party default; modules are independently
adoptable. Buy **just grounding** (verify your own RAG, no Brain), **just the Brain**, **just FinOps**,
or the whole plane. `deploy/` profiles bring up only the OSS you licensed.
**Outcome:** à-la-carte adoption; nothing forces the whole ecosystem.

---

## UC-8 · "Scale a capability past the first-party default"

**Planes:** any.
**Path:** flip one env var — `OFFGRID_ADAPTER_SECRETS=openbao`, `…_GUARDRAILS=presidio`,
`…_POLICY=opa`, `…_IDENTITY=keycloak`, `…_RETRIEVAL=pgvector|qdrant`. Bring up the service via its
compose profile. No caller code changes; the console keeps working if it's down (falls back).
**Outcome:** start first-party, grow into best-of-breed OSS without a rewrite.

---

## UC-9 · "A node is compromised"

**Planes:** Control (fleet) · SIEM.
**Path:** Fleet → **Kill** the device (consumed on next poll) + revoke its key (FinOps) + block
egress. Pull the **CERT-In pack** and the audit/trace window for the report.
**Outcome:** isolate in seconds, report within the 6-hour CERT-In window with evidence in hand.
