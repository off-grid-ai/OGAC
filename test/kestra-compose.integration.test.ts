import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const compose = readFileSync(
  fileURLToPath(new URL('../deploy/docker-compose.yml', import.meta.url)),
  'utf8',
);

const kestraService = compose.match(
  /^  kestra:\n(?<service>[\s\S]*?)(?=^  [a-z][a-z0-9-]+:\n|^volumes:\n)/m,
)?.groups?.service;

test('Kestra health-checks its real in-container API listener and recovers after process exits', () => {
  assert.ok(kestraService, 'Kestra must remain in the canonical compose file');

  assert.match(kestraService, /^    restart: unless-stopped$/m);
  assert.match(
    kestraService,
    /bash -c "<\/dev\/tcp\/127\.0\.0\.1\/8080"/,
    'health must depend on the API listener inside the container, not the published host port',
  );
  assert.match(kestraService, /^      start_period: 60s$/m);
  assert.doesNotMatch(
    kestraService,
    /test:\s*\[[^\n]*['"]true['"]/,
    'an unconditional command cannot prove Kestra is serving traffic',
  );
});
