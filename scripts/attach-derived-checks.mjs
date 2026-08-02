#!/usr/bin/env node
// ─── Give every demo app its own quality set ───────────────────────────────────────────────────────
//
// FOUNDER, live: "quality needs to be more tightly coupled to apps" and "the demo needs to be more
// comprehensive". Both point at the same hole: 24 golden cases existed, all pipeline-bound, and an
// app's Quality tab showed nothing of its own — so the surface read as unused.
//
// This accepts the checks each app's OWN DESIGN implies (the /evals/suggest endpoint added for Flow 3)
// for every app in the demo tenants. Nothing is invented: each check asserts something that app's spec
// already promises — it cites the source it reads, it pauses where a human is required, it sends
// nothing before an approval, it refuses data outside its pipeline's ceiling.
//
//   ADMIN=<token> HOST=bharatunion-onprem-console.getoffgridai.co node scripts/attach-derived-checks.mjs
//
// Idempotent: the endpoint filters out checks already in an app's set, so a second run adds nothing.

const BASE = process.env.BASE || 'http://localhost:3000';
const H = {
  authorization: `Bearer ${process.env.ADMIN}`,
  'content-type': 'application/json',
  ...(process.env.HOST ? { host: process.env.HOST } : {}),
};

async function json(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: H,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, body: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, body: text };
  }
}

const apps = await json('GET', '/api/v1/admin/apps');
const list = apps.body?.data ?? [];
console.log(`${list.length} apps in scope\n`);

let added = 0;
let covered = 0;
for (const app of list) {
  const s = await json('GET', `/api/v1/admin/apps/${app.id}/evals/suggest`);
  const suggestions = s.body?.data ?? [];
  if (!suggestions.length) {
    covered += s.body?.alreadyCovered ?? 0;
    console.log(`· ${app.title}: nothing new (${s.body?.alreadyCovered ?? 0} already covered)`);
    continue;
  }
  const accept = await json('POST', `/api/v1/admin/apps/${app.id}/evals/suggest`, {
    keys: suggestions.map((x) => x.key),
  });
  if (accept.ok) {
    added += accept.body.created.length;
    console.log(`✓ ${app.title}: +${accept.body.created.length} — ${suggestions.map((x) => x.name).join(', ')}`);
  } else {
    console.log(`✗ ${app.title}: ${accept.status} ${JSON.stringify(accept.body).slice(0, 90)}`);
  }
}
console.log(`\nadded ${added} checks; ${covered} already covered`);
