import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildLiteLLMConfig,
  configToYaml,
  fleetModelName,
  DEFAULT_FLEET_POOL,
  type FleetPoolNode,
} from '../src/lib/litellm-config.ts';
import type { CloudProviderConfig } from '../src/lib/cloud-providers.ts';

// PURE LiteLLM config generator — exercised against fixed pools/providers, no I/O, no mocks. The
// terminal artifact asserted is the config OBJECT (and its YAML serialisation) LiteLLM is fed.

const twoNodePool: FleetPoolNode[] = [
  { name: 'g1', host: '10.0.0.1', port: 7878, vision: true, model: 'qwythos-9b' },
  { name: 'g2', host: '10.0.0.2', port: 7878, vision: false, model: 'qwen3.5-9b' },
];

const openai: CloudProviderConfig = {
  id: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-secret-should-never-appear',
  prefixes: ['openai', 'openai/'],
  defaultModel: 'gpt-4o-mini',
};

test('empty pool + no cloud → a VALID config with an empty model_list (serves nothing, honest)', () => {
  const cfg = buildLiteLLMConfig({ pool: [], cloudProviders: [] });
  assert.deepEqual(cfg.model_list, []);
  // router/settings still present so LiteLLM starts.
  assert.equal(cfg.router_settings.routing_strategy, 'least-busy');
  assert.equal(cfg.litellm_settings.turn_off_message_logging, true);
  assert.equal(cfg.general_settings.master_key, 'os.environ/OFFGRID_LITELLM_MASTER_KEY');
});

test('fleet nodes → OpenAI-compatible deployments namespaced onprem/, no api_key, egress on-prem', () => {
  const cfg = buildLiteLLMConfig({ pool: twoNodePool, cloudProviders: [] });
  assert.equal(cfg.model_list.length, 2);
  const g1 = cfg.model_list[0];
  assert.equal(g1.model_name, 'onprem/qwythos-9b');
  assert.equal(g1.litellm_params.model, 'openai/qwythos-9b');
  assert.equal(g1.litellm_params.api_base, 'http://10.0.0.1:7878/v1');
  assert.equal(g1.litellm_params.api_key, undefined); // fleet needs no key
  assert.equal(g1.model_info.egress, 'on-prem');
  assert.equal(g1.model_info.id, 'g1');
  assert.equal(g1.model_info.vision, true);
  assert.equal(cfg.model_list[1].model_info.vision, false);
});

test('cloud provider → deployment references the key as os.environ, NEVER the literal secret', () => {
  const cfg = buildLiteLLMConfig({ pool: [], cloudProviders: [openai] });
  const entry = cfg.model_list[0];
  assert.equal(entry.model_name, 'openai/gpt-4o-mini');
  assert.equal(entry.litellm_params.model, 'openai/gpt-4o-mini');
  assert.equal(entry.litellm_params.api_base, 'https://api.openai.com/v1');
  assert.equal(entry.litellm_params.api_key, 'os.environ/OFFGRID_CLOUD_OPENAI_API_KEY');
  assert.equal(entry.model_info.egress, 'cloud');
  // the real key must not leak anywhere in the serialised config
  assert.ok(!configToYaml(cfg).includes('sk-secret-should-never-appear'));
});

test('fleet + cloud combine into one model_list (fleet first, then cloud)', () => {
  const cfg = buildLiteLLMConfig({ pool: twoNodePool, cloudProviders: [openai] });
  assert.equal(cfg.model_list.length, 3);
  assert.equal(cfg.model_list[0].model_info.egress, 'on-prem');
  assert.equal(cfg.model_list[2].model_info.egress, 'cloud');
});

test('a down-marked (enabled:false) node is still LISTED but flagged drained', () => {
  const pool: FleetPoolNode[] = [
    { name: 'g1', host: '10.0.0.1', port: 7878, vision: true, model: 'm', enabled: false },
    { name: 'g2', host: '10.0.0.2', port: 7878, vision: true, model: 'm', enabled: true },
  ];
  const cfg = buildLiteLLMConfig({ pool, cloudProviders: [] });
  assert.equal(cfg.model_list.length, 2, 'drained node is not dropped');
  assert.equal(cfg.model_list[0].model_info.drained, true);
  // an enabled node carries no drained key (both arms of the conditional).
  assert.equal(cfg.model_list[1].model_info.drained, undefined);
});

test('databaseUrlEnvVar present → general_settings.database_url as os.environ; absent → omitted', () => {
  const withDb = buildLiteLLMConfig({ pool: [], databaseUrlEnvVar: 'OFFGRID_LITELLM_DB_URL' });
  assert.equal(withDb.general_settings.database_url, 'os.environ/OFFGRID_LITELLM_DB_URL');
  const withoutDb = buildLiteLLMConfig({ pool: [] });
  assert.equal('database_url' in withoutDb.general_settings, false);
});

test('masterKeyEnvVar override is honored', () => {
  const cfg = buildLiteLLMConfig({ pool: [], masterKeyEnvVar: 'MY_KEY' });
  assert.equal(cfg.general_settings.master_key, 'os.environ/MY_KEY');
});

test('defaults: no input uses the shared SSOT fleet pool (7 nodes), no cloud', () => {
  const cfg = buildLiteLLMConfig();
  assert.equal(cfg.model_list.length, DEFAULT_FLEET_POOL.length);
  assert.equal(DEFAULT_FLEET_POOL.length, 7);
  assert.ok(cfg.model_list.every((m) => m.model_info.egress === 'on-prem'));
});

test('fleetModelName namespaces the served model under onprem/', () => {
  assert.equal(fleetModelName({ name: 'g1', host: 'h', port: 1, vision: true, model: 'foo' }), 'onprem/foo');
});

test('configToYaml round-trips the deployment fields + quotes values with special chars', () => {
  const cfg = buildLiteLLMConfig({ pool: twoNodePool, cloudProviders: [openai] });
  const yaml = configToYaml(cfg);
  assert.match(yaml, /model_list:/);
  assert.match(yaml, /model_name: onprem\/qwythos-9b/);
  // api_base contains ':' → must be quoted so YAML doesn't mis-parse it as a mapping.
  assert.match(yaml, /api_base: "http:\/\/10\.0\.0\.1:7878\/v1"/);
  assert.match(yaml, /success_callback:/);
  assert.match(yaml, /- otel/);
  assert.match(yaml, /vision: false/);
  // os.environ/… has no YAML-special char so it is emitted unquoted (valid YAML).
  assert.match(yaml, /master_key: os\.environ\/OFFGRID_LITELLM_MASTER_KEY/);
});

test('configToYaml emits the drained flag only for a drained node', () => {
  const pool: FleetPoolNode[] = [
    { name: 'g1', host: '10.0.0.1', port: 7878, vision: true, model: 'm', enabled: false },
  ];
  const yaml = configToYaml(buildLiteLLMConfig({ pool, cloudProviders: [] }));
  assert.match(yaml, /drained: true/);
  // a non-drained-only config omits the key entirely
  const yaml2 = configToYaml(buildLiteLLMConfig({ pool: twoNodePool, cloudProviders: [] }));
  assert.ok(!yaml2.includes('drained:'));
});
