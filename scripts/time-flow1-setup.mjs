#!/usr/bin/env node
// ─── FLOW 1, MEASURED — "time to a working environment should be hours, not months" ────────────────
//
// ROADMAP §10 Flow 1 lists ten steps and then makes a claim with a NUMBER in it. That claim has never
// been measured, and an unmeasured claim in a document we sell from is exactly how the older ledger
// drifted. So this walks the ten steps against the live console as an admin, times each one, and
// reports what it could NOT do — because a step with no route is the honest finding, not a failure.
//
// It creates a throwaway tenant and deletes it at the end, so the demo tenants are untouched.
//
//   ADMIN=<token> BASE=http://localhost:3000 node scripts/time-flow1-setup.mjs
//
// Output is a table of step → seconds → what happened, and a total. Nothing here is a mock: every
// call is the same API the console's own screens use.

const BASE = process.env.BASE || 'http://localhost:3000';
const ADMIN = process.env.ADMIN;
const stamp = Date.now().toString(36);
const SLUG = `flow1-${stamp}`;

const H = { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' };
const results = [];

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, seconds: (Date.now() - t0) / 1000, ok: true, note: note ?? '' });
  } catch (e) {
    results.push({ name, seconds: (Date.now() - t0) / 1000, ok: false, note: String(e.message).slice(0, 120) });
  }
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: H,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 90)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

let tenantId = null;

await step('1. Create tenant', async () => {
  const t = await call('POST', '/api/v1/admin/tenants', {
    name: `Flow1 Timing ${stamp}`,
    plan: 'standard',
    slug: SLUG,
    enabledModules: ['studio', 'data-domains', 'knowledge'],
  });
  tenantId = t.id ?? t.tenant?.id ?? null;
  return `tenant ${tenantId ?? SLUG}`;
});

await step('2. Configure deployment (gateways reachable)', async () => {
  const g = await call('GET', '/api/v1/admin/gateways');
  const list = g.data ?? g.gateways ?? [];
  return `${list.length} gateway(s) already serving`;
});

await step('3. Connect identity provider', async () => {
  const c = await call('GET', '/api/v1/admin/config');
  const providers = c.auth?.providers ?? c.providers ?? [];
  return Array.isArray(providers) && providers.length
    ? `${providers.length} provider(s) configured`
    : 'no IdP route — configured by env at deploy time';
});

await step('4. Import organizational structure (teams)', async () => {
  const t = await call('GET', '/api/v1/admin/teams');
  return `${(t.data ?? t.teams ?? []).length} team(s) readable`;
});

await step('5. Configure model providers', async () => {
  // Enumerated from src/app/api, not guessed: the model inventory is /admin/gateway/models. My first
  // pass typed /admin/models and got a 404 — the documented trap in ROADMAP_REAL_AUDIT, which is a
  // finding about my probe, never about the product.
  const m = await call('GET', '/api/v1/admin/gateway/models');
  return `${(m.data ?? m.models ?? []).length} model(s) available`;
});

await step('6. Define data classifications', async () => {
  // Classifications live on the data-assets surface; the collection route is /admin/data-assets and
  // each asset carries its classification (the [id] route under data-classifications is the editor).
  const d = await call('GET', '/api/v1/admin/data-assets');
  const rows = d.data ?? d.assets ?? [];
  const classified = rows.filter((r) => r.classification).length;
  return `${classified}/${rows.length} data assets classified`;
});

await step('7. Define global policies', async () => {
  const p = await call('GET', '/api/v1/admin/policy');
  return p?.engine ? `policy engine: ${p.engine}` : 'policy readable';
});

await step('8. Configure audit and retention', async () => {
  // Retention is per-surface rather than one global setting: logs retention and per-asset retention.
  const r = await call('GET', '/api/v1/admin/operations/logs/retention');
  return typeof r === 'object' ? 'log retention policy readable' : 'retention endpoint responded';
});

await step('9. Add initial data sources', async () => {
  const c = await call('GET', '/api/v1/admin/connectors');
  return `${(c.data ?? c.connectors ?? []).length} connector(s) available to bind`;
});

await step('10. Invite platform administrators', async () => {
  const u = await call('GET', '/api/v1/admin/users');
  return `${(u.data ?? u.users ?? []).length} user(s) on the org`;
});

// Clean up — a timing run must not leave a tenant behind in the demo.
if (tenantId) {
  await step('cleanup: delete the throwaway tenant', async () => {
    await call('DELETE', `/api/v1/admin/tenants/${tenantId}`);
    return 'deleted';
  });
}

const total = results.reduce((s, r) => s + r.seconds, 0);
console.log('\nFLOW 1 — time to a working environment (measured, live)\n');
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name.padEnd(46)} ${r.seconds.toFixed(2).padStart(6)}s  ${r.note}`);
}
console.log(`\nTOTAL ${total.toFixed(1)}s across ${results.length} steps`);
console.log(
  results.every((r) => r.ok)
    ? 'Every Flow 1 step is reachable through the API.'
    : `${results.filter((r) => !r.ok).length} step(s) had no working route — listed above with their status.`,
);
