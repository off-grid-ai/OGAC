import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertBrainAuthorization,
  BrainAuthorizationError,
  BrainPolicyError,
  brainDocumentSetName,
  requireBrainIngestionConnection,
  resolveBrainAuthorization,
  selectAuthorizedBrainDocumentSet,
  type BrainAuthorizationContext,
} from '../src/lib/organizational-brain/contracts.ts';

const policy = [
  {
    tenantId: 'bank-one',
    roles: ['relationship-manager'],
    documentSetSlugs: ['customer-360', 'policies'],
    ingestionConnectionId: 42,
  },
  {
    tenantId: 'bank-one',
    subjectIds: ['auditor@bank.example'],
    documentSetSlugs: ['audit-evidence'],
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
        [{ tenantId: 'bank-one', roles: ['relationship-manager'], documentSetSlugs: [] }],
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
            ingestionConnectionId: 99,
          },
        ],
      ),
    BrainPolicyError,
  );
});
