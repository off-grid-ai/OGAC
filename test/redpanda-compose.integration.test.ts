import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const compose = readFileSync(
  fileURLToPath(new URL('../deploy/docker-compose.yml', import.meta.url)),
  'utf8',
);

const redpandaService = compose.match(
  /^  redpanda:\n(?<service>[\s\S]*?)(?=^  [a-z][a-z0-9-]+:\n)/m,
)?.groups?.service;

test('Redpanda publishes and health-checks the Schema Registry listener it actually binds', () => {
  assert.ok(redpandaService, 'redpanda service must remain in the canonical compose file');

  assert.match(
    redpandaService,
    /^      - --schema-registry-addr=0\.0\.0\.0:8081$/m,
    'the listener must be explicit so an image-default change cannot silently break the route',
  );
  assert.match(
    redpandaService,
    /^      - '18083:8081' # schema registry$/m,
    'the published port must target the configured Registry listener',
  );
  assert.match(redpandaService, /rpk cluster health/);
  assert.match(
    redpandaService,
    /curl --fail --silent --show-error http:\/\/127\.0\.0\.1:8081\/subjects/,
    'container readiness must cover the product-facing Registry API, not only the Kafka broker',
  );
  assert.doesNotMatch(redpandaService, /18083:8083/);
});
