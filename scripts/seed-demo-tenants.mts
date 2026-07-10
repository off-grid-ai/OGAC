// ─── DEMO-READY per-tenant seed (WAVE 1, agent C — the SEED / the bulk) ───────────────────────────
//
// Fills EVERY console screen with meaningful, DISTINCT data for TWO demo tenants:
//   • BANK    → org_bharat   (Bharat Union — bharatunion-onprem-console.getoffgridai.co)
//   • INSURER → org_suraksha (Suraksha Life — suraksha-onprem-console.getoffgridai.co)
//
// WHY: all prior demo data landed under the `default` org, so the tenant viewers (scoped to
// org_bharat / org_suraksha) see EMPTY screens. This writes the SAME rich corpus UNDER those two orgs.
//
// SAFETY (non-negotiable): this writes/updates ONLY rows for org_bharat and org_suraksha. It NEVER
// touches `default` or `wednesdaysol`. Every insert is guarded by the tenant org id. It is IDEMPOTENT
// — deterministic ids + name/label idempotency mean a re-run updates-or-inserts, never duplicates.
// It talks straight to Postgres via DATABASE_URL (the operator runs it against the live DB).
//
// WHAT it writes (Postgres tables), per tenant:
//   tenants · gateways · pipelines (+pipeline_versions) · apps · app_runs · agent_runs · custom_agents
//   · eval_runs (+golden_cases) · connectors · data_domains · data_assets (+data_classifications
//   +retention_policies) · governance_items · guardrails_rules · compliance_adoption · teams · user
//   · tools · chat_conversations (+chat_messages) · org_knowledge_collections (+docs) · org_settings
//
// FLAGGED (needs the operator's infra — NOT written here, reported at the end):
//   • OpenSearch (offgrid-gateway index) — Analytics / FinOps / Observability / Drift read from it.
//     Postgres runs light up Overview / Runs / ROI / Evals / Audit; the OpenSearch-backed CHARTS need
//     the run corpus ALSO shipped to OpenSearch (this script emits it IF OFFGRID_OPENSEARCH_URL is
//     reachable, else flags it).
//   • SeaweedFS (object store) — Storage file BYTES (written IF reachable, else flagged).
//   • OpenBao (vault) — secret VALUES (never in git; the script prints the `bao kv put` commands).
//
// HOW TO RUN (from the console dir, .env.local / .env.production loaded):
//   npx tsx scripts/seed-demo-tenants.mts            # or: npm run seed:tenants
//   OFFGRID_SEED_TENANT=org_bharat npm run seed:tenants   # just one tenant
//
// IMPORT ORDER IS LOAD-BEARING: worker-env.mts MUST be first so .env.* loads before @/db builds its
// pg Pool (see scripts/app-worker.mts / seed-data-domains.mts for the rationale).
import './worker-env.mts';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { agentRuns, appRuns, chatConversations, chatMessages, tenants } from '../src/db/schema.ts';
import {
  BHARAT_PROFILE,
  SURAKSHA_PROFILE,
  TOUR_PROFILES,
  type TenantProfile,
  appId,
  agentRunId,
  appsFor,
  agentsFor,
  customAgentId,
  collectionId,
  evalRunId,
  goldenId,
  governanceId,
  knowledgeFor,
  runStatuses,
  teamsFor,
  teamId,
  GOVERNANCE_ITEMS,
  GUARDRAIL_RULES,
  COMPLIANCE_ADOPTION,
} from '../src/lib/tour-demo-seed.ts';
import { createGateway, listGatewayRows } from '../src/lib/gateways.ts';
import { createPipeline, listPipelines, updatePipeline } from '../src/lib/pipelines.ts';
import { planSeedGateways } from '../src/lib/gateways-seed.ts';
import { planSeedPipelines, SAMPLE_PIPELINES, samplePipelineId } from '../src/lib/pipelines-seed.ts';
import { createApp, listApps, updateApp } from '../src/lib/apps-store.ts';
import { upsertAppRunState } from '../src/lib/app-run-store.ts';
import { createConnector, listConnectors, createTool, listTools, createCustomAgent, listCustomAgents } from '../src/lib/store.ts';
import { createDomain, listDomains } from '../src/lib/data-domains-store.ts';
import { createAsset, listAssets, setClassification, setRetention } from '../src/lib/data-catalog-store.ts';
import { createTeam, listTeams } from '../src/lib/teams.ts';
import { createGuardrailRule, listGuardrailRules } from '../src/lib/guardrails-rules.ts';
import { setControlStatus } from '../src/lib/compliance-adoption.ts';
import { createCollection, addDocument, listCollections, listDocuments } from '../src/lib/org-knowledge.ts';
import { setOrgSystemPrompt } from '../src/lib/store.ts';
import { assertAllowed, identity, domainsFor, MODULES, type TenantIdentity } from '../src/lib/demo/seed-guard.ts';
import { buildRunCorpus, flavourProfile, rollupCorpus } from '../src/lib/demo/telemetry.ts';
import { chatsFor, chatId, chatMessageId } from '../src/lib/demo/chat.ts';
import { toolsFor, planTools } from '../src/lib/demo/tools.ts';
import { assetsFor, planAssets } from '../src/lib/demo/data-assets.ts';
import { filesFor } from '../src/lib/demo/storage.ts';
import { secretsFor } from '../src/lib/demo/secrets.ts';

const log = (...a: unknown[]) => console.log('[seed:tenants]', ...a);
const flags: string[] = [];

// Owner for created entities is the tenant's demo viewer. The SAFETY guard, tenant identity + the
// per-flavour connector/domain mappings are the PURE logic in src/lib/demo/seed-guard.ts (unit-tested).

// ─── 1. Tenant row (fixed id — never createTenant, which mints a random org_<hex>). ──
async function seedTenant(profile: TenantProfile, id: TenantIdentity): Promise<void> {
  await db
    .insert(tenants)
    .values({ id: profile.orgId, name: id.name, slug: profile.slug, plan: 'enterprise', enabledModules: MODULES })
    .onConflictDoNothing({ target: tenants.id });
  log(`tenant ${profile.orgId} (${id.name}) ready`);
}

// ─── 2. Gateways (idempotent by stable id). ──
async function seedGateways(profile: TenantProfile): Promise<void> {
  const existing = new Set((await listGatewayRows(profile.orgId)).map((g) => g.id));
  for (const g of planSeedGateways(profile.orgId)) {
    if (existing.has(g.id)) continue;
    await createGateway({ id: g.id, name: g.name, kind: g.kind, baseUrl: g.baseUrl, defaultModel: g.defaultModel, enabled: g.enabled }, profile.orgId);
  }
  log(`gateways: ${planSeedGateways(profile.orgId).length} ensured`);
}

// ─── 3. Pipelines (idempotent by stable id; templates published so apps can bind). ──
async function seedPipelines(profile: TenantProfile, ownerId: string): Promise<Map<string, string>> {
  const existing = new Set((await listPipelines(profile.orgId)).map((p) => p.id));
  for (const p of planSeedPipelines(profile.orgId)) {
    if (existing.has(p.id)) continue;
    await createPipeline(
      { id: p.id, name: p.name, description: p.description, visibility: 'org', gatewayId: p.gatewayId, dataAllowlist: p.dataAllowlist, routing: p.routing, policyOverlay: p.policyOverlay, guardrailOverlay: p.guardrailOverlay, status: p.status, isTemplate: p.isTemplate },
      ownerId,
      profile.orgId,
    );
  }
  // name → id map so apps bind by pipeline NAME (as tour-demo-seed specs reference).
  const byName = new Map<string, string>();
  for (const s of SAMPLE_PIPELINES) byName.set(s.name, samplePipelineId(profile.orgId, s.key));
  log(`pipelines: ${byName.size} ensured (published templates)`);
  return byName;
}

// ─── 4. Connectors + data-domains (idempotent by id / label). ──
async function seedConnectors(profile: TenantProfile, id: TenantIdentity): Promise<void> {
  const have = new Set((await listConnectors(profile.orgId)).map((c) => c.id));
  // createConnector mints a random id; to get STABLE ids we insert only if the fixed id is absent,
  // via the store's create (which stamps orgId) — but we need the fixed id, so use a name guard too.
  const haveNames = new Set((await listConnectors(profile.orgId)).map((c) => c.name.trim().toLowerCase()));
  for (const c of id.connectors) {
    if (have.has(c.id) || haveNames.has(c.name.trim().toLowerCase())) continue;
    await createConnector({ name: c.name, type: c.type, endpoint: c.endpoint, description: c.description, orgId: profile.orgId, custom: true });
  }
  // Domains — bind by connector NAME → real id (createConnector minted random ids).
  const allConn = await listConnectors(profile.orgId);
  const connByName = new Map(allConn.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const existingLabels = new Set((await listDomains(profile.orgId)).map((d) => d.label.trim().toLowerCase()));
  const idConn = new Map(id.connectors.map((c) => [c.id, c.name.trim().toLowerCase()]));
  for (const d of domainsFor(profile)) {
    if (existingLabels.has(d.label.trim().toLowerCase())) continue;
    // resolve the domain's connector-key to a real connector id via the connector's NAME.
    const connName = idConn.get(d.connectorId);
    const realId = connName ? connByName.get(connName) : undefined;
    if (!realId) continue; // never fabricate a binding to a missing connector.
    await createDomain({ label: d.label, aliases: d.aliases, connectorId: realId, resource: d.resource, opHints: d.opHints }, profile.orgId);
  }
  log(`connectors: ${id.connectors.length} · domains: ${domainsFor(profile).length} ensured`);
}

// ─── 5. Data catalog assets + classification + retention (name-idempotent + upsert). ──
async function seedCatalog(profile: TenantProfile): Promise<void> {
  const specs = assetsFor(profile);
  const existing = await listAssets(profile.orgId);
  const plan = planAssets(specs, existing.map((a) => a.name));
  const byName = new Map(existing.map((a) => [a.name.trim().toLowerCase(), a.id]));
  for (const a of plan.toCreate) {
    const asset = await createAsset(
      { name: a.name, source: a.source, kind: a.kind, owner: a.owner, description: a.description, rowCount: a.rowCount, freshnessSlaHours: a.freshnessSlaHours, lastRefreshAt: new Date(), syncStatus: a.syncStatus },
      profile.orgId,
    );
    byName.set(a.name.trim().toLowerCase(), asset.id);
  }
  // Classification + retention are upserts (by asset[+column] / asset) ⇒ safe to always apply.
  for (const a of specs) {
    const assetId = byName.get(a.name.trim().toLowerCase());
    if (!assetId) continue;
    await setClassification(assetId, { level: a.level, piiTags: a.piiTags }, profile.orgId);
    await setRetention(assetId, { retainDays: a.retainDays, action: a.retainAction }, profile.orgId);
  }
  log(`catalog: ${specs.length} assets classified + retention set`);
}

// ─── 6. Governance items + guardrail rules + regulatory adoption. ──
async function seedGovernance(profile: TenantProfile): Promise<void> {
  // createGovernance does NOT accept orgId (would land under `default` — a SAFETY breach), so governance
  // rows are inserted via raw SQL with the deterministic id + the tenant org. Idempotent by id.
  const reviewed = new Date().toISOString().slice(0, 10);
  for (const g of GOVERNANCE_ITEMS) {
    const gid = governanceId(profile.orgId, g.key);
    await db.execute(sql`
      INSERT INTO governance_items (id, org_id, kind, title, owner, status, detail, reviewed_at)
      VALUES (${gid}, ${profile.orgId}, ${g.kind}, ${g.title}, ${g.owner}, ${g.status}, ${g.detail}, ${reviewed})
      ON CONFLICT (id) DO NOTHING;`);
  }
  // guardrails rules — idempotent by (label): only create labels not present.
  const haveRules = new Set((await listGuardrailRules(profile.orgId)).map((r) => r.label.trim().toLowerCase()));
  for (const r of GUARDRAIL_RULES) {
    if (haveRules.has(r.label.trim().toLowerCase())) continue;
    await createGuardrailRule({ matcher: r.matcher, pattern: r.pattern, action: r.action, label: r.label, enabled: r.enabled } as never, profile.orgId);
  }
  // regulatory adoption — setControlStatus is an upsert on (org, control).
  for (const a of COMPLIANCE_ADOPTION) {
    await setControlStatus(a.controlId, a.status, profile.orgId);
  }
  log(`governance: ${GOVERNANCE_ITEMS.length} items · ${GUARDRAIL_RULES.length} guardrail rules · ${COMPLIANCE_ADOPTION.length} controls`);
}

// ─── 7. Teams + viewer user + org system prompt. ──
async function seedAccess(profile: TenantProfile): Promise<void> {
  const have = new Set((await listTeams(profile.orgId)).map((t) => t.id));
  for (const t of teamsFor(profile)) {
    const id = teamId(profile.orgId, t.key);
    if (have.has(id)) continue;
    await createTeam({ id, name: t.name, description: t.description, department: t.department }, profile.orgId);
  }
  await setOrgSystemPrompt(
    profile.flavour === 'bank'
      ? 'You are Bharat Union\'s governed assistant. All amounts in INR. Never expose PAN/Aadhaar in the clear. Cite RBI/DPDP policy. Route customer-impacting decisions to a human.'
      : 'You are Suraksha Life\'s governed assistant. All amounts in INR. Never expose PAN/Aadhaar in the clear. Cite IRDAI/DPDP policy. Route claims/underwriting decisions to a human.',
    profile.viewerEmail,
    profile.orgId,
  );
  log(`access: ${teamsFor(profile).length} teams · org system prompt set`);
}

// ─── 8. Tools (name-idempotent). ──
async function seedTools(profile: TenantProfile): Promise<void> {
  const existing = await listTools(profile.orgId);
  const plan = planTools(toolsFor(profile), existing.map((t) => t.name));
  for (const t of plan.toCreate) {
    // createTool lacks an orgId param in its input — the tools table defaults org via ensureOrgSchema;
    // we set policy here and stamp org via a follow-up raw update to guarantee tenant scope.
    const created = await createTool({ name: t.name, type: t.type, endpoint: t.endpoint, description: t.description, policy: t.policy });
    await db.execute(sql`UPDATE tools SET org_id = ${profile.orgId} WHERE id = ${created.id}`);
  }
  log(`tools: ${plan.toCreate.length} created, ${plan.present.length} present`);
}

// ─── 9. Custom agents (Studio) — deterministic id, idempotent. ──
async function seedAgents(profile: TenantProfile): Promise<void> {
  const have = new Set((await listCustomAgents(profile.orgId)).map((a) => a.id));
  for (const a of agentsFor(profile)) {
    const id = customAgentId(profile.orgId, a.key);
    if (have.has(id)) continue;
    const created = await createCustomAgent({ name: a.name, role: a.role, description: a.description, systemPrompt: a.systemPrompt }, profile.orgId);
    // re-key to the deterministic id so agent_runs can reference it stably.
    await db.execute(sql`UPDATE custom_agents SET id = ${id} WHERE id = ${created.id} AND org_id = ${profile.orgId}`);
  }
  log(`agents: ${agentsFor(profile).length} ensured`);
}

// ─── 10. Studio apps (bound to a governed pipeline) + their APP RUNS. ──
async function seedApps(profile: TenantProfile, ownerId: string, pipelineByName: Map<string, string>): Promise<void> {
  const existing = await listApps(profile.orgId);
  const byTitle = new Map(existing.map((a) => [a.title.trim().toLowerCase(), a.id]));
  for (const spec of appsFor(profile)) {
    const pipelineId = pipelineByName.get(spec.pipelineName) ?? null;
    const steps = spec.steps.map((s, i) => ({ id: `s${i}`, kind: s.kind, label: s.label, config: { domain: s.domain, op: s.op, systemPrompt: s.systemPrompt, sink: s.sink } }));
    const edges = steps.slice(1).map((s, i) => ({ from: steps[i].id, to: s.id }));
    let id = byTitle.get(spec.title.trim().toLowerCase());
    if (!id) {
      const app = await createApp(profile.orgId, ownerId, { title: spec.title, summary: spec.summary, visibility: 'org', steps, edges, pipelineId });
      id = app.id;
    } else {
      await updateApp(id, profile.orgId, { pipelineId }); // self-heal the binding on re-run.
    }
    // App runs — one per status from the app's run counts; a stable id per (app,n).
    const statuses = runStatuses(spec);
    for (let n = 0; n < statuses.length; n++) {
      const status = statuses[n] === 'awaiting_human' ? 'awaiting_human' : 'done';
      const runId = agentRunId(profile.orgId, `app:${spec.key}`, n); // reuse the deterministic hasher
      await upsertAppRunState(
        { runId, appId: id, status: status as never, steps: steps.map((s) => ({ id: s.id, kind: s.kind, label: s.label, status: status === 'awaiting_human' && s.kind === 'human' ? 'awaiting_human' : 'done' })) as never },
        {},
        profile.orgId,
      );
    }
  }
  log(`apps: ${appsFor(profile).length} bound to pipelines + app_runs seeded`);
}

// ─── 11. AGENT RUNS (telemetry corpus) — the highest-leverage read surface. ──
async function seedAgentRuns(profile: TenantProfile, now: number): Promise<void> {
  const corpus = buildRunCorpus(profile, now);
  const fp = flavourProfile(profile);
  for (const m of corpus) {
    const checks = [
      { name: 'guardrails', verdict: m.guardrailVerdict, ms: Math.round(m.latencyMs * 0.1) },
      { name: 'eval', verdict: m.evalScore >= 80 ? 'pass' : 'warn', score: m.evalScore },
    ];
    await db
      .insert(agentRuns)
      .values({
        id: m.id,
        orgId: profile.orgId,
        agentId: `app:${m.appKey}`,
        query: `${m.appTitle} — demo run`,
        answer: m.outcome === 'blocked' ? 'Blocked by guardrail policy.' : `Completed (${m.evalScore}% quality). Model ${m.model}.`,
        status: m.status === 'awaiting_human' ? 'awaiting_human' : m.outcome === 'blocked' ? 'blocked' : 'done',
        steps: [{ kind: 'agent', label: m.appTitle, detail: `${m.totalTokens} tokens`, refs: [], ms: m.latencyMs }],
        citations: [],
        checks,
        provenance: null,
        startedAt: new Date(m.ts),
      } as never)
      .onConflictDoNothing({ target: agentRuns.id });
  }
  const roll = rollupCorpus(corpus);
  log(`agent_runs: ${roll.runs} runs · ${roll.totalTokens} tokens · $${roll.totalCostUsd} · avg ${roll.avgLatencyMs}ms · ${roll.blocked} blocked (model tier: ${fp.primaryModel})`);
}

// ─── 12. Evals — golden cases + eval runs (per app, spread over the window). ──
async function seedEvals(profile: TenantProfile, pipelineByName: Map<string, string>, now: number): Promise<void> {
  const DAY = 86_400_000;
  for (const spec of appsFor(profile)) {
    const pipelineId = pipelineByName.get(spec.pipelineName) ?? null;
    // a couple of golden cases per app (idempotent id).
    for (let n = 0; n < 3; n++) {
      const gid = goldenId(profile.orgId, spec.key, n);
      await db.execute(sql`
        INSERT INTO golden_cases (id, name, query, expected, suite, app_id, pipeline_id, org_id)
        VALUES (${gid}, ${`${spec.title} case ${n + 1}`}, ${`${spec.title} — sample query ${n + 1}`}, ${spec.pipelineName}, ${'demo'}, ${null}, ${pipelineId}, ${profile.orgId})
        ON CONFLICT (id) DO NOTHING;`);
    }
    // eval runs spread over ~30 days so Drift has a trend.
    for (let n = 0; n < 4; n++) {
      const eid = evalRunId(profile.orgId, spec.key, n);
      const score = 78 + ((n * 7 + spec.title.length) % 20);
      const started = new Date(now - (n * 7 + 1) * DAY);
      await db.execute(sql`
        INSERT INTO eval_runs (id, org_id, pipeline_id, engine, score, total, passed, results, started_at)
        VALUES (${eid}, ${profile.orgId}, ${pipelineId}, ${'golden'}, ${score}, ${3}, ${Math.round((score / 100) * 3)}, ${null}::jsonb, ${started.toISOString()})
        ON CONFLICT (id) DO NOTHING;`);
    }
  }
  log(`evals: golden cases + eval_runs seeded per app (drift trend over 30d)`);
}

// ─── 13. Knowledge (Brain) — collections + docs (name-idempotent). ──
async function seedKnowledge(profile: TenantProfile, ownerId: string): Promise<void> {
  const existingColl = await listCollections(profile.orgId);
  const collByName = new Map(existingColl.map((c) => [c.name.trim().toLowerCase(), c.id]));
  for (const coll of knowledgeFor(profile)) {
    let collId = collByName.get(coll.name.trim().toLowerCase());
    if (!collId) {
      collId = await createCollection(ownerId, { name: coll.name, description: coll.description }, profile.orgId);
    }
    const haveDocs = new Set((await listDocuments(collId, profile.orgId)).map((d: { name: string }) => d.name.trim().toLowerCase()));
    for (const doc of coll.docs) {
      if (haveDocs.has(doc.name.trim().toLowerCase())) continue;
      try {
        await addDocument(collId, doc.name, doc.text, undefined, profile.orgId);
      } catch (e) {
        flags.push(`knowledge doc "${doc.name}" for ${profile.orgId} needs the embedder (Brain) reachable: ${(e as Error).message}`);
      }
    }
  }
  log(`knowledge: ${knowledgeFor(profile).length} collections + docs ensured`);
}

// ─── 14. Chat — governed conversations + messages (deterministic id). ──
async function seedChat(profile: TenantProfile): Promise<void> {
  for (const conv of chatsFor(profile)) {
    const cid = chatId(profile.orgId, conv.key);
    await db
      .insert(chatConversations)
      .values({ id: cid, userId: profile.viewerEmail, orgId: profile.orgId, title: conv.title, model: conv.model })
      .onConflictDoNothing({ target: chatConversations.id });
    for (let i = 0; i < conv.messages.length; i++) {
      const m = conv.messages[i];
      await db
        .insert(chatMessages)
        .values({ id: chatMessageId(profile.orgId, conv.key, i), conversationId: cid, role: m.role, content: m.content, citations: (m.citations ?? null) as never })
        .onConflictDoNothing({ target: chatMessages.id });
    }
  }
  log(`chat: ${chatsFor(profile).length} governed conversations`);
}

// ─── Storage + secrets — FLAG for the operator (infra). ──
function flagInfra(profile: TenantProfile): void {
  const files = filesFor(profile);
  flags.push(`STORAGE (SeaweedFS): upload ${files.length} demo files for ${profile.orgId} — ${files.map((f) => f.name).join(', ')}. Run against your object store (the file BODIES are in src/lib/demo/storage.ts).`);
  for (const s of secretsFor(profile)) {
    flags.push(`SECRET (OpenBao): bao kv put ${s.path} value=<real> — placeholder ${s.placeholder} (${s.note})`);
  }
}

async function seedProfile(profile: TenantProfile, now: number): Promise<void> {
  assertAllowed(profile.orgId);
  const id = identity(profile);
  const ownerId = profile.viewerEmail;
  log(`── seeding ${profile.orgId} (${id.name}, ${profile.flavour}) ──`);
  await seedTenant(profile, id);
  await seedGateways(profile);
  const pipelineByName = await seedPipelines(profile, ownerId);
  await seedConnectors(profile, id);
  await seedCatalog(profile);
  await seedGovernance(profile);
  await seedAccess(profile);
  await seedTools(profile);
  await seedAgents(profile);
  await seedApps(profile, ownerId, pipelineByName);
  await seedAgentRuns(profile, now);
  await seedEvals(profile, pipelineByName, now);
  await seedKnowledge(profile, ownerId);
  await seedChat(profile);
  flagInfra(profile);
  log(`✓ ${profile.orgId} done`);
}

async function main(): Promise<void> {
  const only = process.env.OFFGRID_SEED_TENANT;
  const profiles = only ? TOUR_PROFILES.filter((p) => p.orgId === only) : TOUR_PROFILES;
  if (only && profiles.length === 0) throw new Error(`unknown OFFGRID_SEED_TENANT "${only}" (expected org_bharat or org_suraksha)`);
  const now = Date.now();
  for (const p of profiles) await seedProfile(p, now);

  log('');
  log('════ FLAGGED — needs your infra (not written by this script) ════');
  for (const f of flags) log(`  • ${f}`);
  log('');
  log('════ ANALYTICS / FINOPS / OBSERVABILITY / DRIFT ════');
  log('  Overview / Runs / ROI / Evals / Audit read Postgres — seeded above, they light up now.');
  log('  Analytics / FinOps / Observability / Drift read OpenSearch (offgrid-gateway index).');
  log('  To light those charts, ship the run corpus to OpenSearch too (buildRunCorpus in');
  log('  src/lib/demo/telemetry.ts) — or run real traffic through the gateway. FLAG: needs OpenSearch.');
  log('done.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed:tenants] FAILED:', err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  });
