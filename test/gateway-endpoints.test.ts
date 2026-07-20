import assert from 'node:assert/strict';
import test from 'node:test';
import { gatewayWiringView, resolveGatewayEndpoints } from '../src/lib/gateway-endpoints.ts';

test('legacy gateway config continues to drive inference and node control', () => {
  const endpoints = resolveGatewayEndpoints({
    OFFGRID_GATEWAY_URL: 'http://gateway:7878/',
    OFFGRID_GATEWAY_API_KEY: 'legacy',
  });
  assert.equal(endpoints.inferenceUrl, 'http://gateway:7878');
  assert.equal(endpoints.controlUrl, 'http://gateway:7878');
  assert.equal(endpoints.inferenceProvider, 'gateway');
  assert.equal(endpoints.controlApiKey, 'legacy');
  assert.equal(gatewayWiringView(endpoints).split, false);
});

test('LiteLLM cutover changes only inference and preserves aggregator control', () => {
  const endpoints = resolveGatewayEndpoints({
    OFFGRID_GATEWAY_URL: 'http://aggregator:7878',
    OFFGRID_GATEWAY_CONTROL_URL: 'http://control:8800',
    OFFGRID_INFERENCE_PROVIDER: 'litellm',
    OFFGRID_LITELLM_URL: 'http://litellm:4000',
    OFFGRID_LITELLM_MASTER_KEY: 'master',
    OFFGRID_GATEWAY_CONTROL_API_KEY: 'control',
  });
  assert.deepEqual(endpoints, {
    inferenceUrl: 'http://litellm:4000',
    controlUrl: 'http://control:8800',
    inferenceProvider: 'litellm',
    inferenceApiKey: 'master',
    controlApiKey: 'control',
  });
  assert.equal(gatewayWiringView(endpoints).split, true);
});

test('explicit custom inference door does not redirect control calls', () => {
  const endpoints = resolveGatewayEndpoints({
    OFFGRID_INFERENCE_URL: 'http://models:9000',
    OFFGRID_INFERENCE_API_KEY: 'models',
  });
  assert.equal(endpoints.inferenceProvider, 'custom');
  assert.equal(endpoints.inferenceUrl, 'http://models:9000');
  assert.equal(endpoints.controlUrl, 'http://127.0.0.1:7878');
  assert.equal(endpoints.inferenceApiKey, 'models');
});
