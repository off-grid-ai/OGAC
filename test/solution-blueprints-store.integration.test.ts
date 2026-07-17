import assert from 'node:assert/strict';
import test from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

const ORG_A = 'test-int-solution-blueprints-a';
const ORG_B = 'test-int-solution-blueprints-b';
const dbUp = await dbReachable();

test(
  'solution library and deployment bindings are CRUD-capable and org isolated',
  {
    skip: dbUp ? false : SKIP_MESSAGE,
  },
  async (t) => {
    const store = await import('@/lib/solution-blueprints-store');
    const { createApp, deleteApp } = await import('@/lib/apps-store');
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');

    let appId = '';
    t.after(async () => {
      if (appId) await deleteApp(appId, ORG_A).catch(() => {});
      for (const org of [ORG_A, ORG_B]) {
        await db.execute(sql`DELETE FROM solution_deployments WHERE org_id = ${org}`);
        await db.execute(sql`DELETE FROM solution_blueprints WHERE org_id = ${org}`);
      }
    });

    const seedsA = await store.listSolutionBlueprints(ORG_A);
    const seedsB = await store.listSolutionBlueprints(ORG_B);
    assert.equal(seedsA.length, 2);
    assert.equal(seedsB.length, 2);
    assert.ok(seedsA.every((blueprint) => blueprint.orgId === ORG_A));
    assert.ok(seedsB.every((blueprint) => blueprint.orgId === ORG_B));
    assert.ok(!seedsB.some((blueprint) => blueprint.id === seedsA[0].id));

    const input = {
      ...seedsA[0],
      title: 'Collections cure-rate accelerator',
      proof: { ...seedsA[0].proof, version: 'test-1' },
    };
    const created = await store.createSolutionBlueprint(ORG_A, input);
    assert.match(created.id, /^sbp_/);
    assert.equal(await store.getSolutionBlueprint(created.id, ORG_B), null);

    const updated = await store.updateSolutionBlueprint(created.id, ORG_A, {
      businessOwner: 'Chief Risk Officer',
    });
    assert.equal(updated?.businessOwner, 'Chief Risk Officer');
    assert.equal(await store.updateSolutionBlueprint(created.id, ORG_B, { title: 'leak' }), null);

    const app = await createApp(ORG_A, 'owner@test.local', {
      title: 'Collections deployment',
      summary: 'Tenant app',
      visibility: 'private',
      trigger: { kind: 'on-demand' },
      steps: [
        {
          id: 's1',
          kind: 'agent',
          label: 'Prioritise',
          inlineAgent: { systemPrompt: 'Prioritise delinquency cases.' },
        },
      ],
      edges: [],
    });
    appId = app.id;

    const deployment = await store.createSolutionDeployment(ORG_A, {
      blueprintId: created.id,
      appId,
      status: 'active',
      evidenceLinks: ['/governance/evidence'],
    });
    assert.match(deployment.id, /^sdp_/);
    assert.equal(await store.getSolutionDeployment(deployment.id, ORG_B), null);
    assert.equal((await store.listSolutionDeployments(ORG_A)).length, 1);

    const paused = await store.updateSolutionDeployment(deployment.id, ORG_A, { status: 'paused' });
    assert.equal(paused?.status, 'paused');
    assert.equal(await store.deleteSolutionDeployment(deployment.id, ORG_B), false);
    assert.equal(await store.deleteSolutionDeployment(deployment.id, ORG_A), true);
    assert.equal(await store.deleteSolutionBlueprint(created.id, ORG_B), false);
    assert.equal(await store.deleteSolutionBlueprint(created.id, ORG_A), true);
  },
);
