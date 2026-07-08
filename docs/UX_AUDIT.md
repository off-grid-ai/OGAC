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
| Surface | V | Class | Highest-value fix |
|---|---|---|---|
| /overview | A | consumer | Keep; thin "blocking decisions" labels |
| /chat | A− | consumer | Doesn't show WHICH pipeline governs the turn — add a bound-pipeline chip |
| /knowledge | B | library | list→detail gap: rows open a Sheet, not the existing `/knowledge/[id]` |
| /storage | A− | consumer | Reference-quality; add "New folder" |
| /prompts | B+ | library | No `/prompts/[id]` detail/version view |
| /projects | B | consumer | Real CRUD but garbage seed ("OPOP/asasd"); bind-pipeline invisible |
| /artifacts | C | consumer | Empty — seed one so actions are demonstrable |

## B — Build
| Surface | V | Class | Highest-value fix |
|---|---|---|---|
| /studio (+/apps/[id]) | A− | consumer | Show "Runs on: <pipeline>"; New-app pick pipeline |
| /pipelines | A | reference | none |
| /brain | B− | lens | Landing tab = bare input on empty page; no router CRUD |
| /agents | C(dup) | consumer | Renders IDENTICAL Studio shell — no distinct agents list |
| /agents/[id] | B+ | consumer | Says "governed pipeline" generically — name/link it |
| /tools | B | library | Scope invisible — which pipelines/agents may call a tool |
| /evals | C | library | **Leaks ragas/deepeval/presidio**; not pipeline-scopable |
| /sandbox | B− | standalone | **Leaks "E2B/Firecracker"** |

## C — Gateway & Fleet
| Surface | V | Class | Highest-value fix |
|---|---|---|---|
| /services | B | standalone | Read-only tiles — no per-service actions/drill-through |
| /gateway (aggregator) | A− | library | Confirm tabs URL-driven |
| /gateways (+detail) | A | library | Reference; add "attach pipeline" CTA (0 bound) |
| /fleet (+list) | A | consumer | Strong; row→detail + node actions work |
| /fleet/[id] | B | consumer | Policy shown read-only — add per-device reassign |
| /edge | B | standalone | Designed but read-only — add WAF toggle/rule edit |
| PolicyEditor (`/control`) | **D** | library | **Guardrails+models free-text accept ANY garbage** |

## D — Data
| Surface | V | Class | Highest-value fix |
|---|---|---|---|
| /data (+connector detail) | A−/A | library | Add "referenced by pipelines" panel |
| /integrations | B | library | Verify "Add" opens real cred form (not stub) |
| /data-domains (+detail) | A | library | Reference; add reverse "referenced by pipelines" |
| /retrieval | B+ | standalone | Config-only; label clearly |
| /lineage | B | consumer-lens | **Leaks "Marquez/OpenLineage"**; no per-pipeline filter |

## E — Governance
| Surface | V | Class | Highest-value fix |
|---|---|---|---|
| /control PolicyEditor | **D** | library | **Free-text garbage → constrain to catalogs** |
| /control routing | B | library | Frame as org-default every pipeline inherits + link |
| /policy | C | library | Empty + **leaks OPA/Rego**; wire to inherited policy |
| /access (+[id]) | B/A− | standalone | Full-width; "via Keycloak" leak; raw role IDs |
| /guardrails | C/D | library | **Enable has no scope** + **leaks Presidio** |
| /secrets | B | standalone | **Leaks "OpenBao"** |
| /regulatory | A | prove | none |
| /provenance | B | prove | Read-only — add verify/rotate action + full-width |

## F — Insights + Operations
| Surface | V | Class | Highest-value fix |
|---|---|---|---|
| /observability | B | roll-up | No pipeline filter — add selector |
| /analytics | C | roll-up | **All zeros** — data not wired (vs /accounting real) |
| /drift | A | library+lens | **Leaks "Evidently"** |
| /finops | A | library | Reference (virtual-key CRUD) |
| /accounting | A | roll-up | Add per-pipeline column |
| /reports | B | library | No per-pipeline scope; verify Run generates |
| /siem | A− | roll-up | Events pipeline-tagged but no pipeline filter |
| /audit | A− | roll-up | Same — no pipeline dimension |
| /admin, /config, /backups | A | standalone | Reference-quality, actionable — leave |
| /api-docs | B | standalone | **Heavy OSS-name leak (10+ engines)** |

---

## Synthesis — the right thing to do

**Verdict:** the console is in far better shape than a piecemeal glance suggested. ~60% of surfaces are
A/B and several are reference-quality (pipelines, gateways, /apps[id], storage, data-domains, finops,
accounting, siem, audit, admin, config, backups, regulatory). The problems are **systemic and
cross-cutting**, not per-page — which is good: they're a handful of sweeps, not 40 rewrites.

### The 4 themes (each is one coordinated pass, not scattered fixes)

**T1 — Honesty sweep: purge OSS-engine names (P0, mechanical, brand-critical).**
Leaks on **8+ surfaces**: /evals (ragas·deepeval·presidio), /sandbox (E2B·Firecracker), /policy (OPA·
Rego), /guardrails (Presidio), /secrets (OpenBao), /access (Keycloak), /lineage (Marquez·OpenLineage),
/drift (Evidently), /api-docs (10+). Violates the standing "never expose the engine" rule. One sweep →
outcome/capability labels (PII engine, secrets store, policy engine, identity provider, lineage,
vectors, BI, workflows). Keep adapter internals admin-only, never in titles/facets.

**T2 — The pipeline join-key, made VISIBLE everywhere (P1, THE crux — this is what the founder is
really asking for).** Pipelines are the product; right now the binding is invisible outside the pipeline
pages themselves. Make it legible in both directions across the whole console:
- **Consumers name their pipeline:** chat + projects + apps + agents show **"Runs on: <pipeline>"** (link
  to `/pipelines/[id]`); New-app/agent + project settings require choosing it. (Binding already exists —
  this surfaces it.)
- **Global roll-ups filter/group by pipeline:** Observability, Analytics, SIEM, Audit, FinOps, Accounting,
  Reports get a **pipeline facet + "view this pipeline's slice" deep-link**. Events are ALREADY
  pipeline-tagged (`pipeline_*` actions) — the dimension just isn't exposed. Depends on **PA-12** (tag
  traces/eval_runs at source) so the per-pipeline lenses populate with real data.
- **Libraries show "used by N pipelines":** /guardrails, /policy, /tools, /evals, and the data layer
  (/data-domains, connectors → **"referenced by pipelines"**) — so org substrate reads as "what pipelines
  allowlist FROM," legible from both ends.
- **Global governance framed as org-default → pipeline-override:** /control, /policy, /guardrails say
  "org default; N pipelines inherit; view per-pipeline overrides." (Per-pipeline tabs already exist.)

**T3 — No silently-broken governance (P0/P1, correctness).**
- **PolicyEditor free-text (D)** — guardrails + allowed-models accept ANY string and publish it org-wide.
  Constrain to the real catalogs (known checks; enrolled model ids). Highest-severity defect found.
- **Guardrails "Enable" scope picker** — org-default OR a specific pipeline (founder-chosen), with a
  current-scope badge. No more scope-invisible enables.

**T4 — Surface completeness (P2, per-surface):** list→detail (Knowledge → its `[id]`; Prompts → add
detail/version); read-only→actionable (/services drill-through, /edge WAF toggle, /fleet[id] policy
reassign, /provenance verify/rotate); **de-dupe /agents from /studio** (own list); fix /analytics data
wiring; Gateway IA rename (`/gateway` hub vs `/gateways` list vs `/edge` "Network edge"); BFSI-realistic
seed for Projects + one Artifact; full-width /access + /provenance.

### Recommended execution order
1. **T1 honesty sweep** — fast, mechanical, brand-critical; unblocks any demo/open-source push. (1 agent)
2. **T3 garbage-input + guardrails-scope** — correctness; governance that lies is worse than none. (1 agent)
3. **T2 pipeline join-key** — the crux; biggest coherence win. Sequence: PA-12 tagging FIRST (so lenses
   have data) → then the consumer "Runs on" chips + roll-up pipeline facets + library "used by N" +
   data "referenced by" in a small fan-out. (PA-12 + ~3 agents)
4. **T4 completeness** — the per-surface list→detail / actionable / dedup / seed items. (rolling)

**Leave alone (the bar):** pipelines, gateways, /apps[id], storage, data-domains, connector detail,
finops, accounting, siem, audit, admin, config, backups, regulatory, /access[id]. These ARE the
reference — pull everything else up to them.
