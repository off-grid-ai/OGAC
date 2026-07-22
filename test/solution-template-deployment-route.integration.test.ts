import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';
import { prepareSolutionSchema } from './support/solution-schema.mjs';

const dbUp = await dbReachable();
const previousDatabaseUrl = process.env.DATABASE_URL;
const prepared = dbUp ? await prepareSolutionSchema('template_deploy') : null;
if (prepared) process.env.DATABASE_URL = prepared.databaseUrl;
after(async () => {
  await prepared?.cleanup();
  restore('DATABASE_URL', previousDatabaseUrl);
});

test(
  'an authenticated user deploys a registered template into one governed App and failed attempts leave no draft',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const suffix = `${process.pid}_${Date.now()}`;
    const orgId = `solution_deploy_${suffix}`;
    const token = `solution-deploy-token-${suffix}`;
    const previous = {
      org: process.env.OFFGRID_ORG,
      token: process.env.OFFGRID_ADMIN_TOKEN,
      authSecret: process.env.AUTH_SECRET,
    };
    process.env.OFFGRID_ORG = orgId;
    process.env.OFFGRID_ADMIN_TOKEN = token;
    process.env.AUTH_SECRET = `solution-deploy-auth-secret-${suffix}`;

    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    const { createConnector } = await import('@/lib/store');
    const { createDomain } = await import('@/lib/data-domains-store');
    const { createPipeline } = await import('@/lib/pipelines');
    const { createApp, getApp, getLineage, publishAppAsTemplate } =
      await import('@/lib/apps-store');
    const { createSolutionBlueprint } = await import('@/lib/solution-blueprints-store');
    const route = await import('../src/app/api/v1/solution-blueprints/[id]/deploy/route.ts');

    t.after(async () => {
      await db.execute(sql`DELETE FROM solution_observations WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM solution_deployments WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM solution_blueprint_versions WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM solution_blueprints WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM solution_blueprint_seed_state WHERE org_id = ${orgId}`);
      await db
        .execute(sql`DELETE FROM audit_events_v2 WHERE org = ${orgId}`)
        .catch(() => undefined);
      await db.execute(sql`DELETE FROM app_runs WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM apps WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM data_domains WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM pipeline_versions WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM pipelines WHERE org_id = ${orgId}`);
      await db.execute(sql`DELETE FROM connectors WHERE org_id = ${orgId}`);
      restore('OFFGRID_ORG', previous.org);
      restore('OFFGRID_ADMIN_TOKEN', previous.token);
      restore('AUTH_SECRET', previous.authSecret);
    });

    const connector = await createConnector({
      name: 'Collections CRM',
      type: 'rest',
      endpoint: 'http://127.0.0.1:18080',
      auth: 'bearer',
      orgId,
    });
    const domain = await createDomain(
      {
        label: 'loan accounts',
        aliases: ['loans'],
        connectorId: connector.id,
        resource: 'accounts',
      },
      orgId,
    );
    const pipeline = await createPipeline(
      {
        id: `pl_solution_deploy_${suffix}`,
        name: 'Collections intervention',
        status: 'published',
        dataAllowlist: ['loan accounts'],
      },
      'platform-owner@test.local',
      orgId,
    );
    const source = await createApp(orgId, 'template-author@test.local', {
      title: 'Collections intervention template',
      summary: 'Prioritise and contact an at-risk borrower.',
      visibility: 'org',
      pipelineId: pipeline.id,
      published: false,
      trigger: { kind: 'on-demand' },
      steps: [
        { id: 'read', kind: 'connector-query', label: 'Read loans', domain: domain.label },
        {
          id: 'assess',
          kind: 'agent',
          label: 'Assess risk',
          inlineAgent: { systemPrompt: 'Assess delinquency risk.', grounded: true },
        },
        { id: 'approve', kind: 'human', label: 'Approve customer contact' },
        {
          id: 'act',
          kind: 'action',
          label: 'Create CRM follow-up',
          actionId: 'crm.create-task',
          connectorId: connector.id,
          command: {
            subject: 'Contact at-risk borrower',
            useCase: 'lender-delinquency',
            kind: 'call',
            accountId: 'acct_101',
          },
          approvalStepId: 'approve',
        },
        { id: 'report', kind: 'output', label: 'Record decision', sink: 'report' },
      ],
      edges: [
        { from: 'read', to: 'assess' },
        { from: 'assess', to: 'approve' },
        { from: 'approve', to: 'act' },
        { from: 'act', to: 'report' },
      ],
    });
    await publishAppAsTemplate(source.id, orgId, {
      varSchema: { vars: [] },
      visibility: 'org',
    });
    const blueprint = await createSolutionBlueprint(
      orgId,
      {
        title: 'Collections cure-rate accelerator',
        summary: 'Intervene before accounts roll forward.',
        industry: 'Lending',
        process: 'Collections',
        businessOwner: 'Head of Collections',
        requiredDataDomains: [domain.label],
        requiredCapabilities: ['grounded-inference', 'human-approval', 'report-output'],
        requiredPipelineName: pipeline.name,
        sourceTemplateKey: source.id,
        adoptable: false,
        outcome: {
          metricName: '30+ DPD',
          metricUnit: '%',
          direction: 'decrease',
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
        proof: { status: 'unverified', summary: '', evidenceLinks: [] },
      },
      'solution-author@test.local',
    );

    const unauthenticated = await route.POST(
      request('POST', token, {}, false),
      context(blueprint.id),
    );
    assert.equal(unauthenticated.status, 401);

    const appCountBeforeFailure = await countApps(db, sql, orgId);
    const denied = await route.POST(
      request('POST', token, {
        blueprintVersion: blueprint.currentVersion,
        templateId: source.id,
        pipelineId: 'pipeline_not_visible',
        actionConnectorId: connector.id,
        values: {},
      }),
      context(blueprint.id),
    );
    assert.equal(denied.status, 422);
    assert.equal((await denied.json()).code, 'capability-denied');
    assert.equal(await countApps(db, sql, orgId), appCountBeforeFailure);

    const response = await route.POST(
      request('POST', token, {
        blueprintVersion: blueprint.currentVersion,
        templateId: source.id,
        pipelineId: pipeline.id,
        title: 'North region collections',
        actionConnectorId: connector.id,
        values: {},
      }),
      context(blueprint.id),
    );
    assert.equal(response.status, 201);
    const { receipt } = (await response.json()) as {
      receipt: {
        deploymentId: string;
        appId: string;
        blueprintId: string;
        blueprintVersion: number;
        templateId: string;
        pipelineId: string;
        status: string;
        appHref: string;
        appTitle: string;
        requirements: {
          dataDomains: string[];
          actions: Array<{
            actionId: string;
            connectorId: string;
            approvalStepId: string;
          }>;
        };
      };
    };
    assert.equal(receipt.blueprintId, blueprint.id);
    assert.equal(receipt.blueprintVersion, blueprint.currentVersion);
    assert.equal(receipt.templateId, source.id);
    assert.equal(receipt.pipelineId, pipeline.id);
    assert.equal(receipt.status, 'active');
    assert.equal(receipt.appTitle, 'North region collections');
    assert.equal(receipt.appHref, `/solutions/apps/${encodeURIComponent(receipt.appId)}`);
    assert.deepEqual(receipt.requirements.dataDomains, [domain.label]);
    assert.deepEqual(receipt.requirements.actions, [
      {
        stepId: 'act',
        label: 'Create CRM follow-up',
        actionId: 'crm.create-task',
        connectorId: connector.id,
        approvalStepId: 'approve',
      },
    ]);

    const deployedApp = await getApp(receipt.appId, orgId);
    assert.ok(deployedApp);
    assert.equal(deployedApp.pipelineId, pipeline.id);
    assert.equal(deployedApp.published, true);
    assert.equal(
      deployedApp.steps.find((step) => step.kind === 'action')?.connectorId,
      connector.id,
    );
    assert.equal((await getLineage(receipt.appId, orgId))?.sourceTemplateId, source.id);
    const persisted = await db.execute(sql`
      SELECT app_id, blueprint_id, blueprint_version, pipeline_id, status
      FROM solution_deployments
      WHERE id = ${receipt.deploymentId} AND org_id = ${orgId}`);
    assert.deepEqual(persisted.rows[0], {
      app_id: receipt.appId,
      blueprint_id: blueprint.id,
      blueprint_version: blueprint.currentVersion,
      pipeline_id: pipeline.id,
      status: 'active',
    });
  },
);

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function request(
  method: string,
  token: string,
  body: Record<string, unknown>,
  authenticated = true,
): Request {
  return new Request('http://console.local/api/v1/solution-blueprints/unused/deploy', {
    method,
    headers: {
      ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function countApps(
  db: { execute(query: unknown): Promise<{ rows: Record<string, unknown>[] }> },
  sql: typeof import('drizzle-orm').sql,
  orgId: string,
): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*)::int AS count FROM apps WHERE org_id = ${orgId}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
