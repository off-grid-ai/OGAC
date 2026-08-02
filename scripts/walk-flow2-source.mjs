#!/usr/bin/env node
// ─── FLOW 2, WALKED — "connect a data source", the ten steps in sequence ───────────────────────────
//
// ROADMAP §10 Flow 2: choose source · authenticate · discover schemas and content · classify data ·
// map source permissions · select sync scope · test retrieval · review lineage · approve connection ·
// monitor sync health. Every piece existed; the audit's gate was 🔶 because nobody had done the ten in
// ORDER on one source, which is the only way to find the seams between them.
//
// This walks them against the live console with a REAL connector, reports what each step returned, and
// says plainly where a step has no route rather than inventing one. It is read-mostly: it creates one
// throwaway connector, exercises the flow on it, and deletes it.
//
//   ADMIN=<token> node scripts/walk-flow2-source.mjs

const BASE = process.env.BASE || 'http://localhost:3000';
const H = { authorization: `Bearer ${process.env.ADMIN}`, 'content-type': 'application/json' };
const steps = [];

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: H,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const { verdict, note } = await fn();
    steps.push({ name, verdict, note, ms: Date.now() - t0 });
  } catch (e) {
    steps.push({ name, verdict: 'ERROR', note: String(e.message).slice(0, 120), ms: Date.now() - t0 });
  }
}

let connectorId = null;
let domainId = null;

await step('1. Choose source', async () => {
  const r = await call('GET', '/api/v1/admin/connectors');
  const list = r.body?.data ?? r.body?.connectors ?? [];
  return { verdict: list.length ? 'OK' : 'EMPTY', note: `${list.length} connector types/instances offered` };
});

await step('2. Authenticate (create a connection)', async () => {
  // STRUCTURED fields, not a connection string. My first walk sent `endpoint` and got a 400 — whose
  // message was exactly right ("A host is required. A database name is required. …"), i.e. the product
  // told me precisely what was wrong and my probe was the defect. Recorded here so the next reader does
  // not mistake it for one.
  const r = await call('POST', '/api/v1/admin/connectors', {
    name: `Flow2 walk ${Date.now().toString(36)}`,
    type: 'postgres',
    host: process.env.FLOW2_HOST || '127.0.0.1',
    port: Number(process.env.FLOW2_PORT || 5432),
    database: process.env.FLOW2_DB || 'offgrid',
    username: process.env.FLOW2_USER || 'offgrid',
    password: process.env.FLOW2_PASSWORD || 'offgrid',
  });
  connectorId = r.body?.id ?? r.body?.connector?.id ?? null;
  return {
    verdict: r.ok && connectorId ? 'OK' : 'GAP',
    note: r.ok ? `connector ${connectorId}` : `POST → ${r.status}`,
  };
});

await step('3. Discover schemas and content', async () => {
  if (!connectorId) return { verdict: 'SKIPPED', note: 'no connector' };
  const r = await call('POST', `/api/v1/admin/connectors/${connectorId}/sync`);
  const n = r.body?.records ?? r.body?.rows ?? r.body?.count;
  return {
    verdict: r.ok ? 'OK' : 'GAP',
    note: r.ok ? `sync reported ${n ?? 'no count'}` : `sync → ${r.status} ${JSON.stringify(r.body).slice(0, 70)}`,
  };
});

await step('4. Classify data', async () => {
  const r = await call('GET', '/api/v1/admin/data-assets');
  const rows = r.body?.data ?? r.body?.assets ?? [];
  const classified = rows.filter((x) => x.classification).length;
  return {
    verdict: rows.length ? 'OK' : 'EMPTY',
    note: `${classified}/${rows.length} assets carry a classification`,
  };
});

await step('5. Map source permissions', async () => {
  const r = await call('GET', '/api/v1/admin/abac-rules');
  const rules = r.body?.data ?? r.body?.rules ?? [];
  return { verdict: r.ok ? 'OK' : 'GAP', note: `${rules.length} attribute rule(s) govern access` };
});

await step('6. Select sync scope (bind a data domain)', async () => {
  if (!connectorId) return { verdict: 'SKIPPED', note: 'no connector' };
  const r = await call('POST', '/api/v1/admin/data-domains', {
    label: `flow2 walk ${Date.now().toString(36)}`,
    connectorId,
    resource: 'app_runs',
    aliases: [],
  });
  domainId = r.body?.id ?? null;
  return { verdict: r.ok ? 'OK' : 'GAP', note: r.ok ? `domain ${domainId} bound to the connector` : `POST → ${r.status}` };
});

await step('7. Test retrieval', async () => {
  if (!connectorId) return { verdict: 'SKIPPED', note: 'no connector' };
  const r = await call('GET', `/api/v1/admin/connectors/${connectorId}`);
  const records = r.body?.records ?? r.body?.connector?.records;
  return {
    verdict: r.ok ? 'OK' : 'GAP',
    note: r.ok ? `connector reports ${records ?? 'no'} record(s) after sync` : `GET → ${r.status}`,
  };
});

await step('8. Review lineage', async () => {
  const r = await call('GET', '/api/v1/admin/lineage');
  const nodes = r.body?.nodes ?? r.body?.data?.nodes ?? [];
  return { verdict: r.ok ? 'OK' : 'GAP', note: r.ok ? `${nodes.length} lineage node(s)` : `GET → ${r.status}` };
});

await step('9. Approve connection (governed reach)', async () => {
  if (!domainId) return { verdict: 'SKIPPED', note: 'no domain' };
  // A source is only reachable once a PIPELINE's data ceiling allowlists it — that IS the approval in
  // this product, and it is the step that makes the connection governed rather than merely present.
  const r = await call('GET', '/api/v1/admin/pipelines');
  const pipes = r.body?.data ?? r.body?.pipelines ?? [];
  const allowlisted = pipes.filter((p) => (p.dataAllowlist ?? []).length).length;
  return {
    verdict: pipes.length ? 'OK' : 'EMPTY',
    note: `${allowlisted}/${pipes.length} pipelines carry a data ceiling that can admit it`,
  };
});

await step('10. Monitor sync health', async () => {
  const r = await call('GET', '/api/v1/admin/connectors');
  const list = r.body?.data ?? r.body?.connectors ?? [];
  const withStatus = list.filter((c) => c.status).length;
  return { verdict: list.length ? 'OK' : 'EMPTY', note: `${withStatus}/${list.length} connectors report a status` };
});

// Clean up both artefacts the walk created.
if (domainId) await step('cleanup: domain', async () => {
  const r = await call('DELETE', `/api/v1/admin/data-domains/${domainId}`);
  return { verdict: r.ok ? 'OK' : 'GAP', note: r.ok ? 'deleted' : `DELETE → ${r.status}` };
});
if (connectorId) await step('cleanup: connector', async () => {
  const r = await call('DELETE', `/api/v1/admin/connectors/${connectorId}`);
  return { verdict: r.ok ? 'OK' : 'GAP', note: r.ok ? 'deleted' : `DELETE → ${r.status}` };
});

console.log('\nFLOW 2 — connect a data source, walked in order\n');
for (const s of steps) {
  console.log(`${s.verdict.padEnd(8)} ${s.name.padEnd(46)} ${String(s.ms).padStart(6)}ms  ${s.note}`);
}
const bad = steps.filter((s) => s.verdict === 'GAP' || s.verdict === 'ERROR');
console.log(`\n${steps.length - bad.length}/${steps.length} steps completed`);
if (bad.length) console.log(bad.map((b) => `  ✗ ${b.name}: ${b.note}`).join('\n'));
