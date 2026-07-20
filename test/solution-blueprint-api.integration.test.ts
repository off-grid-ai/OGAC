import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';
import { prepareSolutionSchema } from './support/solution-schema.mjs';

const ADMIN_TOKEN = 'solution-api-integration-token';
const ORG = 'test-int-solution-api';
const dbUp = await dbReachable();
const previousDatabaseUrl = process.env.DATABASE_URL;
const prepared = dbUp ? await prepareSolutionSchema('api') : null;
if (prepared) process.env.DATABASE_URL = prepared.databaseUrl;
after(async () => {
  await prepared?.cleanup();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

function request(method: string, body?: unknown, authenticated = true): Request {
  return new Request('http://console.local/api/v1/admin/solution-blueprints', {
    method,
    headers: {
      ...(authenticated ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {}),
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const body = {
  title: 'Collections intervention',
  summary: 'A governed collections workflow.',
  industry: 'Lending',
  process: 'Collections',
  businessOwner: 'Head of Collections',
  requiredDataDomains: ['loan accounts'],
  requiredCapabilities: ['grounded-inference', 'human-approval', 'report-output'],
  requiredPipelineName: 'Collections intervention',
  sourceTemplateKey: 'collections-intervention',
  adoptable: true,
  outcome: {
    metricName: '30+ DPD',
    metricUnit: '%',
    direction: 'decrease',
    measurementWindow: '30 days',
    baseline: { value: 12, label: 'Baseline' },
    target: { value: 9, label: 'Target' },
    measured: null,
    roi: {
      currency: 'USD',
      annualBenefit: 100,
      implementationCost: 10,
      annualOperatingCost: 5,
      rationale: 'Avoided loss.',
    },
  },
  proof: { status: 'unverified', summary: '', evidenceLinks: [] },
};

test('solution API enforces authentication and rejects invalid enums instead of defaulting', async () => {
  const previous = process.env.OFFGRID_ADMIN_TOKEN;
  process.env.OFFGRID_ADMIN_TOKEN = ADMIN_TOKEN;
  const { POST } = await import('../src/app/api/v1/admin/solution-blueprints/route.ts');
  try {
    const unauthorized = await POST(request('POST', body, false));
    assert.equal(unauthorized.status, 401);

    const invalid = await POST(
      request('POST', { ...body, outcome: { ...body.outcome, direction: 'sideways' } }),
    );
    assert.equal(invalid.status, 422);
    assert.match(JSON.stringify(await invalid.json()), /direction must be increase or decrease/);

    const invalidAdoptability = await POST(request('POST', { ...body, adoptable: 'yes' }));
    assert.equal(invalidAdoptability.status, 422);
    assert.match(
      JSON.stringify(await invalidAdoptability.json()),
      /adoptable must be true or false/,
    );
  } finally {
    if (previous === undefined) delete process.env.OFFGRID_ADMIN_TOKEN;
    else process.env.OFFGRID_ADMIN_TOKEN = previous;
  }
});

test(
  'authorized Blueprint creation persists immutable v1 and emits an attributed audit event',
  {
    skip: dbUp ? false : SKIP_MESSAGE,
  },
  async (t) => {
    const priorToken = process.env.OFFGRID_ADMIN_TOKEN;
    const priorOrg = process.env.OFFGRID_ORG;
    process.env.OFFGRID_ADMIN_TOKEN = ADMIN_TOKEN;
    process.env.OFFGRID_ORG = ORG;
    const { POST } = await import('../src/app/api/v1/admin/solution-blueprints/route.ts');
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`DELETE FROM audit_events_v2 WHERE org = ${ORG}`).catch(() => undefined);
    let createdId = '';
    t.after(async () => {
      await db.execute(sql`DELETE FROM solution_blueprint_versions WHERE org_id = ${ORG}`);
      await db.execute(sql`DELETE FROM solution_blueprints WHERE org_id = ${ORG}`);
      await db.execute(sql`DELETE FROM solution_blueprint_seed_state WHERE org_id = ${ORG}`);
      await db.execute(sql`DELETE FROM audit_events_v2 WHERE org = ${ORG}`).catch(() => undefined);
      if (priorToken === undefined) delete process.env.OFFGRID_ADMIN_TOKEN;
      else process.env.OFFGRID_ADMIN_TOKEN = priorToken;
      if (priorOrg === undefined) delete process.env.OFFGRID_ORG;
      else process.env.OFFGRID_ORG = priorOrg;
    });

    const response = await POST(request('POST', body));
    assert.equal(response.status, 201);
    const created = (await response.json()) as { id: string; currentVersion: number };
    createdId = created.id;
    assert.equal(created.currentVersion, 1);
    const persisted = await db.execute(sql`
      SELECT b.current_version, v.created_by
      FROM solution_blueprints b
      JOIN solution_blueprint_versions v
        ON v.blueprint_id = b.id AND v.version = b.current_version
      WHERE b.id = ${createdId} AND b.org_id = ${ORG}`);
    assert.equal(persisted.rows[0]?.current_version, 1);
    assert.equal(persisted.rows[0]?.created_by, 'service@offgrid.local');

    let audit: { rows: Record<string, unknown>[] } = { rows: [] };
    for (let attempt = 0; attempt < 20 && audit.rows.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      audit = await db
        .execute(
          sql`
          SELECT actor_id, action, resource, outcome
          FROM audit_events_v2
          WHERE org = ${ORG}
            AND action = 'solution-blueprint.create'
            AND resource = ${`solution-blueprint:${createdId}`}`,
        )
        .catch(() => ({ rows: [] }));
    }
    assert.deepEqual(audit.rows[0], {
      actor_id: 'service@offgrid.local',
      action: 'solution-blueprint.create',
      resource: `solution-blueprint:${createdId}`,
      outcome: 'ok',
    });
  },
);
