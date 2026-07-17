import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

const ORG_A = 'test-int-solution-blueprints-a';
const ORG_B = 'test-int-solution-blueprints-b';
const dbUp = await dbReachable();
async function solutionSchemaReady(): Promise<boolean> {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://offgrid@localhost:5432/offgrid_console',
    connectionTimeoutMillis: 10_000,
  });
  try {
    const result = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'solution_blueprints' AND column_name = 'current_version'`,
    );
    return result.rowCount === 1;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}
const schemaReady = await solutionSchemaReady();

test(
  'versioned adoption enforces the real runtime and retains scoped ROI evidence',
  {
    skip: schemaReady
      ? false
      : dbUp
        ? 'Solution Blueprint migration 0010 is not applied to the local integration database'
        : SKIP_MESSAGE,
  },
  async (t) => {
    const store = await import('@/lib/solution-blueprints-store');
    const { createApp, publishApp, updateApp } = await import('@/lib/apps-store');
    const { createPipeline } = await import('@/lib/pipelines');
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');

    const pipelineId = `pl_solution_${Date.now()}`;
    let appId = '';
    t.after(async () => {
      for (const org of [ORG_A, ORG_B]) {
        await db.execute(sql`DELETE FROM solution_observations WHERE org_id = ${org}`);
        await db.execute(sql`DELETE FROM solution_deployments WHERE org_id = ${org}`);
        await db.execute(sql`DELETE FROM solution_blueprint_versions WHERE org_id = ${org}`);
        await db.execute(sql`DELETE FROM solution_blueprints WHERE org_id = ${org}`);
        await db.execute(sql`DELETE FROM solution_blueprint_seed_state WHERE org_id = ${org}`);
      }
      if (appId) await db.execute(sql`DELETE FROM apps WHERE id = ${appId}`);
      await db.execute(sql`DELETE FROM pipeline_versions WHERE pipeline_id = ${pipelineId}`);
      await db.execute(sql`DELETE FROM pipelines WHERE id = ${pipelineId}`);
    });

    const seedsA = await store.listSolutionBlueprints(ORG_A);
    const seedsB = await store.listSolutionBlueprints(ORG_B);
    assert.equal(seedsA.length, 2);
    assert.equal(seedsB.length, 2);
    assert.ok(seedsA.every((item) => item.proof.status === 'unverified'));
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

    const start = new Date(deployment.activatedAt.valueOf() + 1_000);
    const observation = await store.createSolutionObservation(
      deployment.id,
      ORG_A,
      {
        windowStart: start,
        windowEnd: new Date(start.valueOf() + 86_400_000),
        metricValue: 10,
        metricLabel: '30+ DPD',
        runsCompleted: 20,
        minutesSavedPerRun: 30,
        loadedCostPerHour: 50,
        actualAiCost: 25,
        evidenceLinks: ['/governance/evidence/window-1'],
      },
      'analyst@test.local',
    );
    assert.equal(observation.realizedRoi.netValue, 475);
    assert.equal((await store.listSolutionObservations(deployment.id, ORG_B)).length, 0);

    const driftedApp = await updateApp(appId, ORG_A, { pipelineId: null });
    assert.ok(driftedApp);
    await assert.rejects(
      store.assertSolutionRuntimeBinding(driftedApp, ORG_A),
      (error: unknown) => (error as { code?: string }).code === 'runtime-drift',
    );
    const { submitAppRun } = await import('@/lib/adapters/apprun');
    await assert.rejects(
      submitAppRun(driftedApp, {}, {
        orgId: ORG_A,
        actor: 'integration@test.local',
        runId: `run_solution_drift_${Date.now()}`,
      }),
      (error: unknown) => (error as { code?: string }).code === 'runtime-drift',
      'the shared dispatch chokepoint blocks drift before every caller can execute',
    );
    assert.equal(await store.hasSolutionDeploymentsForApp(appId, ORG_A), true);
    assert.equal(await store.deleteSolutionBlueprint(created.id, ORG_A), true);
    assert.equal((await store.listSolutionObservations(deployment.id, ORG_A)).length, 1);
    assert.equal(await store.deleteSolutionDeployment(deployment.id, ORG_A), true);
    assert.equal((await store.getSolutionDeployment(deployment.id, ORG_A))?.status, 'retired');
  },
);
