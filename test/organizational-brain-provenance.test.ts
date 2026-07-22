import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBrainAuthorization, type BrainDocument } from '../src/lib/organizational-brain/contracts.ts';
import {
  buildBrainProvenanceUri,
  parseTrustedBrainProvenanceUri,
} from '../src/lib/organizational-brain/provenance.ts';

const context = resolveBrainAuthorization(
  { tenantId: 'bank-one', subjectId: 'rm@bank.example', role: 'relationship-manager' },
  [
    {
      tenantId: 'bank-one',
      roles: ['relationship-manager'],
      documentSetSlugs: ['customer-360'],
      capabilities: ['retrieve', 'ingest'],
      ingestionConnectionId: 42,
    },
  ],
);

const document: BrainDocument = {
  id: 'customer/123',
  title: 'Customer summary',
  semanticIdentifier: 'Customer 123',
  sections: [{ text: 'A governed customer summary.' }],
  sourceType: 'app-output',
  sourceUri: 'https://crm.example/customers/123',
  version: 'crm-etag-7',
  checksum: 'a'.repeat(64),
  updatedAt: '2026-07-23T00:00:00.000Z',
};

test('stable provenance round-trips tenant, document, version, and checksum', () => {
  const uri = buildBrainProvenanceUri(context, document);
  assert.deepEqual(parseTrustedBrainProvenanceUri(context, uri), {
    tenantId: 'bank-one',
    documentId: 'customer/123',
    version: 'crm-etag-7',
    checksum: 'a'.repeat(64),
  });
  assert.equal(uri.includes(document.sourceUri ?? ''), false, 'original URI remains a separate receipt field');
});

test('foreign, malformed, and forged provider links remain untrusted', () => {
  const foreign = buildBrainProvenanceUri(
    resolveBrainAuthorization(
      { tenantId: 'bank-two', subjectId: 'rm@bank.example', role: 'relationship-manager' },
      [
        {
          tenantId: 'bank-two',
          roles: ['relationship-manager'],
          documentSetSlugs: ['customer-360'],
          capabilities: ['retrieve'],
        },
      ],
    ),
    document,
  );

  assert.equal(parseTrustedBrainProvenanceUri(context, foreign), null);
  assert.equal(parseTrustedBrainProvenanceUri(context, 'https://source.example/document/1'), null);
  assert.equal(parseTrustedBrainProvenanceUri(context, 'not a URL'), null);
  assert.equal(
    parseTrustedBrainProvenanceUri(
      context,
      'offgrid://organizational-brain/bank-one/documents/forged?version=1&checksum=bad',
    ),
    null,
  );
});
