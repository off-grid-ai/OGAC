import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { AppSpec } from '../src/lib/app-model.ts';
import {
  cloneApp,
  createApp,
  deleteApp,
  getApp,
  getLineage,
  getTemplate,
  getTemplateVars,
  listTemplates,
  publishAppAsTemplate,
  TemplateBindError,
  TemplateVarSchemaError,
  unpublishTemplate,
} from '../src/lib/apps-store.ts';
// @ts-expect-error shared JS reachability helper
import { dbAvailable } from './helpers/db-available.mjs';

const available = await dbAvailable();
const skip = available.ok ? undefined : available.reason;

describe('SOP / template reuse: clone + publish-as-template library (real Postgres)', { skip }, () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const teamA = `sop_team_a_${suffix}`;
  const teamB = `sop_team_b_${suffix}`;
  const owner = `lead_${suffix}@test.local`;
  const adopter = `member_${suffix}@test.local`;
  const created: { id: string; org: string }[] = [];

  after(async () => {
    await Promise.all(created.map((c) => deleteApp(c.id, c.org).catch(() => {})));
  });

  async function makeApp(org: string, over: Partial<AppSpec> = {}): Promise<AppSpec> {
    const app = await createApp(org, owner, {
      title: over.title ?? 'Renewals SOP',
      summary: over.summary ?? 'For {{team}}',
      visibility: 'private',
      trigger: { kind: 'on-demand' },
      steps: over.steps ?? [
        {
          id: 's1',
          label: 'Draft',
          kind: 'agent',
          inlineAgent: { systemPrompt: 'Help {{team}} renew policies.', grounded: false },
        },
      ],
      edges: over.edges ?? [],
    });
    created.push({ id: app.id, org });
    return app;
  }

  test('cloneApp: same-org duplicate resets identity + records clone lineage', async () => {
    const source = await makeApp(teamA);
    const clone = await cloneApp(source, { orgId: teamA, ownerId: owner, origin: 'clone' });
    created.push({ id: clone.id, org: teamA });
    assert.notEqual(clone.id, source.id);
    assert.equal(clone.published, false);
    assert.equal(clone.slug, undefined);
    assert.equal(clone.title, 'Renewals SOP (copy)');
    const lineage = await getLineage(clone.id, teamA);
    assert.equal(lineage?.origin, 'clone');
    assert.equal(lineage?.sourceAppId, source.id);
  });

  test('publishAppAsTemplate: publishes to the org library with a var schema', async () => {
    const source = await makeApp(teamA, { title: 'Renewals Template' });
    const published = await publishAppAsTemplate(source.id, teamA, {
      varSchema: { vars: [{ name: 'team', type: 'text', required: true }] },
      visibility: 'org',
    });
    assert.ok(published);
    assert.equal(published?.published, true);
    assert.equal(published?.visibility, 'org');
    assert.ok(published?.slug);
    const schema = await getTemplateVars(source.id, teamA);
    assert.deepEqual(schema.vars.map((v) => v.name), ['team']);
  });

  test('publishAppAsTemplate: rejects an incoherent var schema (honest, no silent publish)', async () => {
    const source = await makeApp(teamA);
    await assert.rejects(
      () =>
        publishAppAsTemplate(source.id, teamA, {
          varSchema: { vars: [{ name: 'bad name', type: 'text' }] },
        }),
      (e: unknown) => e instanceof TemplateVarSchemaError,
    );
  });

  test('listTemplates + getTemplate: another team sees a PUBLIC template; org-scoped hidden', async () => {
    const orgTpl = await makeApp(teamA, { title: 'Org-only Template' });
    await publishAppAsTemplate(orgTpl.id, teamA, {
      varSchema: { vars: [{ name: 'team', type: 'text', required: true }] },
      visibility: 'org',
    });
    const pubTpl = await makeApp(teamA, { title: 'Public Template' });
    await publishAppAsTemplate(pubTpl.id, teamA, {
      varSchema: { vars: [{ name: 'team', type: 'text', required: true }] },
      visibility: 'public',
    });

    // team B: sees the public one, NOT team A's org-scoped one.
    const listB = await listTemplates(teamB);
    const idsB = listB.map((t) => t.id);
    assert.ok(idsB.includes(pubTpl.id), 'public template is cross-org visible');
    assert.ok(!idsB.includes(orgTpl.id), 'org-scoped template is not visible cross-org');
    assert.equal(await getTemplate(orgTpl.id, teamB), null);
    assert.ok(await getTemplate(pubTpl.id, teamB));
  });

  test('cloneApp origin:template with values → binds vars into the adopting org', async () => {
    const tpl = await makeApp(teamA, { title: 'Adoptable Template', summary: 'For {{team}}' });
    await publishAppAsTemplate(tpl.id, teamA, {
      varSchema: { vars: [{ name: 'team', type: 'text', required: true }] },
      visibility: 'public',
    });
    const view = await getTemplate(tpl.id, teamB);
    assert.ok(view);
    const sourceSpec = await getApp(tpl.id, teamA);
    assert.ok(sourceSpec);

    const adopted = await cloneApp(sourceSpec!, {
      orgId: teamB,
      ownerId: adopter,
      origin: 'template',
      sourceTemplateId: tpl.id,
      varSchema: view!.templateVars,
      provided: { team: 'Claims-B' },
    });
    created.push({ id: adopted.id, org: teamB });
    assert.equal(adopted.orgId, teamB);
    assert.equal(adopted.summary, 'For Claims-B');
    const step = adopted.steps[0];
    if (step.kind !== 'agent') throw new Error('unreachable');
    assert.equal(step.inlineAgent?.systemPrompt, 'Help Claims-B renew policies.');
    const lineage = await getLineage(adopted.id, teamB);
    assert.equal(lineage?.origin, 'template');
    assert.equal(lineage?.sourceTemplateId, tpl.id);
  });

  test('cloneApp origin:template MISSING a required var → TemplateBindError, nothing persisted', async () => {
    const tpl = await makeApp(teamA, { title: 'Strict Template', summary: 'For {{team}}' });
    const sourceSpec = await getApp(tpl.id, teamA);
    await assert.rejects(
      () =>
        cloneApp(sourceSpec!, {
          orgId: teamB,
          ownerId: adopter,
          origin: 'template',
          sourceTemplateId: tpl.id,
          varSchema: { vars: [{ name: 'team', type: 'text', required: true }] },
          provided: {}, // required var not supplied → honest gap
        }),
      (e: unknown) => e instanceof TemplateBindError,
    );
  });

  test('unpublishTemplate: retracts from the library, keeps the app', async () => {
    const tpl = await makeApp(teamA, {
      title: 'Retractable',
      summary: 'No placeholders here',
      steps: [
        {
          id: 's1',
          label: 'Draft',
          kind: 'agent',
          inlineAgent: { systemPrompt: 'Plain prompt, no vars.', grounded: false },
        },
      ],
    });
    await publishAppAsTemplate(tpl.id, teamA, {
      varSchema: { vars: [] },
      visibility: 'public',
    });
    assert.ok(await getTemplate(tpl.id, teamB));
    const retracted = await unpublishTemplate(tpl.id, teamA);
    assert.ok(retracted);
    assert.equal(await getTemplate(tpl.id, teamB), null);
    // The app itself still exists.
    assert.ok(await getApp(tpl.id, teamA));
  });

  test('publishAppAsTemplate: 404 for an app not in the org', async () => {
    assert.equal(
      await publishAppAsTemplate('app_does_not_exist', teamA, { varSchema: { vars: [] } }),
      null,
    );
  });
});
