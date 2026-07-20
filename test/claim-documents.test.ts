import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { getSigning } from '@/lib/adapters/registry';
import {
  CLAIM_DOCUMENT_MAX_BYTES,
  claimDocumentId,
  claimDocumentObjectKey,
  sniffClaimDocumentType,
  validateClaimDocumentUpload,
} from '@/lib/claim-document';

const PDF = Buffer.from('%PDF-1.7\nclaim evidence');

test('claim document policy derives a tenant/claim-scoped key and verifies content bytes', () => {
  const input = {
    claimId: 'CLM_1001',
    idempotencyKey: 'claim:CLM_1001:fnol:v1',
    filename: 'fnol-report.pdf',
    contentType: 'application/pdf',
    bytes: PDF,
  };
  const validated = validateClaimDocumentUpload(input, 'org_suraksha');
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(
    validated.value.objectKey,
    `orgs/org_suraksha/claims/CLM_1001/documents/${claimDocumentId(input.idempotencyKey)}`,
  );
  assert.equal(sniffClaimDocumentType(PDF), 'application/pdf');
  assert.equal(claimDocumentObjectKey('org_suraksha', '../other', validated.value.documentId), null);
});

test('claim document policy rejects spoofed MIME, unsafe names, empty, and oversized content', () => {
  const base = {
    claimId: 'CLM_1001',
    idempotencyKey: 'claim:CLM_1001:fnol:v1',
    filename: '../fnol.exe',
    contentType: 'image/png',
    bytes: PDF,
  };
  const invalid = validateClaimDocumentUpload(base, 'org/unsafe');
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.ok(invalid.errors.some((error) => error.includes('organization id')));
    assert.ok(invalid.errors.some((error) => error.includes('filename')));
    assert.ok(invalid.errors.some((error) => error.includes('does not match')));
  }
  const oversized = validateClaimDocumentUpload(
    { ...base, filename: 'large.pdf', contentType: 'application/pdf', bytes: Buffer.alloc(CLAIM_DOCUMENT_MAX_BYTES + 1) },
    'org_suraksha',
  );
  assert.equal(oversized.ok, false);
});

test('claim document adapter performs conditional S3 write/read, replay, conflict, and tenant isolation', async (t) => {
  const objects = new Map<string, { body: Buffer; headers: Record<string, string> }>();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const key = decodeURIComponent(url.pathname.replace(/^\/claim-doc-test\/?/, ''));
    if (!key && req.method === 'PUT') {
      res.writeHead(200).end();
      return;
    }
    if (req.method === 'PUT') {
      if (req.headers['if-none-match'] === '*' && objects.has(key)) {
        res.writeHead(412).end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        objects.set(key, {
          body: Buffer.concat(chunks),
          headers: {
            'content-type': String(req.headers['content-type'] ?? 'application/octet-stream'),
            'x-amz-meta-name': String(req.headers['x-amz-meta-name'] ?? ''),
            'x-amz-meta-owner': String(req.headers['x-amz-meta-owner'] ?? ''),
            'x-amz-meta-visibility': String(req.headers['x-amz-meta-visibility'] ?? ''),
          },
        });
        res.writeHead(200).end();
      });
      return;
    }
    const object = objects.get(key);
    if (!object) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      ...object.headers,
      'content-length': String(object.body.length),
      'last-modified': 'Sun, 20 Jul 2026 12:00:00 GMT',
    });
    res.end(req.method === 'HEAD' ? undefined : object.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const priorUrl = process.env.OFFGRID_SEAWEEDFS_URL;
  const priorBucket = process.env.OFFGRID_SEAWEEDFS_BUCKET;
  process.env.OFFGRID_SEAWEEDFS_URL = `http://127.0.0.1:${address.port}`;
  process.env.OFFGRID_SEAWEEDFS_BUCKET = 'claim-doc-test';
  t.after(() => {
    if (priorUrl === undefined) delete process.env.OFFGRID_SEAWEEDFS_URL;
    else process.env.OFFGRID_SEAWEEDFS_URL = priorUrl;
    if (priorBucket === undefined) delete process.env.OFFGRID_SEAWEEDFS_BUCKET;
    else process.env.OFFGRID_SEAWEEDFS_BUCKET = priorBucket;
  });

  const { readClaimDocument, writeClaimDocument } = await import('@/lib/adapters/claim-documents');
  const command = {
    claimId: 'CLM_1001',
    idempotencyKey: 'claim:CLM_1001:fnol:v1',
    filename: 'fnol-report.pdf',
    contentType: 'application/pdf',
    bytes: PDF,
  };
  const clock = () => new Date('2026-07-20T12:00:00.000Z');
  const first = await writeClaimDocument(command, 'org_suraksha', 'claims@example.test', clock);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.receipt.replayed, false);
  const { signature, algorithm: _algorithm, publicKey: _publicKey, ...signed } = first.receipt;
  assert.equal(getSigning().verify(signed, signature), true);

  const replay = await writeClaimDocument(command, 'org_suraksha', 'claims@example.test', clock);
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.receipt.replayed, true);

  const conflict = await writeClaimDocument(
    { ...command, bytes: Buffer.from('%PDF-1.7\ndifferent evidence') },
    'org_suraksha',
    'claims@example.test',
    clock,
  );
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.code, 'idempotency-conflict');

  const read = await readClaimDocument('org_suraksha', command.claimId, first.receipt.documentId, clock);
  assert.equal(read.ok, true);
  if (read.ok) assert.deepEqual(read.bytes, PDF);
  const crossTenant = await readClaimDocument('org_bharat', command.claimId, first.receipt.documentId, clock);
  assert.equal(crossTenant.ok, false);
  if (!crossTenant.ok) assert.equal(crossTenant.code, 'not-found');
});
