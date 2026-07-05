import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAgentPayload,
  buildTemplatePayload,
  composeSystemPrompt,
  deriveTitle,
  getTemplate,
  GUIDED_TEMPLATES,
  planAssistant,
  suggestModel,
  validateBuilderInput,
  type NormalizedInput,
  type PlanContext,
} from '../src/lib/studio-builder.ts';

// PURE unit tests for the non-technical Studio builder logic — no DB, no gateway, no browser.

test('deriveTitle takes the first words and never returns empty', () => {
  assert.equal(
    deriveTitle('Summarise every support ticket and tag it by product area'),
    'Summarise every support ticket and tag',
  );
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
  assert.deepEqual(r.value!.collectionIds, []);
  assert.equal(r.value!.title, 'Answer HR policy questions for employees');
});

test('validateBuilderInput honors explicit values + filters bad ids + dedupes', () => {
  const r = validateBuilderInput({
    goal: 'Look up client account details from the CRM when asked',
    title: 'CRM Helper',
    grounded: false,
    visibility: 'org',
    toolIds: ['tool_crm', 42 as never, null as never, 'tool_web', 'tool_crm'],
  });
  assert.equal(r.value!.title, 'CRM Helper');
  assert.equal(r.value!.grounded, false);
  assert.equal(r.value!.visibility, 'org');
  assert.deepEqual(r.value!.toolIds, ['tool_crm', 'tool_web'], 'non-string/dupe ids dropped');
});

test('validateBuilderInput: collection ids are deduped + cleaned', () => {
  const r = validateBuilderInput({
    goal: 'Answer questions from these collections faithfully',
    collectionIds: ['col_a', 'col_a', '', 7 as never],
  });
  assert.deepEqual(r.value!.collectionIds, ['col_a']);
});

test('validateBuilderInput: picking collections forces grounding on', () => {
  const r = validateBuilderInput({
    goal: 'General brainstorming assistant, no knowledge needed',
    grounded: false,
    collectionIds: ['col_kb'],
  });
  assert.equal(r.value!.grounded, true, 'choosing data implies grounding');
});

test('validateBuilderInput: template supplies the grounding default when unset', () => {
  const r = validateBuilderInput({ goal: 'Summarize and tag whatever I paste', templateId: 'summarize-and-tag' });
  assert.equal(r.value!.grounded, false, 'summarize-and-tag template defaults grounding off');
  const r2 = validateBuilderInput({ goal: 'Answer support tickets from docs', templateId: 'support-answer' });
  assert.equal(r2.value!.grounded, true, 'support-answer template defaults grounding on');
});

test('guided templates exist and are resolvable by id', () => {
  assert.ok(GUIDED_TEMPLATES.length >= 4);
  for (const id of ['summarize-and-tag', 'kyc-check', 'support-answer', 'sop-synth']) {
    assert.ok(getTemplate(id), `template ${id} resolves`);
  }
  assert.equal(getTemplate('nope'), undefined);
});

test('composeSystemPrompt: grounded prompt cites sources and lists knowledge + skills', () => {
  const p = composeSystemPrompt('Answer billing questions', true, ['CRM Lookup'], ['Billing KB']);
  assert.match(p, /^Answer billing questions/);
  assert.match(p, /CRM Lookup/);
  assert.match(p, /Billing KB/);
  assert.match(p, /cite the specific source/);
  assert.doesNotMatch(p, /general capabilities/);
});

test('composeSystemPrompt: ungrounded prompt omits the source contract', () => {
  const p = composeSystemPrompt('Brainstorm campaign ideas', false, [], []);
  assert.match(p, /general capabilities/);
  assert.doesNotMatch(p, /cite the specific source/);
});

test('suggestModel: takes the org default, never invents one', () => {
  assert.equal(suggestModel(['gemma-local', 'gpt-4o']), 'gemma-local');
  assert.equal(suggestModel([]), '', 'empty allow-list → platform default');
  assert.equal(suggestModel(undefined), '');
});

const norm = (over: Partial<NormalizedInput> = {}): NormalizedInput => ({
  goal: 'Answer HR questions from our policy documents',
  title: 'HR Assistant',
  templateId: '',
  toolIds: [],
  collectionIds: [],
  grounded: true,
  visibility: 'private',
  ...over,
});

const ctx: PlanContext = {
  skills: [
    { id: 'tool_crm', name: 'CRM Lookup' },
    { id: 'tool_web', name: 'Web Search' },
  ],
  collections: [
    { id: 'col_hr', name: 'HR Policies' },
    { id: 'col_fin', name: 'Finance' },
  ],
  allowedModels: ['gemma-local', 'gpt-4o'],
};

test('planAssistant: resolves skills + collections and drops unknown ids', () => {
  const plan = planAssistant(
    norm({ toolIds: ['tool_crm', 'ghost_tool'], collectionIds: ['col_hr', 'ghost_col'] }),
    ctx,
  );
  assert.deepEqual(plan.skillList, ['tool_crm'], 'unknown skill id dropped');
  assert.deepEqual(plan.skillNames, ['CRM Lookup']);
  assert.deepEqual(plan.collectionIds, ['col_hr'], 'unknown collection id dropped');
  assert.deepEqual(plan.collectionNames, ['HR Policies']);
  assert.equal(plan.suggestedModel, 'gemma-local');
  assert.match(plan.systemPrompt, /HR Policies/);
  assert.match(plan.systemPrompt, /CRM Lookup/);
});

test('planAssistant: ungrounded plan produces an ungrounded prompt', () => {
  const plan = planAssistant(norm({ grounded: false, collectionIds: [] }), ctx);
  assert.equal(plan.grounded, false);
  assert.match(plan.systemPrompt, /general capabilities/);
});

test('buildAgentPayload: maps generated prompt→instructions, resolved skills→tools, model through', () => {
  const plan = planAssistant(norm({ toolIds: ['tool_web'] }), ctx);
  const p = buildAgentPayload(plan);
  assert.equal(p.systemPrompt, plan.systemPrompt);
  assert.deepEqual(p.tools, ['tool_web']);
  assert.equal(p.grounded, true);
  assert.equal(p.model, 'gemma-local');
  assert.equal(p.role, 'Studio');
  assert.equal(p.trigger, 'on-demand');
});

test('buildTemplatePayload: agent node + data nodes; deploy only when public', () => {
  const plan = planAssistant(norm({ collectionIds: ['col_hr'], visibility: 'public' }), ctx);
  const t = buildTemplatePayload('ag_123', plan);
  assert.deepEqual(
    t.workflow.nodeIds,
    ['agent:ag_123', 'data:col_hr'],
    'workflow runs the agent and records its data source',
  );
  assert.equal(t.deploy, true, 'public → deploy (mints /app/<slug>)');
  assert.equal(t.visibility, 'public');
  assert.equal(t.prompt, plan.systemPrompt, 'template stores the generated prompt, not raw goal');

  const priv = buildTemplatePayload('ag_9', planAssistant(norm({ visibility: 'private' }), ctx));
  assert.equal(priv.deploy, false, 'private → not deployed');
  assert.deepEqual(priv.workflow.nodeIds, ['agent:ag_9'], 'no data nodes when none chosen');
});
