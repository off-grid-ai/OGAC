import assert from 'node:assert/strict';
import test from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

const dbUp = await dbReachable();
const TOKEN = 'app-capability-selection-route-test';

function request(path: string, method: 'POST' | 'PATCH', body: unknown): Request {
  return new Request(`http://console.local${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test(
  'App POST and PATCH persist allowed selections and reject absent or cross-tenant refs first',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const orgId = `app_selection_a_${suffix}`;
    const otherOrgId = `app_selection_b_${suffix}`;
    const allowedPipelineId = `pl_allowed_${suffix}`;
    const draftPipelineId = `pl_draft_${suffix}`;
    const otherPipelineId = `pl_other_${suffix}`;
    const missingPipelineId = `pl_hidden_${suffix}`;
    const previous = {
      org: process.env.OFFGRID_ORG,
      token: process.env.OFFGRID_ADMIN_TOKEN,
      authSecret: process.env.AUTH_SECRET,
    };
    process.env.OFFGRID_ORG = orgId;
    process.env.OFFGRID_ADMIN_TOKEN = TOKEN;
    process.env.AUTH_SECRET = 'app-capability-selection-route-secret-32-characters';

    const { createPipeline, deletePipeline } = await import('../src/lib/pipelines.ts');
    const { createApp, deleteApp, getApp, listApps } = await import('../src/lib/apps-store.ts');
    const collectionRoute = await import('../src/app/api/v1/admin/apps/route.ts');
    const itemRoute = await import('../src/app/api/v1/admin/apps/[id]/route.ts');

    await createPipeline(
      { id: allowedPipelineId, name: 'Allowed decisions', status: 'published' },
      'service@offgrid.local',
      orgId,
    );
    await createPipeline(
      { id: otherPipelineId, name: 'Other tenant decisions', status: 'published' },
      'owner@other.test',
      otherOrgId,
    );
    await createPipeline(
      { id: draftPipelineId, name: 'Draft decisions', status: 'draft' },
      'service@offgrid.local',
      orgId,
    );
    const legacyDraftApp = await createApp(orgId, 'service@offgrid.local', {
      title: 'Legacy draft selection',
      summary: 'Must be reconfigured before activation.',
      visibility: 'private',
      pipelineId: draftPipelineId,
      trigger: { kind: 'on-demand' },
      steps: [{ id: 'review', label: 'Manager review', kind: 'human' }],
      edges: [],
    });
    const otherTenantApp = await createApp(otherOrgId, 'owner@other.test', {
      title: 'Other tenant App',
      summary: 'Must remain hidden.',
      visibility: 'private',
      trigger: { kind: 'on-demand' },
      steps: [{ id: 'review', label: 'Review', kind: 'human' }],
      edges: [],
    });

    t.after(async () => {
      for (const app of await listApps(orgId)) await deleteApp(app.id, orgId).catch(() => undefined);
      await deleteApp(otherTenantApp.id, otherOrgId).catch(() => undefined);
      await deletePipeline(allowedPipelineId, orgId).catch(() => undefined);
      await deletePipeline(draftPipelineId, orgId).catch(() => undefined);
      await deletePipeline(otherPipelineId, otherOrgId).catch(() => undefined);
      restore('OFFGRID_ORG', previous.org);
      restore('OFFGRID_ADMIN_TOKEN', previous.token);
      restore('AUTH_SECRET', previous.authSecret);
    });

    const createBody = {
      title: 'Governed follow-up',
      summary: 'Keeps a person in control.',
      visibility: 'private',
      pipelineId: allowedPipelineId,
      trigger: { kind: 'on-demand' },
      steps: [{ id: 'review', label: 'Manager review', kind: 'human' }],
      edges: [],
    };
    const createdResponse = await collectionRoute.POST(
      request('/api/v1/admin/apps', 'POST', createBody),
    );
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as { id: string; pipelineId: string | null };
    assert.equal(created.pipelineId, allowedPipelineId);
    assert.equal((await getApp(created.id, orgId))?.pipelineId, allowedPipelineId);

    for (const unavailableId of ['missing_app', otherTenantApp.id]) {
      const notFound = await itemRoute.PATCH(
        request(`/api/v1/admin/apps/${unavailableId}`, 'PATCH', {
          pipelineId: otherPipelineId,
        }),
        { params: Promise.resolve({ id: unavailableId }) },
      );
      assert.equal(notFound.status, 404);
      assert.deepEqual(await notFound.json(), { error: 'not found' });
    }

    const publishBlocked = await itemRoute.PATCH(
      request(`/api/v1/admin/apps/${legacyDraftApp.id}`, 'PATCH', { publish: true }),
      { params: Promise.resolve({ id: legacyDraftApp.id }) },
    );
    assert.equal(publishBlocked.status, 422);
    const publishBody = await publishBlocked.json();
    assert.match(publishBody.errors[0], /governed pipeline/);
    assert.doesNotMatch(JSON.stringify(publishBody), new RegExp(draftPipelineId));
    assert.equal((await getApp(legacyDraftApp.id, orgId))?.published, false);

    const absentCreate = await collectionRoute.POST(
      request('/api/v1/admin/apps', 'POST', {
        ...createBody,
        title: 'Must not persist',
        pipelineId: missingPipelineId,
      }),
    );
    assert.equal(absentCreate.status, 422);
    const absentBody = await absentCreate.json();
    assert.match(absentBody.errors[0], /governed pipeline/);
    assert.doesNotMatch(JSON.stringify(absentBody), new RegExp(missingPipelineId));
    assert.equal(
      (await listApps(orgId)).some((app) => app.title === 'Must not persist'),
      false,
    );

    const crossTenantPatch = await itemRoute.PATCH(
      request(`/api/v1/admin/apps/${created.id}`, 'PATCH', {
        pipelineId: otherPipelineId,
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    assert.equal(crossTenantPatch.status, 422);
    const crossTenantBody = await crossTenantPatch.json();
    assert.match(crossTenantBody.errors[0], /governed pipeline/);
    assert.doesNotMatch(JSON.stringify(crossTenantBody), new RegExp(otherPipelineId));
    assert.equal((await getApp(created.id, orgId))?.pipelineId, allowedPipelineId);

    const allowedPatch = await itemRoute.PATCH(
      request(`/api/v1/admin/apps/${created.id}`, 'PATCH', { pipelineId: null }),
      { params: Promise.resolve({ id: created.id }) },
    );
    assert.equal(allowedPatch.status, 200);
    assert.equal((await getApp(created.id, orgId))?.pipelineId, null);
  },
);
