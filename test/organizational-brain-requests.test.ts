import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrainRequestError,
  parseBrainDocument,
  parseBrainSearchRequest,
  parseCreateBrainSourceRequest,
  parseSourceStateRequest,
  parseSourceSyncRequest,
} from '../src/lib/organizational-brain/requests.ts';

test('search request accepts only query and bounded limit, never caller scope', () => {
  assert.deepEqual(parseBrainSearchRequest({ query: '  policy  ', limit: 5 }), { query: 'policy', limit: 5 });
  assert.throws(
    () => parseBrainSearchRequest({ query: 'policy', document_sets: ['foreign'] }),
    BrainRequestError,
  );
  assert.throws(() => parseBrainSearchRequest({ query: 'policy', limit: 101 }), BrainRequestError);
});

test('document request validates the typed, bounded provider-neutral contract', () => {
  const parsed = parseBrainDocument({
    id: 'policy-1',
    title: 'Policy',
    semanticIdentifier: 'Policy v1',
    sections: [{ text: 'Line one\nLine two.' }],
    sourceType: 'policy',
    sourceUri: 'https://policies.example/1',
    version: '1',
    checksum: 'a'.repeat(64),
    updatedAt: '2026-07-23T00:00:00Z',
    metadata: { classification: 'internal', tags: ['kyc'] },
  });
  assert.equal(parsed.id, 'policy-1');
  assert.throws(() => parseBrainDocument({ ...parsed, checksum: 'not-sha256' }));
  assert.throws(() => parseBrainDocument({ ...parsed, unexpected: true }), BrainRequestError);
});

test('source requests expose approved binding ids and non-secret config, not credential references', () => {
  assert.deepEqual(
    parseCreateBrainSourceRequest({
      name: 'CRM',
      inputType: 'poll',
      providerConfig: { objects: ['Account'] },
      connectionBindingId: 'salesforce-main',
      documentSetSlug: 'customer-360',
      refreshSeconds: 300,
    }),
    {
      name: 'CRM',
      inputType: 'poll',
      providerConfig: { objects: ['Account'] },
      connectionBindingId: 'salesforce-main',
      documentSetSlug: 'customer-360',
      refreshSeconds: 300,
      pruneSeconds: undefined,
    },
  );
  assert.throws(
    () =>
      parseCreateBrainSourceRequest({
        name: 'CRM',
        inputType: 'poll',
        providerConfig: {},
        credentialReference: 'vault/path',
        connectionBindingId: 'salesforce-main',
        documentSetSlug: 'customer-360',
      }),
    BrainRequestError,
  );
});

test('state and sync actions reject ambiguous input', () => {
  assert.deepEqual(parseSourceStateRequest({ state: 'paused' }), { state: 'paused' });
  assert.deepEqual(parseSourceSyncRequest({ fromBeginning: true }), { fromBeginning: true });
  assert.throws(() => parseSourceStateRequest({ state: 'delete' }), BrainRequestError);
  assert.throws(() => parseSourceSyncRequest({ fromBeginning: 'yes' }), BrainRequestError);
});
