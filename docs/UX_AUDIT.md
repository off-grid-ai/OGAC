# Full-product UI/UX audit (2026-07-08)

**Why:** Pipelines × Gateways are the crux of the product and now set the quality bar (rich, scoped,
editable, honest, full-CRUD). This audit assesses EVERY console surface against that bar and the
pipeline-centric model, then produces a prioritized "right thing to do" plan.

## The bar (what "good" looks like — the pipeline surfaces are the reference)
1. **Full management surface, not a read-only dashboard** — create / read / update / delete + the
   actions that run the thing (run, publish, mint, revoke, attach, toggle). A page that only lists =
   NOT done.
2. **Coheres with the pipeline-centric model** — governance/telemetry surfaces should read as either
   (a) a per-pipeline LENS/scope, (b) an ORG-DEFAULT library you attach FROM, or (c) a CONSUMER
   (app/agent/chat) binding a pipeline. Floating global add-ons with invisible scope = a defect.
3. **Scope is legible** — the user can always answer "what does this apply to?" (org / pipeline /
   consumer). Org-default vs pipeline-override vs locked is shown.
4. **Designed, not basic** — no bare 4-zeros stat band + one empty line. Even an empty state explains
   the lens, its dimensions, and the path to populate it. Full-width (no skinny centered column).
5. **Honest** — never fabricated metrics; empty states say what's needed. No OSS-engine names leaked.
6. **List → detail** — a collection opens a real deep-linkable detail; **URL-driven** nav; **no**
   modals for things that are "places"; **no free-text inputs that accept garbage** (constrain to
   known values).

## Verdict scale (per surface)
- **A — strong**: meets the bar; reference-quality.
- **B — solid, gaps**: works, but missing a CRUD verb / scope legibility / polish.
- **C — basic**: read-only or thin; looks unfinished (e.g. zeros band, no actions).
- **D — wrong/broken**: doesn't fit the model, accepts garbage, broken, or mislabeled scope.
- Note the single **highest-value fix** per surface + whether it's a pipeline LENS / org LIBRARY /
  consumer / standalone.

## Known inputs (already found — auditors confirm + place in context, don't re-discover)
- Guardrails catalog "Enable" has no scope (should be org-default OR per-pipeline) — founder chose a scope picker.
- Fleet PolicyEditor guardrails/allowed-models are free-text and accept ANY garbage.
- Pipeline **Cost / Observability / Audit / Drift** tabs look basic (thin empty stat-bands; also no run data yet — PA-12).

## Section assignments (one agent each; READ-ONLY — screenshots + assessment, NO code changes)
Each agent appends its findings table under its heading below.

- **A — Workspace**: overview, chat, knowledge, storage, projects, prompts, artifacts
- **B — Build**: studio, pipelines, brain, agents, tools, evals, sandbox
- **C — Gateway & Fleet**: services, AI-gateway (aggregator), gateways, fleet, edge
- **D — Data**: data, integrations, data-domains, retrieval, lineage
- **E — Governance**: control, policy, access, guardrails, secrets, regulatory, provenance
- **F — Insights + Operations**: observability, analytics, drift, finops, accounting, reports, siem, audit, admin, config, backups, api-docs

---

## A — Workspace

## B — Build

## C — Gateway & Fleet

## D — Data

## E — Governance

## F — Insights + Operations

---

## Synthesis — the right thing to do (orchestrator fills after all sections land)
