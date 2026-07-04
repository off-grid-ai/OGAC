import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAgentPayload,
  buildTemplatePayload,
  deriveTitle,
  validateBuilderInput,
} from '../src/lib/studio-builder.ts';

// PURE unit tests for the non-technical Studio builder logic — no DB, no gateway, no browser.

test('deriveTitle takes the first words and never returns empty', () => {
  assert.equal(deriveTitle('Summarise every support ticket and tag it by product area'), 'Summarise every support ticket and tag');
  assert.equal(deriveTitle('   '), 'New assistant');
  assert.equal(deriveTitle('Draft renewal emails.'), 'Draft renewal emails');
});

test('validateBuilderInput rejects an empty/too-short goal', () => {
  assert.equal(validateBuilderInput(null).ok, false);
  assert.equal(validateBuilderInput({ goal: 'too short' }).ok, false);
  assert.equal(validateBuilderInput({ goal: '   ' }).ok, false);
});

test('validateBuilderInput normalizes defaults', () => {
  const r = validateBuilderInput({ goal: 'Answer HR policy questions for employees' });
  assert.equal(r.ok, true);
  assert.equal(r.value!.grounded, true, 'grounded defaults on');
  assert.equal(r.value!.visibility, 'private', 'visibility defaults private');
  assert.deepEqual(r.value!.toolIds, []);
  assert.equal(r.value!.title, 'Answer HR policy questions for employees');
});

test('validateBuilderInput honors explicit values + filters bad tool ids', () => {
  const r = validateBuilderInput({
    goal: 'Look up client account details from the CRM when asked',
    title: 'CRM Helper',
    grounded: false,
    visibility: 'org',
    toolIds: ['tool_crm', 42 as never, null as never, 'tool_web'],
  });
  assert.equal(r.value!.title, 'CRM Helper');
  assert.equal(r.value!.grounded, false);
  assert.equal(r.value!.visibility, 'org');
  assert.deepEqual(r.value!.toolIds, ['tool_crm', 'tool_web'], 'non-string tool ids dropped');
});

test('buildAgentPayload maps the goal→instructions, skills→tools, grounding on', () => {
  const v = validateBuilderInput({
    goal: 'Summarise support tickets and suggest a priority',
    toolIds: ['tool_slack'],
  }).value!;
  const p = buildAgentPayload(v);
  assert.equal(p.systemPrompt, 'Summarise support tickets and suggest a priority');
  assert.deepEqual(p.tools, ['tool_slack']);
  assert.equal(p.grounded, true);
  assert.equal(p.role, 'Studio');
  assert.equal(p.trigger, 'on-demand');
});

test('buildTemplatePayload points a single Agent node at the created agent + deploys only when public', () => {
  const v = validateBuilderInput({ goal: 'Answer billing questions from the knowledge base', visibility: 'public' }).value!;
  const t = buildTemplatePayload('ag_123', v);
  assert.deepEqual(t.workflow.nodeIds, ['agent:ag_123'], 'workflow runs the created agent');
  assert.equal(t.deploy, true, 'public → deploy (mints /app/<slug>)');
  assert.equal(t.visibility, 'public');

  const priv = buildTemplatePayload('ag_9', validateBuilderInput({ goal: 'Internal-only research helper for the team' }).value!);
  assert.equal(priv.deploy, false, 'private → not deployed');
});
