import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAddModelBody,
  shapeProviderPool,
  removablePool,
} from '../src/lib/litellm-provider-pool.ts';

test('buildAddModelBody: cloud provider requires an api key, builds provider/model', () => {
  const bad = buildAddModelBody({ modelName: 'cloud/gpt', provider: 'openai', model: 'gpt-4o-mini' });
  assert.equal(bad.ok, false);
  assert.match((bad as { error: string }).error, /API key/);

  const ok = buildAddModelBody({
    modelName: 'cloud/gpt',
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: 'sk-x',
  });
  assert.equal(ok.ok, true);
  const body = (ok as { body: Record<string, unknown> }).body;
  assert.equal(body.model_name, 'cloud/gpt');
  assert.deepEqual(body.litellm_params, { model: 'openai/gpt-4o-mini', api_key: 'sk-x' });
});

test('buildAddModelBody: compatible/on-prem provider requires a base URL', () => {
  const bad = buildAddModelBody({ modelName: 'x', provider: 'openai-compatible', model: 'm' });
  assert.equal(bad.ok, false);
  assert.match((bad as { error: string }).error, /base URL/);

  const ok = buildAddModelBody({
    modelName: 'onprem/m',
    provider: 'hosted_vllm',
    model: 'm',
    apiBase: 'http://127.0.0.1:8000/v1',
  });
  assert.equal(ok.ok, true);
  assert.equal(
    ((ok as { body: Record<string, unknown> }).body.litellm_params as { api_base: string }).api_base,
    'http://127.0.0.1:8000/v1',
  );
});

test('buildAddModelBody: rejects missing name/provider/model', () => {
  assert.match((buildAddModelBody({}) as { error: string }).error, /model_name/);
  assert.match(
    (buildAddModelBody({ modelName: 'a' }) as { error: string }).error,
    /provider/,
  );
  assert.match(
    (buildAddModelBody({ modelName: 'a', provider: 'openai' }) as { error: string }).error,
    /upstream model/,
  );
});

test('buildAddModelBody: provider is lowercased + name/model trimmed', () => {
  const ok = buildAddModelBody({ modelName: '  a  ', provider: 'OpenAI', model: '  m ', apiKey: 'k' });
  assert.equal(ok.ok, true);
  const body = (ok as { body: Record<string, unknown> }).body;
  assert.equal(body.model_name, 'a');
  assert.equal((body.litellm_params as { model: string }).model, 'openai/m');
});

test('shapeProviderPool: shapes /model/info rows, flags db-managed, handles junk', () => {
  const rows = shapeProviderPool({
    data: [
      {
        model_name: 'onprem/gemma-4-e4b',
        litellm_params: { model: 'hosted_vllm/gemma', api_base: 'http://x/v1' },
        model_info: { id: 'cfg1', db_model: false },
      },
      {
        model_name: 'cloud/gpt',
        litellm_params: { model: 'openai/gpt-4o-mini' },
        model_info: { id: 'db1', db_model: true },
      },
      null, // junk row → safe defaults, never throws
    ],
  });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].modelName, 'onprem/gemma-4-e4b');
  assert.equal(rows[0].dbManaged, false);
  assert.equal(rows[0].apiBase, 'http://x/v1');
  assert.equal(rows[1].dbManaged, true);
  assert.equal(rows[1].apiBase, null);
  assert.equal(rows[2].modelName, '');
});

test('shapeProviderPool: non-array / missing data → []', () => {
  assert.deepEqual(shapeProviderPool({}), []);
  assert.deepEqual(shapeProviderPool(null), []);
  assert.deepEqual(shapeProviderPool({ data: 'nope' }), []);
});

test('removablePool: only db-managed rows with an id are removable', () => {
  const rows = shapeProviderPool({
    data: [
      { model_name: 'a', model_info: { id: 'cfg', db_model: false } },
      { model_name: 'b', model_info: { id: 'db1', db_model: true } },
      { model_name: 'c', model_info: { id: '', db_model: true } }, // db but no id → not removable
    ],
  });
  const rm = removablePool(rows);
  assert.equal(rm.length, 1);
  assert.equal(rm[0].modelName, 'b');
});
