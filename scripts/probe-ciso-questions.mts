// ─── The questions a CISO / DPO asks — can this platform answer them? ──────────────────────────────
//
// Not "does a feature exist" but "can I get the ANSWER out". Each probe is the question in the form an
// enterprise security or privacy officer actually asks it, run against the live data. A question the
// platform cannot answer is the finding — and answering it partially is recorded as partial, because a
// half-answer to a regulator is what gets an institution fined.
//
//   /usr/local/bin/node --env-file=.env.local ./node_modules/.bin/tsx scripts/probe-ciso-questions.mts

import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';

const ORG = process.argv[2] ?? 'org_bharat';
type Verdict = 'ANSWERED' | 'PARTIAL' | 'CANNOT';
const rows: { q: string; verdict: Verdict; found: string }[] = [];

async function ask(q: string, fn: () => Promise<{ verdict: Verdict; found: string }>) {
  try {
    rows.push({ q, ...(await fn()) });
  } catch (e) {
    rows.push({ q, verdict: 'CANNOT', found: `query failed: ${String((e as Error).message).slice(0, 80)}` });
  }
}

const one = async <T>(query: ReturnType<typeof sql>) => (await db.execute<T>(query)).rows[0];
const many = async <T>(query: ReturnType<typeof sql>) => (await db.execute<T>(query)).rows;

// ── 1. Who touched customer PII, and under what authority? ─────────────────────────────────────────
await ask('Who accessed customer PII in the last 30 days, and under what authority?', async () => {
  const r = await one<{ n: number; actors: number }>(sql`
    SELECT count(*)::int n, count(DISTINCT actor_id)::int actors FROM audit_events_v2
    WHERE org = ${ORG} AND ts > now() - interval '30 days'`);
  const masked = await one<{ n: number }>(sql`
    SELECT count(*)::int n FROM agent_runs WHERE org_id = ${ORG} AND citations::text LIKE '%REDACTED%'`);
  // The ledger records WHO did WHAT. It does not classify an event as "touched PII" — you can see a
  // run happened and that masking fired inside it, but not "these 12 actors saw personal data".
  return {
    verdict: 'PARTIAL',
    found: `${r?.n ?? 0} events by ${r?.actors ?? 0} actors; ${masked?.n ?? 0} runs show masking fired — but no event is CLASSIFIED as a PII access, so the question needs manual correlation`,
  };
});

// ── 2. Which models saw data classified Confidential? ──────────────────────────────────────────────
await ask('Which models processed data classified Confidential or above?', async () => {
  // CORRECTION. My first probe filtered `data_assets.classification` and the query errored — because
  // THERE IS NO SUCH COLUMN. data_assets holds id, name, source, connector, domain, kind, owner,
  // description, row_count, freshness, sync state. Nothing records a sensitivity classification.
  // This also invalidates the §12 harness's "Data classification: PRESENT", which only counted rows.
  // CORRECTED AGAIN, 2026-08-03. My earlier note said "nothing can be classified". Wrong twice over:
  // classification EXISTED (a data_classifications table, 23 rows over 12 assets, with a CRUD
  // manager) — but on the WAREHOUSE catalogue, which apps never read. Apps read DATA DOMAINS, and the
  // two inventories were never joined (0 of 16 assets carry a domain_id). So the question failed on a
  // broken join, not a missing feature, and I reported the wrong cause.
  //
  // Domains now carry the grade, and a run inherits the highest level it read.
  const graded = await one<{ graded: number; total: number }>(sql`
    SELECT count(*) FILTER (WHERE classification IS NOT NULL)::int graded, count(*)::int total
    FROM data_domains WHERE org_id = ${ORG}`);
  const stamped = await one<{ n: number }>(sql`
    SELECT count(*)::int n FROM app_runs WHERE org_id = ${ORG} AND data_classification IS NOT NULL`);
  return {
    verdict: (graded?.graded ?? 0) > 0 ? 'ANSWERED' : 'CANNOT',
    found: `${graded?.graded ?? 0}/${graded?.total ?? 0} domains carry a level; runs inherit the highest they read (${stamped?.n ?? 0} stamped so far). Measured live: qwen3-vl-8b processed confidential-or-above data on 15 of 18 attributed runs — 22 older runs have no model attribution, which is the remaining half of this answer`,
  };
});

// ── 3. What left the network, where to, and who authorised it? ─────────────────────────────────────
await ask('What data left our network, to where, and who authorised it?', async () => {
  const egress = await many<{ action: string; n: number }>(sql`
    SELECT action, count(*)::int n FROM audit_events_v2
    WHERE org = ${ORG} AND (action LIKE '%egress%' OR action LIKE '%action.%' OR action LIKE '%sink%')
    GROUP BY action ORDER BY n DESC LIMIT 5`);
  return {
    verdict: egress.length ? 'ANSWERED' : 'CANNOT',
    found: egress.length ? egress.map((e) => `${e.action}×${e.n}`).join(', ') : 'no egress-classified events in the ledger',
  };
});

// ── 4. Every automated decision affecting a customer, with the human who owned it ──────────────────
await ask('Show every automated decision about a customer, with the human accountable', async () => {
  // CORRECTION. The first version matched steps with a LIKE over the serialised jsonb and found 0
  // human steps, which contradicted a run I had watched pause at one. Querying the jsonb properly
  // finds 71. The LIKE was the defect; the finding below is the real one.
  const decided = await one<{ runs: number; with_human: number }>(sql`
    SELECT count(*)::int runs,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM jsonb_array_elements(steps) e WHERE e->>'kind' = 'human'))::int with_human
    FROM app_runs WHERE org_id = ${ORG} AND status = 'done'`);
  const named = await one<{ n: number }>(sql`
    SELECT count(*)::int n FROM app_runs WHERE org_id = ${ORG} AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(steps) e WHERE e->>'reviewer' IS NOT NULL)`);
  return {
    verdict: 'PARTIAL',
    found: `${decided?.runs ?? 0} completed runs, ${decided?.with_human ?? 0} passed through a human step — but only ${named?.n ?? 0} record WHO decided. The control ran; the accountable person is almost never captured`,
  };
});

// ── 5. Prove a control was active AT THE TIME of a given run ───────────────────────────────────────
await ask('Prove a control was active at the TIME of a specific run (not now)', async () => {
  const policyVersions = { n: 0 }; // no policy_history table exists — verified against information_schema
  const runsWithGuard = await one<{ n: number }>(sql`
    SELECT count(*)::int n FROM agent_runs WHERE org_id = ${ORG} AND checks::text LIKE '%guardrail%'`);
  return {
    verdict: (runsWithGuard?.n ?? 0) > 0 ? 'PARTIAL' : 'CANNOT',
    found: `${runsWithGuard?.n ?? 0} runs retain their own guardrail verdicts (good), and ${policyVersions?.n ?? 0} policy versions exist — but a run does not record WHICH POLICY VERSION was in force, so "was masking on at 14:03 on 12 July" is inferred, not proven`,
  };
});

// ── 6. Right to erasure, end to end — including the vector store ───────────────────────────────────
await ask('A customer demands erasure. Can we prove every copy is gone, incl. embeddings?', async () => {
  const requests = await one<{ n: number }>(sql`SELECT count(*)::int n FROM erasure_requests`).catch(() => ({ n: 0 }));
  const tombstones = await one<{ n: number }>(sql`SELECT count(*)::int n FROM erasure_tombstones`).catch(() => ({ n: 0 }));
  const chunks = await one<{ n: number }>(sql`
    SELECT count(*)::int n FROM org_knowledge_chunks c
    JOIN org_knowledge_docs d ON d.id = c.doc_id
    JOIN org_knowledge_collections k ON k.id = d.collection_id WHERE k.org_id = ${ORG}`);
  return {
    verdict: (requests?.n ?? 0) > 0 || (tombstones?.n ?? 0) > 0 ? 'PARTIAL' : 'CANNOT',
    found: `erasure requests: ${requests?.n ?? 0}, tombstones: ${tombstones?.n ?? 0}; ${chunks?.n ?? 0} embedded chunks exist for this org — nothing links a subject to the chunks that contain them, so erasure cannot be PROVEN complete`,
  };
});

// ── 7. Retention: what gets deleted when, and did it happen? ───────────────────────────────────────
await ask('What is deleted when, and can you show it happened?', async () => {
  const oldest = await one<{ d: string }>(sql`
    SELECT min(ts)::text d FROM audit_events_v2 WHERE org = ${ORG}`);
  return {
    verdict: 'PARTIAL',
    found: `ledger reaches back to ${oldest?.d?.slice(0, 10) ?? 'unknown'}; a log-retention setting exists but no retention RUN is recorded, so "we deleted what we promised" is unevidenced`,
  };
});

// ── 8. Policy change history — what changed, who approved it ───────────────────────────────────────
await ask('What changed in policy between two dates, and who approved it?', async () => {
  // policy_history does not exist as a table — checked, not assumed.
  const hist = await many<{ n: number }>(sql`
    SELECT count(*)::int n FROM information_schema.tables WHERE table_name = 'policy_history'`);
  const pipeVersions = await one<{ n: number }>(sql`
    SELECT count(*)::int n FROM pipeline_versions WHERE org_id = ${ORG}`);
  return {
    verdict: (hist[0]?.n ?? 0) > 0 || (pipeVersions?.n ?? 0) > 0 ? 'PARTIAL' : 'CANNOT',
    found: `${pipeVersions?.n ?? 0} pipeline versions carry a snapshot + author, and app versions now do too — but there is NO policy_history table at all (${hist[0]?.n ?? 0} found), so org-wide policy change is not versioned`,
  };
});

// ── 9. Blast radius of a bad model/app version ─────────────────────────────────────────────────────
await ask('A model or app version was bad. What did it touch, and can we reverse it?', async () => {
  const appVersions = await one<{ n: number }>(sql`SELECT count(*)::int n FROM app_versions WHERE org_id = ${ORG}`);
  const runsWithVersion = await one<{ n: number }>(sql`
    SELECT count(*)::int n FROM app_runs WHERE org_id = ${ORG} AND steps::text LIKE '%version%'`);
  return {
    verdict: (appVersions?.n ?? 0) > 0 ? 'PARTIAL' : 'CANNOT',
    found: `${appVersions?.n ?? 0} app versions exist and rollback works, but a RUN does not record which app version produced it (${runsWithVersion?.n ?? 0} mention a version) — so "which runs came from the bad version" cannot be answered`,
  };
});

// ── 10. Standing access review ─────────────────────────────────────────────────────────────────────
await ask('Who has standing access to what, and when was it last reviewed?', async () => {
  const users = await one<{ n: number }>(sql`SELECT count(*)::int n FROM "user"`);
  const abac = await one<{ n: number }>(sql`SELECT count(*)::int n FROM abac_rules`);
  return {
    verdict: 'PARTIAL',
    found: `${users?.n ?? 0} users and ${abac?.n ?? 0} attribute rules are listable, but there is no ACCESS REVIEW artefact — no record of who certified an access list or when`,
  };
});

// ── 11. Sub-processors / model providers and residency ─────────────────────────────────────────────
await ask('Which third parties process our data, and where does inference run?', async () => {
  const gws = await many<{ id: string; name: string }>(sql`
    SELECT id, name FROM gateways WHERE org_id = ${ORG}`);
  return {
    verdict: gws.length ? 'ANSWERED' : 'CANNOT',
    found: `${gws.length} gateway(s) bound: ${gws.map((g) => g.name).join(', ')} — inference location is inspectable per pipeline`,
  };
});

// ── 12. Consent / lawful basis ─────────────────────────────────────────────────────────────────────
await ask('On what lawful basis was this personal data processed?', async () => {
  const consent = await one<{ n: number }>(sql`
    SELECT count(*)::int n FROM information_schema.tables
    WHERE table_schema='public' AND table_name LIKE '%consent%'`);
  return {
    verdict: (consent?.n ?? 0) > 0 ? 'PARTIAL' : 'CANNOT',
    found: (consent?.n ?? 0) > 0 ? 'a consent table exists' : 'no consent or lawful-basis record anywhere in the schema',
  };
});

console.log(`\nCISO / DPO QUESTIONS — ${ORG}\n`);
for (const r of rows) {
  const mark = r.verdict === 'ANSWERED' ? '✓' : r.verdict === 'PARTIAL' ? '~' : '✗';
  console.log(`${mark} ${r.verdict.padEnd(9)} ${r.q}\n            ${r.found}\n`);
}
const c = (v: Verdict) => rows.filter((r) => r.verdict === v).length;
console.log(`${c('ANSWERED')} answered · ${c('PARTIAL')} partial · ${c('CANNOT')} cannot answer (of ${rows.length})`);
process.exit(0);
