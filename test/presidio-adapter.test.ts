import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePresidioConfig, scanWithPresidio } from '@/lib/adapters/presidio';

test('Presidio config supports canonical URLs and the historical analyzer URL', () => {
  assert.deepEqual(
    resolvePresidioConfig({
      OFFGRID_PRESIDIO_ANALYZER_URL: 'http://analyzer:3000/',
      OFFGRID_PRESIDIO_ANONYMIZER_URL: 'http://anonymizer:3000/',
    }),
    {
      analyzerUrl: 'http://analyzer:3000',
      anonymizerUrl: 'http://anonymizer:3000',
      timeoutMs: 8000,
    },
  );
  assert.equal(
    resolvePresidioConfig({ OFFGRID_PRESIDIO_URL: 'http://127.0.0.1:8938' }).anonymizerUrl,
    'http://127.0.0.1:8939',
  );
  assert.equal(
    resolvePresidioConfig({ OFFGRID_PRESIDIO_URL: 'http://presidio.example' }).anonymizerUrl,
    null,
  );
});

test('unconfigured Presidio reports the real regex fallback', async () => {
  const result = await scanWithPresidio('email me at a@example.com', {
    analyzerUrl: null,
    anonymizerUrl: null,
    timeoutMs: 100,
  });
  assert.equal(result.engine, 'regex');
  assert.equal(result.requestedEngine, 'presidio');
  assert.equal(result.status, 'fallback');
  assert.equal(result.scope, 'data-redaction');
  assert.match(result.redacted ?? '', /\[EMAIL\]/);
});
