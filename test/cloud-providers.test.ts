import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseCloudProviders,
  selectCloudProvider,
  cloudProviderStatuses,
  type CloudEnv,
} from '../src/lib/cloud-providers.ts';

// PURE cloud-provider config + selection. No I/O — exercised against real env bags, no mocks.

const openaiEnv: CloudEnv = {
  OFFGRID_CLOUD_OPENAI_API_KEY: 'sk-test-openai',
  OFFGRID_CLOUD_OPENAI_MODEL: 'gpt-4o-mini',
};
const anthropicEnv: CloudEnv = {
  OFFGRID_CLOUD_ANTHROPIC_API_KEY: 'sk-ant-test',
};
const compatEnv: CloudEnv = {
  OFFGRID_CLOUD_COMPAT_BASE_URL: 'https://proxy.example.com/v1/',
  OFFGRID_CLOUD_COMPAT_API_KEY: 'proxy-key',
  OFFGRID_CLOUD_COMPAT_MODEL: 'my-model',
};
const deepseekEnv: CloudEnv = {
  OFFGRID_CLOUD_DEEPSEEK_API_KEY: 'sk-deepseek-test',
};
const zhipuEnv: CloudEnv = {
  OFFGRID_CLOUD_ZHIPU_API_KEY: 'zhipu-test-key',
};

test('parse: a provider with no API key is NEVER configured (never eligible for cloud)', () => {
  assert.deepEqual(parseCloudProviders({}), []);
  assert.deepEqual(parseCloudProviders({ OFFGRID_CLOUD_OPENAI_BASE_URL: 'https://x/v1' }), []);
});

test('parse: OpenAI key alone → configured with the well-known base URL', () => {
  const [p] = parseCloudProviders(openaiEnv);
  assert.equal(p.id, 'openai');
  assert.equal(p.baseUrl, 'https://api.openai.com/v1');
  assert.equal(p.apiKey, 'sk-test-openai');
  assert.equal(p.defaultModel, 'gpt-4o-mini');
});

test('parse: base URL trailing slash is stripped', () => {
  const [p] = parseCloudProviders(compatEnv);
  assert.equal(p.baseUrl, 'https://proxy.example.com/v1');
});

test('parse: generic compat provider needs a base URL even with a key', () => {
  assert.deepEqual(parseCloudProviders({ OFFGRID_CLOUD_COMPAT_API_KEY: 'k' }), []);
});

test('parse: DeepSeek key alone → configured with the well-known base URL + default model', () => {
  const [p] = parseCloudProviders(deepseekEnv);
  assert.equal(p.id, 'deepseek');
  assert.equal(p.label, 'DeepSeek');
  assert.equal(p.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(p.apiKey, 'sk-deepseek-test');
  assert.equal(p.defaultModel, 'deepseek-chat');
});

test('parse: Zhipu (GLM) key alone → configured with the well-known base URL + default model', () => {
  const [p] = parseCloudProviders(zhipuEnv);
  assert.equal(p.id, 'zhipu');
  assert.equal(p.label, 'Zhipu AI (GLM)');
  assert.equal(p.baseUrl, 'https://open.bigmodel.cn/api/paas/v4');
  assert.equal(p.apiKey, 'zhipu-test-key');
  assert.equal(p.defaultModel, 'glm-4.6');
});

test('parse: deepseek + zhipu are SKIPPED when their env is unset (no key ⇒ not configured)', () => {
  const ids = parseCloudProviders(openaiEnv).map((p) => p.id);
  assert.ok(!ids.includes('deepseek'));
  assert.ok(!ids.includes('zhipu'));
});

test('parse: a custom base URL overrides the default (e.g. Zhipu international endpoint)', () => {
  const [p] = parseCloudProviders({
    OFFGRID_CLOUD_ZHIPU_API_KEY: 'k',
    OFFGRID_CLOUD_ZHIPU_BASE_URL: 'https://api.z.ai/api/paas/v4/',
  });
  assert.equal(p.baseUrl, 'https://api.z.ai/api/paas/v4');
});

test('select: deepseek-namespaced tag routes to DeepSeek + strips the prefix', () => {
  const providers = parseCloudProviders({ ...deepseekEnv, ...openaiEnv });
  const sel = selectCloudProvider(providers, 'deepseek/deepseek-reasoner');
  assert.equal(sel?.provider.id, 'deepseek');
  assert.equal(sel?.model, 'deepseek-reasoner');
});

test('select: bare glm- family prefix routes to Zhipu and keeps the full id', () => {
  const providers = parseCloudProviders({ ...zhipuEnv, ...openaiEnv });
  const sel = selectCloudProvider(providers, 'glm-4.6');
  assert.equal(sel?.provider.id, 'zhipu');
  assert.equal(sel?.model, 'glm-4.6');
});

test('select: null when nothing configured — caller must degrade honestly', () => {
  assert.equal(selectCloudProvider([], 'gpt-4o'), null);
  assert.equal(selectCloudProvider(parseCloudProviders({}), 'gpt-4o'), null);
});

test('select: provider-namespaced tag routes + strips the prefix', () => {
  const providers = parseCloudProviders({ ...openaiEnv, ...anthropicEnv });
  const sel = selectCloudProvider(providers, 'anthropic/claude-3-5-sonnet');
  assert.equal(sel?.provider.id, 'anthropic');
  assert.equal(sel?.model, 'claude-3-5-sonnet');
});

test('select: bare model-family prefix (gpt-) routes to OpenAI and keeps the full id', () => {
  const providers = parseCloudProviders({ ...openaiEnv, ...anthropicEnv });
  const sel = selectCloudProvider(providers, 'gpt-4o');
  assert.equal(sel?.provider.id, 'openai');
  assert.equal(sel?.model, 'gpt-4o');
});

test('select: cloud:provider:model triple form resolves provider + bare model', () => {
  const providers = parseCloudProviders({ ...openaiEnv, ...anthropicEnv });
  const sel = selectCloudProvider(providers, 'cloud:openai:gpt-4o');
  assert.equal(sel?.provider.id, 'openai');
  assert.equal(sel?.model, 'gpt-4o');
});

test('select: single configured provider + no hint → that provider with its default model', () => {
  const providers = parseCloudProviders(openaiEnv);
  const sel = selectCloudProvider(providers, '');
  assert.equal(sel?.provider.id, 'openai');
  assert.equal(sel?.model, 'gpt-4o-mini');
});

test('select: multiple configured + ambiguous tag → null (never guesses)', () => {
  const providers = parseCloudProviders({ ...openaiEnv, ...anthropicEnv });
  assert.equal(selectCloudProvider(providers, 'some-unknown-model'), null);
});

test('statuses: every KNOWN provider shown; configured flag reflects the env; keys never leaked', () => {
  const rows = cloudProviderStatuses({ ...openaiEnv, ...deepseekEnv });
  const openai = rows.find((r) => r.id === 'openai');
  const anthropic = rows.find((r) => r.id === 'anthropic');
  const deepseek = rows.find((r) => r.id === 'deepseek');
  const zhipu = rows.find((r) => r.id === 'zhipu');
  assert.equal(openai?.configured, true);
  assert.equal(anthropic?.configured, false);
  // deepseek + zhipu are reported as KNOWN providers, honestly reflecting env presence.
  assert.equal(deepseek?.configured, true);
  assert.equal(deepseek?.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(zhipu?.configured, false);
  assert.equal(zhipu?.label, 'Zhipu AI (GLM)');
  // No property on any row is the API key.
  for (const r of rows) {
    assert.ok(!Object.values(r).includes('sk-test-openai'));
    assert.ok(!Object.values(r).includes('sk-deepseek-test'));
  }
});
