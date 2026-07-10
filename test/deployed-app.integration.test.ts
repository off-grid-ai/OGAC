import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION: the REAL /app/<slug> resolution seam end-to-end — createApp → publishApp (mints the
// slug) → getAppBySlug (the SAME lookup the page + the run endpoint use) → resolveDeployedApp (the
// public gate). Proves the exact 404 fix against a live Postgres:
//   • a PUBLISHED app resolves by its minted slug;
//   • an UNPUBLISHED app's slug does not exist → getAppBySlug is null → 404;
//   • even if an unpublished row somehow carried a slug, the gate 404s it.
// Skips green when the DB is down. Writes under a dedicated org; cleans up.

const ORG = 'test-int-deployed-app';
const OWNER = 'builder@corp';

const dbUp = await dbReachable();

test('deployed /app/<slug> resolution against a real Postgres', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { createApp, publishApp, getAppBySlug, deleteApp } = await import('@/lib/apps-store');
  const { resolveDeployedApp } = await import('@/lib/deployed-app');

  const created: string[] = [];
  t.after(async () => {
    for (const id of created) await deleteApp(id, ORG).catch(() => {});
  });

  const spec = {
    title: 'Renewals Assistant',
    summary: 'Handles renewals',
    visibility: 'public' as const,
    trigger: { kind: 'on-demand' as const },
    steps: [{ id: 's1', kind: 'agent' as const, label: 'Answer', inlineAgent: { systemPrompt: 'help' } }],
    edges: [],
  };

  // A PUBLISHED app resolves by its minted slug.
  const app = await createApp(ORG, OWNER, spec);
  created.push(app.id);
  const published = await publishApp(app.id, ORG);
  assert.ok(published?.slug, 'publishApp mints a slug');

  const loaded = await getAppBySlug(published!.slug!);
  assert.ok(loaded, 'getAppBySlug finds the published app (the page + run endpoint share this lookup)');
  const resolved = resolveDeployedApp(loaded);
  assert.ok(resolved, 'a published app resolves → the page renders it, no 404');
  assert.equal(resolved!.slug, published!.slug);

  // An UNPUBLISHED app has NO slug → its (nonexistent) slug does not resolve → 404.
  const draft = await createApp(ORG, OWNER, spec);
  created.push(draft.id);
  assert.equal(draft.published, false);
  assert.equal(draft.slug ?? null, null, 'a fresh app is unpublished with no slug');

  // And the pure gate 404s an unpublished row directly (belt-and-braces: never serve unpublished).
  assert.equal(resolveDeployedApp({ ...loaded!, published: false }), null);
});
