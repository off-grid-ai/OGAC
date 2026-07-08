import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPipelineOptions,
  toBindingRequestBody,
  validateBinding,
} from '../src/lib/workspace-pipeline-binding.ts';

test('buildPipelineOptions: sorts by name, de-dupes by id, fills name from id', () => {
  const out = buildPipelineOptions([
    { id: 'b', name: 'Beta', status: 'draft' },
    { id: 'a', name: 'alpha' },
    { id: 'b', name: 'Beta dup' }, // dropped
    { id: 'c', name: '' }, // name falls back to id
  ]);
  assert.deepEqual(
    out.map((o) => o.id),
    ['a', 'b', 'c'],
  );
  assert.equal(out[2].name, 'c');
  assert.equal(out[1].status, 'draft');
});

test('toBindingRequestBody: empty default → null, per-message model', () => {
  const body = toBindingRequestBody('', [], ['p1']);
  assert.equal(body.defaultChatPipelineId, null);
  assert.deepEqual(body.chatPipelineAllowlist, []);
});

test('toBindingRequestBody: default is always included in the allowlist, de-duped', () => {
  const body = toBindingRequestBody('p1', ['p2', 'p1', 'p2'], ['p1', 'p2', 'p3']);
  assert.equal(body.defaultChatPipelineId, 'p1');
  assert.deepEqual(body.chatPipelineAllowlist, ['p1', 'p2']);
});

test('toBindingRequestBody: unknown ids are filtered out (default + allowlist)', () => {
  const body = toBindingRequestBody('ghost', ['p1', 'gone'], ['p1']);
  assert.equal(body.defaultChatPipelineId, null);
  assert.deepEqual(body.chatPipelineAllowlist, ['p1']);
});

test('validateBinding: no default + empty allowlist is valid (per-message model)', () => {
  assert.equal(
    validateBinding({ defaultChatPipelineId: null, chatPipelineAllowlist: [] }, ['p1']),
    null,
  );
});

test('validateBinding: valid known binding passes', () => {
  assert.equal(
    validateBinding({ defaultChatPipelineId: 'p1', chatPipelineAllowlist: ['p1', 'p2'] }, [
      'p1',
      'p2',
    ]),
    null,
  );
});

test('validateBinding: stale default is rejected', () => {
  const msg = validateBinding({ defaultChatPipelineId: 'gone', chatPipelineAllowlist: [] }, ['p1']);
  assert.match(msg ?? '', /default pipeline no longer exists/);
});

test('validateBinding: stale allowlist entry is rejected', () => {
  const msg = validateBinding(
    { defaultChatPipelineId: null, chatPipelineAllowlist: ['gone'] },
    ['p1'],
  );
  assert.match(msg ?? '', /no longer exists/);
});
