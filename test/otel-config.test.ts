import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveOtelConfig } from '@/lib/otel-config';

test('canonical OTel URL owns the collector contract', () => {
  const config = resolveOtelConfig({
    OFFGRID_OTEL_URL: 'http://collector:4318/',
    OFFGRID_OTLP_URL: 'http://legacy:4318',
  });
  assert.deepEqual(config, {
    configured: true,
    baseUrl: 'http://collector:4318',
    tracesUrl: 'http://collector:4318/v1/traces',
    source: 'OFFGRID_OTEL_URL',
    legacyAlias: false,
  });
});

test('legacy OFFGRID_OTLP_URL remains a truthful alias', () => {
  const config = resolveOtelConfig({ OFFGRID_OTLP_URL: ' http://legacy:4318/ ' });
  assert.equal(config.baseUrl, 'http://legacy:4318');
  assert.equal(config.source, 'OFFGRID_OTLP_URL');
  assert.equal(config.legacyAlias, true);
});

test('unset collector is explicitly unconfigured', () => {
  assert.deepEqual(resolveOtelConfig({}), {
    configured: false,
    baseUrl: null,
    tracesUrl: null,
    source: 'none',
    legacyAlias: false,
  });
});
