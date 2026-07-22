import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertBrainAuthorization,
  BrainAuthorizationError,
  BrainDocumentValidationError,
  BrainPolicyError,
  brainDocumentSetName,
  requireBrainCapability,
  requireBrainIngestionConnection,
  resolveBrainAuthorization,
  resolveBrainSourceBinding,
  selectAuthorizedBrainDocumentSet,
  validateBrainDocument,
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

test('issued source policy and resolved nested config are immutable snapshots', () => {
  const allowedProviderConfigKeys = ['objects'];
  const mutablePolicy = [
    {
      tenantId: 'bank-one',
      roles: ['brain-manager'],
      documentSetSlugs: ['policies'],
      capabilities: ['manageSources'] as const,
      sourceBindings: [
        {
          id: 'salesforce-main',
          sourceType: 'salesforce',
          providerCredentialId: 7,
          allowedProviderConfigKeys,
        },
      ],
    },
  ];
  const grant = resolveBrainAuthorization(
    { tenantId: 'bank-one', subjectId: 'manager@bank.example', role: 'brain-manager' },
    mutablePolicy,
  );
  allowedProviderConfigKeys.push('api_token');
  const objects = [{ name: 'Account' }];
  const providerConfig = { objects };
  const binding = resolveBrainSourceBinding(grant, 'salesforce-main', providerConfig);
  objects[0]!.name = 'Mutated';
  objects.push({ name: 'Opportunity' });

  assert.deepEqual(binding.providerConfig, { objects: [{ name: 'Account' }] });
  assert.equal(Object.isFrozen(binding.providerConfig), true);
  assert.equal(Object.isFrozen((binding.providerConfig.objects as unknown[])[0]), true);
  assert.throws(
    () => resolveBrainSourceBinding(grant, 'salesforce-main', { api_token: 'still-denied' }),
    BrainAuthorizationError,
  );
});

test('document ingestion validation bounds identifiers, content, metadata, time, and source URI', () => {
  const valid = {
    id: 'doc-1',
    title: 'Policy',
    semanticIdentifier: 'Policy v1',
    sections: [{ text: 'Approved policy text.' }],
    sourceType: 'policy',
    sourceUri: 'https://policies.example/doc-1',
    version: '1',
    checksum: 'a'.repeat(64),
    updatedAt: '2026-07-23T00:00:00Z',
    metadata: { classification: 'internal' },
  } as const;
  assert.doesNotThrow(() => validateBrainDocument(valid));

  const invalid = [
    { ...valid, id: '' },
    { ...valid, title: 'x'.repeat(513) },
    { ...valid, semanticIdentifier: 'bad\u0000name' },
    { ...valid, sourceUri: '/relative' },
    { ...valid, sections: [] },
    { ...valid, sections: [{ text: 'unsafe\u0000text' }] },
    { ...valid, sections: [{ text: 'x'.repeat(256 * 1024 + 1) }] },
    { ...valid, sections: Array.from({ length: 65 }, () => ({ text: 'x' })) },
    { ...valid, metadata: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key${index}`, 'x'])) },
    { ...valid, metadata: { key: 'x'.repeat(4097) } },
    { ...valid, metadata: { key: '   ' } },
    { ...valid, version: 'x'.repeat(129) },
    { ...valid, updatedAt: 'not-a-date' },
  ];
  for (const document of invalid) assert.throws(() => validateBrainDocument(document), BrainDocumentValidationError);
  assert.doesNotThrow(() => validateBrainDocument({ ...valid, sections: [{ text: 'line one\nline two\tvalue' }] }));
});
