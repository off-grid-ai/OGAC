import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for CONSUMERS-BIND (#166) against a REAL Postgres. Exercises the real write-paths:
//   • apps.pipeline_id persists via createApp/updateApp; listAppsByPipeline scopes by pipeline + org.
//   • chat_projects.pipeline_id persists via createProject; listProjectsByPipeline scopes by pipeline.
//   • org chat-binding governance set/get round-trips; the server-side gate (isChatPipelineAllowed)
//     rejects a pipeline outside the available set.
// Modules self-create their columns via the ensure*Schema nets. Skips (green) when no DB is up.

const ORG = 'test-int-consumers';
const OTHER = 'test-int-consumers-other';
const SUFFIX = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const ALPHA = `pl_alpha_${SUFFIX}`;
const BETA = `pl_beta_${SUFFIX}`;

const dbUp = await dbReachable();

test(
  'app pipeline binding persists + listAppsByPipeline scopes by pipeline and org',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const { createApp, updateApp, getApp, listAppsByPipeline, deleteApp, listApps } =
      await import('@/lib/apps-store');
    const { createPipeline, deletePipeline } = await import('@/lib/pipelines');

    const mkAgent = (title: string, pipelineId: string | null) => ({
      title,
      summary: '',
      visibility: 'private' as const,
      trigger: { kind: 'on-demand' as const },
      steps: [
        { id: 'a', label: title, kind: 'agent' as const, inlineAgent: { systemPrompt: 'x' } },
      ],
      edges: [],
      pipelineId,
    });

    t.after(async () => {
      for (const org of [ORG, OTHER])
        for (const a of await listApps(org)) await deleteApp(a.id, org);
      await deletePipeline(ALPHA, ORG).catch(() => {});
      await deletePipeline(BETA, ORG).catch(() => {});
    });

    await createPipeline({ id: ALPHA, name: 'Alpha', status: 'published' }, 'owner@x.io', ORG);
    await createPipeline({ id: BETA, name: 'Beta', status: 'published' }, 'owner@x.io', ORG);

    const a1 = await createApp(ORG, 'owner@x.io', mkAgent('Bound A', ALPHA));
    const a2 = await createApp(ORG, 'owner@x.io', mkAgent('Bound A2', ALPHA));
    const b1 = await createApp(ORG, 'owner@x.io', mkAgent('Bound B', BETA));
    const unbound = await createApp(ORG, 'owner@x.io', mkAgent('Unbound', null));
    // The composite FK rejects a cross-org binding before list scoping even becomes relevant.
    await assert.rejects(
      () => createApp(OTHER, 'owner@x.io', mkAgent('Other-org Alpha', ALPHA)),
      (error) => (error as Error & { cause?: { code?: string } }).cause?.code === '23503',
    );

    // Persisted round-trip.
    assert.equal((await getApp(a1.id, ORG))?.pipelineId, ALPHA);
    assert.equal((await getApp(unbound.id, ORG))?.pipelineId, null);

    const alpha = await listAppsByPipeline(ALPHA, ORG);
    assert.deepEqual(
      new Set(alpha.map((a) => a.id)),
      new Set([a1.id, a2.id]),
      'only ORG pl_alpha apps',
    );
    const beta = await listAppsByPipeline(BETA, ORG);
    assert.deepEqual(
      beta.map((a) => a.id),
      [b1.id],
    );

    // Re-point via updateApp, then it moves buckets.
    await updateApp(a1.id, ORG, { pipelineId: BETA });
    assert.deepEqual(
      new Set((await listAppsByPipeline(ALPHA, ORG)).map((a) => a.id)),
      new Set([a2.id]),
      'a1 left pl_alpha',
    );
    assert.deepEqual(
      new Set((await listAppsByPipeline(BETA, ORG)).map((a) => a.id)),
      new Set([a1.id, b1.id]),
      'a1 joined pl_beta',
    );

    // Clearing the binding removes it from every pipeline bucket.
    await updateApp(a1.id, ORG, { pipelineId: null });
    assert.equal((await getApp(a1.id, ORG))?.pipelineId, null);
    assert.equal(
      (await listAppsByPipeline(BETA, ORG)).some((a) => a.id === a1.id),
      false,
    );
  },
);

test(
  'chat project pipeline binding persists + listProjectsByPipeline scopes',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const { createProject, getProjectBinding, listProjectsByPipeline, deleteProject } =
      await import('@/lib/chat');
    const USER = 'consumer-test@x.io';
    const ORG = 'default';
    const created: string[] = [];
    t.after(async () => {
      for (const id of created) await deleteProject(USER, id).catch(() => {});
    });

    const p1 = await createProject(USER, ORG, 'Finance chat', '', 'pl_chat1');
    const p2 = await createProject(USER, ORG, 'Ops chat', '', 'pl_chat1');
    const p3 = await createProject(USER, ORG, 'HR chat', '', 'pl_chat2');
    const p4 = await createProject(USER, ORG, 'Ad-hoc', '', null);
    created.push(p1, p2, p3, p4);

    assert.equal((await getProjectBinding(p1))?.pipelineId, 'pl_chat1');
    assert.equal((await getProjectBinding(p4))?.pipelineId, null);

    const c1 = await listProjectsByPipeline('pl_chat1');
    assert.deepEqual(new Set(c1.map((p) => p.id)), new Set([p1, p2]));
    const c2 = await listProjectsByPipeline('pl_chat2');
    assert.deepEqual(
      c2.map((p) => p.id),
      [p3],
    );
    assert.equal((await listProjectsByPipeline('pl_none')).length, 0);
  },
);

test(
  'org chat-binding governance round-trips + gates disallowed picks',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const { getChatBindingGovernance, setChatBindingGovernance } = await import('@/lib/store');
    const { isChatPipelineAllowed } = await import('@/lib/chat-pipeline-policy');

    // Capture + restore the singleton so we don't clobber real settings on a shared DB.
    const before = await getChatBindingGovernance();
    t.after(async () => {
      await setChatBindingGovernance(before, 'test-teardown');
    });

    await setChatBindingGovernance(
      { defaultChatPipelineId: 'pl_workspace', allowlist: ['pl_finance', 'pl_finance', 'pl_hr'] },
      'admin@x.io',
    );
    const gov = await getChatBindingGovernance();
    assert.equal(gov.defaultChatPipelineId, 'pl_workspace');
    assert.deepEqual(gov.allowlist.sort(), ['pl_finance', 'pl_hr'], 'de-duplicated on write');

    // Server-side gate uses the STORED governance: allowed vs rejected.
    assert.equal(isChatPipelineAllowed('pl_finance', gov), true);
    assert.equal(isChatPipelineAllowed('pl_workspace', gov), true, 'default always allowed');
    assert.equal(isChatPipelineAllowed(null, gov), true, 'inherit-default always allowed');
    assert.equal(isChatPipelineAllowed('pl_disallowed', gov), false, 'outside the set → rejected');
  },
);
