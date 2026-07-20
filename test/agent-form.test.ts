import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeTrigger,
  parseCreateInput,
  parseEditPatch,
  validateAgentForm,
} from '../src/lib/agent-form.ts';

test('normalizeTrigger: valid passes through, invalid falls back to on-demand', () => {
  assert.equal(normalizeTrigger('scheduled'), 'scheduled');
  assert.equal(normalizeTrigger('on-call'), 'on-call');
  assert.equal(normalizeTrigger('bogus'), 'on-demand');
  assert.equal(normalizeTrigger(undefined), 'on-demand');
  assert.equal(normalizeTrigger(42), 'on-demand');
});

test('validateAgentForm: flags missing name and instructions', () => {
  assert.deepEqual(validateAgentForm({ name: 'X', systemPrompt: 'do a thing' }), {});
  const errs = validateAgentForm({ name: '  ', systemPrompt: '' });
  assert.ok(errs.name);
  assert.ok(errs.systemPrompt);
});

test('parseCreateInput: full input is trimmed and defaulted', () => {
  const input = parseCreateInput({
    name: '  Renewals  ',
    systemPrompt: '  help  ',
    tools: ['a', 1, 'b'],
    grounded: false,
    trigger: 'observed',
    pipelineId: '  pl_claims  ',
  });
  assert.deepEqual(input, {
    name: 'Renewals',
    systemPrompt: 'help',
    role: 'Custom',
    description: '',
    model: '',
    tools: ['a', 'b'],
    grounded: false,
    trigger: 'observed',
    pipelineId: 'pl_claims',
  });
});

test('parseCreateInput: missing required field → null', () => {
  assert.equal(parseCreateInput({ name: 'X' }), null);
  assert.equal(parseCreateInput({ systemPrompt: 'x' }), null);
  assert.equal(parseCreateInput(null), null);
});

test('parseCreateInput: grounded defaults true when omitted', () => {
  const input = parseCreateInput({ name: 'X', systemPrompt: 'y' });
  assert.equal(input?.grounded, true);
  assert.equal(input?.pipelineId, null);
});

test('parseCreateInput: invalid pipeline binding type rejects the request', () => {
  assert.equal(parseCreateInput({ name: 'X', systemPrompt: 'y', pipelineId: 42 }), null);
});

test('parseEditPatch: only present keys appear (partial patch)', () => {
  const patch = parseEditPatch({ systemPrompt: '  new instructions  ' });
  assert.deepEqual(patch, { systemPrompt: 'new instructions' });
});

test('parseEditPatch: present-but-blank required field → null', () => {
  assert.equal(parseEditPatch({ name: '   ' }), null);
  assert.equal(parseEditPatch({ systemPrompt: '' }), null);
});

test('parseEditPatch: empty body → empty patch (touches nothing)', () => {
  assert.deepEqual(parseEditPatch({}), {});
  assert.deepEqual(parseEditPatch(null), {});
});

test('parseEditPatch: normalizes tools, grounded, trigger', () => {
  const patch = parseEditPatch({ tools: ['x', 2], grounded: false, trigger: 'nope' });
  assert.deepEqual(patch, { tools: ['x'], grounded: false, trigger: 'on-demand' });
});

test('parseEditPatch: role falls back to Custom when blanked', () => {
  assert.deepEqual(parseEditPatch({ role: '' }), { role: 'Custom' });
});

test('parseEditPatch: pipeline binding trims, clears with null, and rejects invalid types', () => {
  assert.deepEqual(parseEditPatch({ pipelineId: '  pl_a  ' }), { pipelineId: 'pl_a' });
  assert.deepEqual(parseEditPatch({ pipelineId: null }), { pipelineId: null });
  assert.equal(parseEditPatch({ pipelineId: false }), null);
});
