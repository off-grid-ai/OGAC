import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectorSecretKey,
  isConnectorCredentialPath,
} from '@/lib/connector-secret-policy';

test('connector credential keys preserve default and namespace every non-default tenant', () => {
  assert.equal(connectorSecretKey('con_abc123', 'default'), 'connectors/con_abc123/credential');
  assert.equal(
    connectorSecretKey('con_abc123', 'org_bharat'),
    'org_bharat/connectors/con_abc123/credential',
  );
  assert.throws(() => connectorSecretKey('../escape', 'org_bharat'), /invalid connector id/);
});

test('connector credential reservation catches relative and already-prefixed paths only', () => {
  assert.equal(isConnectorCredentialPath('connectors/con_abc123/credential'), true);
  assert.equal(
    isConnectorCredentialPath('org_bharat/connectors/con_abc123/credential'),
    true,
  );
  assert.equal(
    isConnectorCredentialPath('org_attacker/org_bharat/connectors/con_abc123/credential'),
    true,
  );
  assert.equal(isConnectorCredentialPath('connectors/con_abc123/display-name'), false);
  assert.equal(isConnectorCredentialPath('tools/connectors/con_abc123/credential-copy'), false);
});
