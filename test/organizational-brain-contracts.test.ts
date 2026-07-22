import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertBrainAuthorization,
  BrainAuthorizationError,
  BrainPolicyError,
  brainDocumentSetName,
  requireBrainCapability,
  requireBrainIngestionConnection,
  resolveBrainAuthorization,
  resolveBrainSourceBinding,
  selectAuthorizedBrainDocumentSet,
  type BrainAuthorizationContext,
} from '../src/lib/organizational-brain/contracts.ts';

const policy = [
  {
    tenantId: 'bank-one',
    roles: ['relationship-manager'],
    documentSetSlugs: ['customer-360', 'policies'],
    capabilities: ['retrieve', 'ingest', 'manageSources'],
    ingestionConnectionId: 42,
    sourceBindings: [
      {
        id: 'salesforce-main',
        sourceType: 'salesforce',
        providerCredentialId: 7,
        allowedProviderConfigKeys: ['objects', 'batch_size'],
      },
    ],
  },
  {
    tenantId: 'bank-one',
    subjectIds: ['auditor@bank.example'],
    documentSetSlugs: ['audit-evidence'],
    capabilities: ['retrieve'],
  },
] as const;

test('server policy issues a tenant-namespaced, immutable grant', () => {
  const grant = resolveBrainAuthorization(
    { tenantId: 'bank-one', subjectId: 'rm@bank.example', role: 'relationship-manager' },
    policy,
  );

  assert.deepEqual(grant.documentSetNames, ['ogac:bank-one:customer-360', 'ogac:bank-one:policies']);
  assert.equal(requireBrainIngestionConnection(grant), 42);
  assert.equal(selectAuthorizedBrainDocumentSet(grant, 'policies'), 'ogac:bank-one:policies');
  assert.equal(Object.isFrozen(grant), true);
  assert.equal(Object.isFrozen(grant.documentSetNames), true);
});

test('authorization fails closed for absent, empty, foreign-tenant, and invalid policy scopes', () => {
  assert.throws(
    () => resolveBrainAuthorization({ tenantId: 'bank-one', subjectId: 'unknown', role: 'viewer' }, policy),
    BrainAuthorizationError,
  );
  assert.throws(
    () =>
      resolveBrainAuthorization(
        { tenantId: 'bank-two', subjectId: 'rm@bank.example', role: 'relationship-manager' },
        policy,
      ),
    BrainAuthorizationError,
  );
  assert.throws(
    () =>
      resolveBrainAuthorization(
        { tenantId: 'bank-one', subjectId: 'rm@bank.example', role: 'relationship-manager' },
        [{ tenantId: 'bank-one', roles: ['relationship-manager'], documentSetSlugs: [], capabilities: ['retrieve'] }],
      ),
    BrainPolicyError,
  );
  assert.throws(() => brainDocumentSetName('bank-one', '../escape'), BrainPolicyError);
});

test('cloned or manually widened grants are rejected as tampered before use', () => {
  const grant = resolveBrainAuthorization(
    { tenantId: 'bank-one', subjectId: 'rm@bank.example', role: 'relationship-manager' },
    policy,
  );
  const clone = Object.freeze({
    ...grant,
    documentSetNames: Object.freeze([...grant.documentSetNames, 'ogac:bank-two:secrets']),
  }) as BrainAuthorizationContext;

  assert.throws(() => assertBrainAuthorization(clone), BrainAuthorizationError);
});

test('ingestion and document-set selection require their independently authorized scope', () => {
  const auditor = resolveBrainAuthorization(
    { tenantId: 'bank-one', subjectId: 'auditor@bank.example', role: 'auditor' },
    policy,
  );

  assert.throws(() => requireBrainIngestionConnection(auditor), BrainAuthorizationError);
  assert.throws(() => selectAuthorizedBrainDocumentSet(auditor, 'policies'), BrainAuthorizationError);
  assert.equal(selectAuthorizedBrainDocumentSet(auditor, 'audit-evidence'), 'ogac:bank-one:audit-evidence');
  assert.doesNotThrow(() => requireBrainCapability(auditor, 'retrieve'));
  assert.throws(() => requireBrainCapability(auditor, 'manageSources'), BrainAuthorizationError);
});

test('conflicting server policy is rejected instead of choosing an ingestion target', () => {
  assert.throws(
    () =>
      resolveBrainAuthorization(
        { tenantId: 'bank-one', subjectId: 'rm@bank.example', role: 'relationship-manager' },
        [
          ...policy,
          {
            tenantId: 'bank-one',
            roles: ['relationship-manager'],
            documentSetSlugs: ['policies'],
            capabilities: ['ingest'],
            ingestionConnectionId: 99,
          },
        ],
      ),
    BrainPolicyError,
  );
});

test('source-management bindings are server-resolved, secret-free, and source-specific', () => {
  const manager = resolveBrainAuthorization(
    { tenantId: 'bank-one', subjectId: 'rm@bank.example', role: 'relationship-manager' },
    policy,
  );

  assert.deepEqual(resolveBrainSourceBinding(manager, 'salesforce-main', { objects: ['Account'] }), {
    id: 'salesforce-main',
    sourceType: 'salesforce',
    providerCredentialId: 7,
    providerConfig: { objects: ['Account'] },
  });
  assert.throws(
    () => resolveBrainSourceBinding(manager, 'salesforce-main', { api_token: 'do-not-accept' }),
    BrainAuthorizationError,
  );
  assert.throws(
    () => resolveBrainSourceBinding(manager, 'salesforce-main', { unknown: true }),
    BrainAuthorizationError,
  );
});

test('retrieval-only grants cannot manage sources even with a known binding id', () => {
  const auditor = resolveBrainAuthorization(
    { tenantId: 'bank-one', subjectId: 'auditor@bank.example', role: 'auditor' },
    policy,
  );
  assert.throws(() => resolveBrainSourceBinding(auditor, 'salesforce-main', {}), BrainAuthorizationError);
});
