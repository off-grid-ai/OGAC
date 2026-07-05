# Console demo walkthrough + gap audit

Per-page reference for building the prospect demo. For each screen: what it is, when to use it, how
to use it, the benefit to show, and its **current state** (verified live against the server on
2026-07-05, admin-token probes). `[SCREENSHOT: /route]` marks where a screen capture goes — capture
these in the browser (I can't from here).

**Legend for state:** 🟢 demo-ready (real, rich data) · 🟡 works but thin/limited · 🔴 empty or
integration not wired (fix before demoing).

---

## Demo-readiness summary

**🟢 Lead the demo with these — real data, tells the story:**
Overview, Chat, Image generation (in Chat), Knowledge/RAG, Agents (+ run trace), Agent runs,
Studio, Analytics (722 requests / 905k tokens / p50-p95), FinOps ($1.81, 100% local — the on-prem
dividend), Evals (86% pass, 22 cases), Provenance (7 signed records), Integrations (6 connectors
connected), Gateway (4 models incl. vision + image), Fleet (9 nodes), Access (machine clients),
Reports, Prompts, Docs site.

**🟡 Usable but thin — show briefly or populate first:**
Guardrails (regex floor only — Presidio not wired), Drift (stable, but no feature signals yet),
Retrieval (LanceDB works; Qdrant inspector empty), Secrets (env adapter, no keys — OpenBao not
wired), Backups (status only, schedule not controllable), Observability (Langfuse up on g6; confirm
traces are flowing).

**🔴 Empty / not wired — DON'T demo until fixed (see punch list):**
Policy → Model routing (0 rules), Lineage (Marquez not configured), Security events / SIEM
(OpenSearch not configured).

### Punch list before the demo
1. **Routing rules** — add 2-3 demo rules on Control (e.g. \`data_class=PII → block\`, \`bulk →
   local\`) so the egress-leash story is visible, not empty. HIGH value, easy.
2. **SIEM/OpenSearch** — wire \`OFFGRID_OPENSEARCH_URL\` (is OpenSearch on g6 now?) so Security
   Events + audit search show data; else avoid that page.
3. **Lineage/Marquez** — set \`OFFGRID_MARQUEZ_URL\` if Marquez is on g6; else avoid Lineage.
4. **Presidio** — set \`OFFGRID_PRESIDIO_URL\`/\`_ANONYMIZER_URL\` (on g6?) so Guardrails shows
   entity-grade masking, not just regex. Nice-to-have.
5. **Seed a little demo content** — a couple of knowledge docs and one Studio assistant so Chat
   grounding + Studio have something real to show.

---

## Home

### Overview  \`/overview\`  🟢
[SCREENSHOT: /overview]
- **What:** the operator landing — governance posture, cost, traffic/health, service health, recent
  activity, quick actions.
- **When:** open here to frame the whole platform in one glance.
- **How:** each tile deep-links into its module; quick actions jump to chat/policy/knowledge/report.
- **Benefit:** "one surface, everything at a glance" — the integrated-platform pitch in one screen.
- **State:** real (reads analytics, finops, policy, services, recent runs). Cloud egress shows
  fully-on-prem.

## Workspace

### Chat  \`/chat\`  🟢 — the centerpiece
[SCREENSHOT: /chat]
- **What:** private ChatGPT, answered on-prem. Models, projects, knowledge grounding, skills.
- **When:** the opening act — "your own ChatGPT, nothing leaves the network."
- **How:** pick a model (qwythos-9b, gemma-4-e4b, qwen3-vl-8b vision), ask; toggle grounding to cite
  uploaded docs; \`/\` for skills; drag/paste images.
- **Benefit:** capable private chat, no per-seat cost, no data egress.
- **State:** live. 4 models available. Footer proves on-prem.

### Image generation (in Chat)  🟢
[SCREENSHOT: /chat with an image model selected]
- **What:** pick the \`juggernaut-xl-v9 (image)\` model → composer generates images inline.
- **How:** select the image model, describe the image, send; it renders in-thread + saves to Storage.
- **Benefit:** on-prem image gen, same private surface. Strong visual demo moment.
- **State:** live (verified end-to-end).

### Projects  \`/projects\`  🟢 — group chats + a shared knowledgebase per topic. Real.
### Artifacts  \`/artifacts\`  🟢 — saved generated outputs; edit-in-place + version revert.
### Prompts  \`/prompts\`  🟢 — reusable prompt library (e.g. kyc-verify seeded).
### Knowledge  \`/knowledge\`  🟢 — upload docs → grounded, cited answers. Seed 1-2 docs for the demo.
### Storage  \`/storage\`  🟢 — the single object store; image/video previews, folders.
### Studio  \`/studio\`  🟢 — describe an assistant in plain language → suggested setup → try → publish.

## Intelligence

### Agents  \`/agents\`  🟢
[SCREENSHOT: /agents and an agent detail /agents/<id>]
- **What:** create agents from plain language, grant tools, run through the governed pipeline.
- **How:** create → grant tools → open → Run; watch policy/guard/retrieve/answer/ground steps inline.
- **Benefit:** "an agent that acts, fully governed." The run-trace is a killer governance visual.
- **State:** live. sop-synth + built-ins present.

### Agent runs  \`/agent-runs\`  🟢 — 8 runs (7 done, 1 blocked); step rollup. Shows the pipeline history.
### Brain  \`/brain\`  🟢 — the SOP knowledge base (add/search/delete docs).
### Evals  \`/evals\`  🟢 — 3 runs, 22 cases, 86% pass. Great "prove it works" screen.
### Sandbox  \`/sandbox\`  🟡 — code-exec, gated off by default; shows the gate honestly.

## Gateway & Fleet

### AI Gateway  \`/gateway\`  🟢 — 4 models, per-node view. (Fixed the earlier render crash.)
### Fleet  \`/fleet\`  🟢 — 9 nodes with roles/models; edit + push-to-node (SSOT).
### Services  \`/services\`  🟢 — directory of every service + live health.

## Data

### Integrations  \`/integrations\`  🟢 — 6 connectors CONNECTED (Postgres/MySQL/MSSQL/Kafka/S3/CRM),
edit/sync/history. Real enterprise data — strong "harness your data" moment.
### Data  \`/data\`  🟢 — datasets + ingest.
### Retrieval  \`/retrieval\`  🟡 — LanceDB active + works; Qdrant inspector empty (Qdrant not default).
### Lineage  \`/lineage\`  🔴 — Marquez not configured → empty graph. Fix env or skip.

## Governance

### Control  \`/control\`  🟡 — policy history, egress state, routing, RBAC, secrets, audit search.
**Routing has 0 rules** — add demo rules so the egress-leash story shows. Audit search needs OpenSearch.
### Policy  \`/policy\`  🟢 — ABAC rules CRUD. Add a couple demo rules.
### Guardrails  \`/guardrails\`  🟡 — regex floor active (Presidio not wired). Test box works; add
Presidio env for entity-grade masking.
### Access  \`/access\`  🟢 — users, roles, machine clients (real clients present). SSO story.
### Secrets  \`/secrets\`  🟡 — env adapter, no keys (OpenBao not wired). Write-only surface works.
### Regulatory  \`/regulatory\`  🟢 — governance registry + compliance export.
### Provenance  \`/provenance\`  🟢 — 7 signed records (Ed25519). Verify a signed run — strong trust visual.

## Insights

### Analytics  \`/analytics\`  🟢 — 722 requests, 905k tokens, p50/p95 latency, outcomes. Rich.
### FinOps  \`/finops\`  🟢 — $1.81 total, **100% local share** (the on-prem dividend). Compelling cost story.
### Observability  \`/observability\`  🟡 — Langfuse up on g6; confirm traces render before demoing.
### Drift  \`/drift\`  🟡 — engine stable, no feature signals yet; thresholds/baseline manageable.
### Security events (SIEM)  \`/siem\`  🔴 — OpenSearch not configured → empty. Fix env or skip.

## Operations

### Backups  \`/backups\`  🟡 — status view; schedule not controllable here yet.
### Configuration  \`/config\`  🟢 — env settings + feature-flag management (flags present, gate-open on).
### API docs & playground  \`/api-docs\`  🟢 — API catalog + multi-service spec browser.
### Admin  \`/admin\`  🟢 — tenant/admin surface.

## Documentation

### Docs site  \`/docs\`  🟢 — comprehensive product docs (What is Off Grid, quickstart, concepts,
per-capability guides, integrations, API with code samples, self-hosting) + interactive API ref at
\`/docs/api\`. Public. Search, TOC, prev/next, code-copy. Good for "and it's all documented."

---

## Integration wiring status (what's actually connected)

| Service | Wired? | Backs |
|---|---|---|
| Gateway aggregator (:8800) | 🟢 | Chat, agents, image, embeddings |
| Data connectors (6) | 🟢 | Integrations, Data, Knowledge |
| LanceDB | 🟢 (default) | Retrieval, Brain |
| Analytics/FinOps (audit log) | 🟢 | Analytics, FinOps |
| Provenance (Ed25519) | 🟢 | Provenance |
| Keycloak | 🟢 | Access, auth |
| Langfuse (g6 :8931) | 🟡 confirm traces | Observability |
| Unleash (g6 :8932) | 🟢 | Config/flags |
| Superset (g6 :8933) | 🟡 | Analytics embed |
| FleetDM (g6 :8934) | 🟡 | Fleet (MDM) |
| Qdrant (:6333) | 🟡 not default | Retrieval inspector |
| OpenSearch | 🔴 not configured | SIEM, audit search |
| Marquez | 🔴 not configured | Lineage |
| OpenBao | 🔴 not configured | Secrets |
| Presidio | 🔴 not configured | Guardrails (entity-grade) |
| Temporal | 🟡 adapter scaffold | Durable agent runs |

## Next iteration (from this audit)
1. Close the 🔴s that are quick env wiring (OpenSearch, Marquez, Presidio, OpenBao) IF those services
   are running on g6 — check and set the console env, else leave them out of the demo.
2. Seed demo content: routing rules, a couple knowledge docs, one Studio assistant, maybe a masking
   rule — so the governance + grounding screens aren't empty.
3. Per-page depth pass: each page verified to have enough on it to narrate (this doc is the checklist).
4. Capture the `[SCREENSHOT]` set for the demo script.
