import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { KafkaSourceSummary } from '@/components/integrations/KafkaSourceManager';

test('governed Kafka detail shows its usable binding and management actions without secrets', () => {
  const html = renderToStaticMarkup(
    createElement(KafkaSourceSummary, {
      source: {
        connectorId: 'con_kafka',
        domainId: 'dom_kafka',
        name: 'Enterprise risk signals',
        description: 'Approved events',
        status: 'connected',
        bootstrapEndpoint: 'kafkas://events.internal:9093',
        schemaRegistryEndpoint: 'https://schemas.internal:8081',
        topic: 'enterprise.risk-signals',
        schemaSubject: 'enterprise.risk-signals-value',
        schemaVersion: 4,
        schemaId: 29,
        schemaSha256: 'a'.repeat(64),
        tenantField: 'orgId',
        security: {
          tls: true,
          sasl: 'scram-sha-512',
          hasSaslCredentials: true,
          registryAuth: 'bearer',
          hasRegistryCredential: true,
        },
      },
      onEdit() {},
      onDelete() {},
    }),
  );
  assert.match(html, /Governed event source/);
  assert.match(html, /enterprise\.risk-signals/);
  assert.match(html, /enterprise\.risk-signals-value/);
  assert.match(html, /Organization field/);
  assert.match(html, /Edit or rotate/);
  assert.match(html, /Delete/);
  assert.match(html, /sm:grid-cols-2 lg:grid-cols-4/);
  assert.match(html, /Credentials are never shown here/);
  assert.doesNotMatch(html, /password|registry-only-token|vault-only/i);
});
