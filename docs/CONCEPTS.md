# Concepts — what each control is, who owns it, how to set it up, and why

The console is dense because it spans five planes. This is the orientation: for **each surface**,
what it is, **who** configures it, **how** to set it up, and **why** it exists. Pair with the
inline hints in the UI and the step-by-step recipes in **How-tos**.

> Roles referenced: **Platform admin** (runs the console/infra), **Compliance/DPO** (governance,
> regulatory), **Security** (egress, guardrails, incidents), **FinOps owner** (cost, budgets),
> **Team/Project lead** (their keys + usage). RBAC roles: `admin`, `compliance`, `viewer`.

---

## Control plane

### Policy (`/control` → Policy)

- **What:** the org-wide rule set every enrolled node enforces — cloud-egress switch, guardrails to
  run, and the allowed-model list. Versioned + append-only.
- **Who:** Security / Platform admin.
- **How to set up:** toggle **Egress to cloud**; add **Guardrails** (`pii-input`, `injection-scan`,
  `grounding`) as chips; add **Allowed models**; **Publish** → bumps the version. Nodes converge on
  their next poll (≤60s).
- **Why:** the gateway is the single chokepoint; this is the policy it enforces, so security is set
  once centrally instead of per-agent.

### Model routing (`/control` → Model routing)

- **What:** conditional + smart routing rules — `if <attribute> <op> <value> → local | cloud |
block` (+ model + fallback), evaluated by priority; first match wins.
- **Who:** Security / Platform admin.
- **How to set up:** Add rule (e.g. `data_class eq pii → local`, `region eq in → local`,
  `task eq longcontext → cloud`). Use the **tester** to dry-run attributes.
- **Why:** keeps sensitive/regulated traffic on-device and routes the rest by cost/latency/region.
  A `cloud` decision is leashed to `block` when egress is off.

### RBAC — Users & roles

- **What:** console users mapped to `admin` / `compliance` / `viewer`.
- **Who:** Platform admin.
- **Why:** least-privilege access to the console itself.

### ABAC (`/admin` → ABAC policy)

- **What:** attribute-based, **deny-overrides** access rules (`role`, `attribute`, `resource`,
  `effect`) for finer control than RBAC (e.g. "viewers can't touch PII datasets").
- **Who:** Security / Compliance.
- **Why:** purpose- and data-class-aware authorization a flat role can't express.

### Audit log

- **What:** append-only record of every gateway call (model, tokens, latency, outcome, checks,
  key→user/project, leftDevice). The source of truth; exported to OTel/SIEM.
- **Who:** read by everyone; owned by Compliance/Security. **Read-only by design.**

---

## AI plane

### Brain + ingestion (`/brain`)

- **What:** the knowledge layer — ingest text/file/image/dataset → chunk → embed → index with
  provenance; retrieve with citations.
- **Who:** Platform admin / knowledge owner.
- **How:** Brain → **Ingest** (pick a kind). Images are captioned by the gateway.
- **Why:** grounded answers need a cited, on-device knowledge base.

### Retrieval router

- **What:** detects a query's intent and routes to KB / database / tool, fuses results with
  provenance.
- **Why:** the Brain is one source; the router is the spine that picks the right one.

### Tools & services

- **What:** the registry of HTTP/MCP tools the router can invoke (name, endpoint, "when to use").
- **Who:** Platform admin.
- **Why:** lets agents act, not just answer — scoped + intent-matched.

### Grounding & evals

- **What:** grounding verifies each claim against its cited source (score); evals run a golden set
  against the Brain (recall).
- **Who:** Platform admin / QA.
- **Why:** quantifies "is the answer actually supported" and "is retrieval still good."

### Agents (`/agents`)

- **What:** pre-built use cases; each run is traced (plan→retrieve→handoff→ground→answer) with
  provenance + citations.
- **Why:** the consumption surface, fully auditable.

---

## FinOps plane (`/finops`)

- **What:** virtual keys (token issuance) scoped to a user/project with budgets; cost metered from
  the audit log by model/key/person/project; on-device share.
- **Who:** FinOps owner; team leads hold their keys.
- **How:** Issue key → scope + budget → copy token once. Revoke = toggle off.
- **Why:** chargeback, budget enforcement, and proving the local-model cost dividend.

---

## Regulatory plane (`/regulatory`, `/reports`)

- **What:** compliance posture + framework coverage (DPDP/EU AI Act/ISO 42001/GDPR/NIST/HIPAA/DORA/
  OCC), the **governance registry** (policies/committees/RACI/training/vendor/drills as tracked
  records), and **regulator response packs** (IRDAI/RBI/SEBI/DPDP/CERT-In).
- **Who:** Compliance / DPO.
- **How:** add governance items with owners; generate a regulator pack on demand.
- **Why:** answer a regulator with live, status-honest evidence — not a slide deck. Note: the
  registry **tracks** the process; humans still execute the committee/training/drills.

---

## Integrations (`/admin` → Integrations · adapters, Embedded consoles)

- **What:** every capability's active adapter + the OSS it can swap to, health-probed; rich OSS UIs
  as SSO'd embeds.
- **Who:** Platform admin.
- **How:** `OFFGRID_ADAPTER_<CAP>=<id>` + bring up the service (`deploy/`). See Runbooks RB-7.
- **Why:** first-party defaults work out of the box; swap to best-of-breed OSS without code changes.

---

## Fleet / nodes (`/fleet`)

- **What:** enrolled devices, policy version, kill switch.
- **Who:** Platform admin / Security.
- **How:** issue an enrollment token → the desktop node enrolls (Settings → Fleet Console).
- **Why:** every node pulls policy + reports audit, closing the loop from device to control plane.

## The interaction pipeline

- **What:** one ordered chain every agent run flows through — policy gate → guardrails(in) →
  retrieve → answer (cached) → ground → guardrails(out) → provenance-sign → audit/lineage/trace,
  plus an async online QA score after the response.
- **Who:** Platform (automatic). **How:** `src/lib/agentrun.ts`; runs fire it via
  `/admin/agents/runs`. Safety checks on every request; the LLM-judge score runs out-of-band
  (`next/server after()`) so it adds no latency.
- **Why:** the capabilities below aren't just admin endpoints — they *fire in-path* on real work.

## Agent QA (`/handbook/agent-qa`)

- **What:** are the agents still doing a good job? Offline evals (golden / promptfoo / Ragas),
  online LLM-as-judge scoring → Langfuse, drift/degradation (PSI / Evidently).
- **Who:** Platform / ML owner. **How:** `/admin/qa/{drift,score,status,sweep}`,
  `OFFGRID_ADAPTER_{EVALS,DRIFT}`; schedule `POST /admin/qa/sweep` (200 healthy / 503 degraded).
- **Why:** catch regression and drift before a customer or regulator does.

## Provenance & tamper-evidence

- **What:** signed, offline-verifiable outputs — ed25519 detached manifests on report exports, C2PA
  Content Credentials on images, Sigstore attestation on artifacts.
- **Who:** Compliance / Security. **How:** `/admin/provenance/{verify,c2pa,sigstore}`,
  `/admin/reports/[id]/export?manifest=1`. **Why:** prove what was produced, unaltered, with a public key.

## Sandbox (agent code execution)

- **What:** agent-authored code runs in an ephemeral, network-isolated, resource-capped container.
- **Who:** Platform / Security. **How:** `OFFGRID_ADAPTER_SANDBOX=docker` + the `agent-code-exec`
  flag (default OFF); `/admin/sandbox/run`. Default no-exec refuses. **Why:** autonomy without
  handing agents your production host.

## Fleet Control (`/handbook/fleet-control`)

- **What:** device fleet management (FleetDM/osquery, MIT core) + Off Grid's field-force intelligence.
  Inventory, live queries, software + CVE visibility, and policies work today. Device CONTROL - the
  MDM commands that act on a device (lock / wipe / config-profile push / settings enforcement) - is
  coming soon (advanced MDM control is Fleet Premium, separately licensed).
- **Who:** Platform / Frontline ops. **How:** `OFFGRID_ADAPTER_MDM=fleetdm` + `make mdm`;
  `/admin/mdm/devices`. **Why:** see every AI-enabled device *and* coach the workforce on it.
