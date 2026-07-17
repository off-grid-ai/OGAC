import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';
import { prepareSolutionSchema } from './support/solution-schema.mjs';

const ORG_A = 'test-int-solution-blueprints-a';
const ORG_B = 'test-int-solution-blueprints-b';
const dbUp = await dbReachable();
const previousDatabaseUrl = process.env.DATABASE_URL;
const prepared = dbUp ? await prepareSolutionSchema('store') : null;
if (prepared) process.env.DATABASE_URL = prepared.databaseUrl;
after(async () => {
  await prepared?.cleanup();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

test(
  'versioned adoption enforces the real runtime and retains scoped ROI evidence',
  {
    skip: dbUp ? false : SKIP_MESSAGE,
  },
  async (t) => {
    const store = await import('@/lib/solution-blueprints-store');
    const { createApp, publishApp, updateApp } = await import('@/lib/apps-store');
    const { createPipeline } = await import('@/lib/pipelines');
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');

    const pipelineId = `pl_solution_${Date.now()}`;
    let appId = '';
    const runIds = [
      `run_solution_${Date.now()}_1`,
      `run_solution_${Date.now()}_2`,
      `run_solution_${Date.now()}_pre_adoption`,
      `run_solution_${Date.now()}_paused`,
    ];
    t.after(async () => {
      for (const org of [ORG_A, ORG_B]) {
        await db.execute(sql`DELETE FROM solution_observations WHERE org_id = ${org}`);
        await db.execute(sql`DELETE FROM solution_deployments WHERE org_id = ${org}`);
        await db.execute(sql`DELETE FROM solution_blueprint_versions WHERE org_id = ${org}`);
        await db.execute(sql`DELETE FROM solution_blueprints WHERE org_id = ${org}`);
        await db.execute(sql`DELETE FROM solution_blueprint_seed_state WHERE org_id = ${org}`);
      }
      await db.execute(
        sql`DELETE FROM app_runs WHERE id IN (${runIds[0]}, ${runIds[1]}, ${runIds[2]}, ${runIds[3]})`,
      );
      if (appId) await db.execute(sql`DELETE FROM apps WHERE id = ${appId}`);
      await db.execute(sql`DELETE FROM pipeline_versions WHERE pipeline_id = ${pipelineId}`);
      await db.execute(sql`DELETE FROM pipelines WHERE id = ${pipelineId}`);
    });

    const seedsA = await store.listSolutionBlueprints(ORG_A);
    const seedsB = await store.listSolutionBlueprints(ORG_B);
    assert.equal(seedsA.length, 2);
    assert.equal(seedsB.length, 2);
    assert.ok(seedsA.every((item) => item.proof.status === 'unverified'));
    assert.ok(seedsA.every((item) => item.adoptable === false));
    assert.ok(!seedsB.some((item) => item.id === seedsA[0].id));
    assert.equal(await store.deleteSolutionBlueprint(seedsA[1].id, ORG_A), true);
    assert.equal((await store.listSolutionBlueprints(ORG_A)).length, 1);
    assert.equal(
      (await store.listSolutionBlueprints(ORG_A, true)).filter((item) => item.tombstonedAt).length,
      1,
      'retired catalog entries remain durable and are not recreated by reads',
    );

    await createPipeline(
      {
        id: pipelineId,
        name: 'Collections intervention',
        status: 'published',
        dataAllowlist: ['loan accounts'],
      },
      'owner@test.local',
      ORG_A,
    );
    const draftApp = await createApp(ORG_A, 'owner@test.local', {
      title: 'Collections intervention',
      summary: 'Tenant implementation',
      visibility: 'private',
      pipelineId,
      published: false,
      trigger: { kind: 'on-demand' },
      steps: [
        { id: 'read', kind: 'connector-query', label: 'Read loans', domain: 'loan accounts' },
        {
          id: 'assess',
          kind: 'agent',
          label: 'Assess',
          inlineAgent: { systemPrompt: 'Assess delinquency.', grounded: true },
        },
        { id: 'approve', kind: 'human', label: 'Approve' },
        { id: 'report', kind: 'output', label: 'Report', sink: 'report' },
      ],
      edges: [
        { from: 'read', to: 'assess' },
        { from: 'assess', to: 'approve' },
        { from: 'approve', to: 'report' },
      ],
    });
    appId = draftApp.id;
    const app = await publishApp(draftApp.id, ORG_A);
    assert.ok(app);

    const input = {
      title: 'Collections cure-rate accelerator',
      summary: 'Intervene before accounts roll forward.',
      industry: 'Lending',
      process: 'Collections',
      businessOwner: 'Head of Collections',
      requiredDataDomains: ['loan accounts'],
      requiredCapabilities: ['grounded-inference', 'human-approval', 'report-output'] as const,
      requiredPipelineName: 'Collections intervention',
      sourceTemplateKey: 'collections-intervention',
      adoptable: true,
      outcome: {
        metricName: '30+ DPD',
        metricUnit: '%',
        direction: 'decrease' as const,
        measurementWindow: '30 days',
        baseline: { value: 12, label: 'Approved baseline' },
        target: { value: 9, label: 'Approved target' },
        measured: null,
        roi: {
          currency: 'USD',
          annualBenefit: 100,
          implementationCost: 20,
          annualOperatingCost: 10,
          rationale: 'Avoided loss.',
        },
      },
      proof: { status: 'unverified' as const, summary: '', evidenceLinks: [] },
    };
    const created = await store.createSolutionBlueprint(ORG_A, input, 'author@test.local');
    assert.equal(created.currentVersion, 1);
    const appBoundary = await db.execute(sql`
      SELECT id, tableoid::regclass::text AS relation
      FROM apps WHERE id = ${appId}`);
    assert.deepEqual(appBoundary.rows[0], { id: appId, relation: 'apps' });

    const deployment = await store.createSolutionDeployment(ORG_A, {
      blueprintId: created.id,
      blueprintVersion: 1,
      appId,
      status: 'active',
    });
    assert.equal(deployment.pipelineId, pipelineId);
    await store.assertSolutionRuntimeBinding(app, ORG_A);
    await assert.rejects(
      store.createSolutionDeployment(ORG_A, {
        blueprintId: created.id,
        blueprintVersion: 1,
        appId,
        status: 'active',
      }),
      (error: unknown) => (error as { code?: string }).code === 'duplicate',
    );

    const updated = await store.updateSolutionBlueprint(
      created.id,
      ORG_A,
      { businessOwner: 'Chief Risk Officer' },
      'editor@test.local',
    );
    assert.equal(updated?.currentVersion, 2);
    assert.equal(deployment.blueprintVersion, 1, 'active deployment stays pinned to v1');
    assert.deepEqual(
      (await store.listSolutionBlueprintVersions(created.id, ORG_A)).map((item) => item.version),
      [2, 1],
    );

    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-02-01T00:00:00Z');
    await db.execute(
      sql`UPDATE solution_deployments SET activated_at = ${start} WHERE id = ${deployment.id}`,
    );
    await db.execute(sql`
      INSERT INTO app_runs
        (id, org_id, app_id, status, trigger, input, steps, outcome, provenance, started_at, finished_at)
      VALUES
        (${runIds[0]}, ${ORG_A}, ${appId}, 'done', '{"kind":"on-demand"}'::jsonb,
         '{}'::jsonb, '[{"id":"assess","kind":"agent","label":"Assess","status":"done","costUsd":10}]'::jsonb,
         'complete', NULL, '2026-01-10T00:00:00Z', '2026-01-10T00:01:00Z'),
        (${runIds[1]}, ${ORG_A}, ${appId}, 'done', '{"kind":"on-demand"}'::jsonb,
         '{}'::jsonb, '[]'::jsonb, 'complete',
         '{"signature":"test","algorithm":"test","publicKey":null,"signedAt":"2026-01-11T00:01:00Z","costUsd":15}'::jsonb,
         '2026-01-11T00:00:00Z', '2026-01-11T00:01:00Z'),
        (${runIds[2]}, ${ORG_A}, ${appId}, 'done', '{"kind":"on-demand"}'::jsonb,
         '{}'::jsonb, '[{"id":"assess","kind":"agent","label":"Assess","status":"done","costUsd":100}]'::jsonb,
         'complete', NULL, '2025-12-31T23:59:00Z', '2026-01-01T00:01:00Z')
    `);
    const observation = await store.createSolutionObservation(
      deployment.id,
      ORG_A,
      {
        windowStart: start,
        windowEnd: end,
        claimedMetricValue: 10,
        claimLabel: '30+ DPD',
        estimatedMinutesSavedPerRun: 30,
        estimatedLoadedCostPerHour: 50,
        evidenceLinks: ['/governance/evidence/window-1'],
      },
      'analyst@test.local',
    );
    assert.deepEqual(
      observation.runIds,
      runIds.slice(0, 2),
      'a run that started before activation is never promoted into post-adoption evidence',
    );
    assert.equal(observation.runsCompleted, 2);
    assert.equal(observation.actualAiCost, 25);
    assert.equal(observation.estimatedRoi.netValue, 25);
    assert.equal((await store.listSolutionObservations(deployment.id, ORG_B)).length, 0);
    await assert.rejects(
      store.createSolutionObservation(
        deployment.id,
        ORG_A,
        {
          windowStart: new Date('2026-01-15T00:00:00Z'),
          windowEnd: new Date('2026-01-20T00:00:00Z'),
          claimedMetricValue: 9,
          claimLabel: 'Overlapping claim',
          estimatedMinutesSavedPerRun: 30,
          estimatedLoadedCostPerHour: 50,
          evidenceLinks: ['/governance/evidence/window-2'],
        },
        'analyst@test.local',
      ),
      (error: unknown) => (error as { code?: string }).code === 'duplicate',
    );
    await assert.rejects(
      store.createSolutionObservation(
        deployment.id,
        ORG_A,
        {
          windowStart: new Date(Date.now() + 86_400_000),
          windowEnd: new Date(Date.now() + 172_800_000),
          claimedMetricValue: 9,
          claimLabel: 'Future claim',
          estimatedMinutesSavedPerRun: 30,
          estimatedLoadedCostPerHour: 50,
          evidenceLinks: ['/governance/evidence/window-3'],
        },
        'analyst@test.local',
      ),
      (error: unknown) =>
        (error as { errors?: string[] }).errors?.includes('window end cannot be in the future') ===
        true,
    );

    await assert.rejects(
      store.deleteSolutionBlueprint(created.id, ORG_A),
      (error: unknown) => (error as { code?: string }).code === 'referenced',
      'an active deployment must be retired before its immutable Blueprint can be tombstoned',
    );

    const driftedApp = await updateApp(appId, ORG_A, { pipelineId: null });
    assert.ok(driftedApp);
    await assert.rejects(
      store.assertSolutionRuntimeBinding(driftedApp, ORG_A),
      (error: unknown) => (error as { code?: string }).code === 'runtime-drift',
    );
    const { submitAppRun } = await import('@/lib/adapters/apprun');
    await assert.rejects(
      submitAppRun(
        driftedApp,
        {},
        {
          orgId: ORG_A,
          actor: 'integration@test.local',
          runId: `run_solution_drift_${Date.now()}`,
        },
      ),
      (error: unknown) => (error as { code?: string }).code === 'runtime-drift',
      'the shared dispatch chokepoint blocks drift before every caller can execute',
    );
    assert.equal(await store.hasSolutionDeploymentsForApp(appId, ORG_A), true);
    const restoredApp = await updateApp(appId, ORG_A, { pipelineId });
    assert.ok(restoredApp);
    const paused = await store.updateSolutionDeployment(deployment.id, ORG_A, { status: 'paused' });
    assert.equal(paused?.status, 'paused');
    assert.ok(paused?.pausedAt);
    await assert.rejects(
      submitAppRun(
        restoredApp,
        {},
        {
          orgId: ORG_A,
          actor: 'integration@test.local',
          runId: `run_solution_paused_${Date.now()}`,
        },
      ),
      (error: unknown) => (error as { code?: string }).code === 'paused',
      'a paused solution deployment is a fail-closed execution state',
    );
    const afterPause = new Date((paused?.pausedAt?.valueOf() ?? Date.now()) + 1_000);
    await db.execute(sql`
      INSERT INTO app_runs
        (id, org_id, app_id, status, trigger, input, steps, outcome, started_at, finished_at)
      VALUES
        (${runIds[3]}, ${ORG_A}, ${appId}, 'done', '{"kind":"on-demand"}'::jsonb,
         '{}'::jsonb, '[]'::jsonb, 'should-not-count', ${afterPause}, ${new Date(
           afterPause.valueOf() + 1_000,
         )})`);
    assert.equal(
      (await store.listSolutionDeploymentRuns(deployment.id, ORG_A)).some(
        (run) => run.id === runIds[3],
      ),
      false,
      'runs outside the active interval are excluded from solution evidence',
    );
    const reactivated = await store.updateSolutionDeployment(deployment.id, ORG_A, {
      status: 'active',
    });
    assert.equal(reactivated?.status, 'active');
    assert.equal(reactivated?.pausedAt, null);
    assert.ok(
      (reactivated?.activatedAt.valueOf() ?? 0) >= (paused?.pausedAt?.valueOf() ?? Infinity),
      'reactivation opens a new evidence interval',
    );
    assert.equal(await store.deleteSolutionDeployment(deployment.id, ORG_A), true);
    assert.equal((await store.getSolutionDeployment(deployment.id, ORG_A))?.status, 'retired');
    await assert.rejects(
      store.createSolutionObservation(
        deployment.id,
        ORG_A,
        {
          windowStart: new Date(),
          windowEnd: new Date(Date.now() + 1),
          claimedMetricValue: 8,
          claimLabel: 'Post-retirement claim',
          estimatedMinutesSavedPerRun: 30,
          estimatedLoadedCostPerHour: 50,
          evidenceLinks: ['/governance/evidence/window-4'],
        },
        'analyst@test.local',
      ),
      (error: unknown) => error instanceof Error,
    );

    const redeployment = await store.createSolutionDeployment(ORG_A, {
      blueprintId: created.id,
      blueprintVersion: 2,
      appId,
      status: 'active',
    });
    assert.equal(redeployment.blueprintVersion, 2);
    assert.notEqual(redeployment.id, deployment.id);
    assert.equal(await store.deleteSolutionDeployment(redeployment.id, ORG_A), true);
    assert.equal(await store.deleteSolutionBlueprint(created.id, ORG_A), true);
    assert.equal((await store.listSolutionObservations(deployment.id, ORG_A)).length, 1);
  },
);
