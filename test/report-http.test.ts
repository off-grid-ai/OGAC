import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProvenanceManifest } from '../src/lib/provenance.ts';
import { incompleteReport, pdfResponse, provenanceHeaders } from '../src/lib/reports/http.ts';

// Pure unit tests for the shared report-export HTTP helpers (the wire contract). No request, no IO.

const manifestWithKey: ProvenanceManifest = {
  generator: 'offgrid-console/1.0',
  filename: 'offgrid-regulator-irdai.pdf',
  format: 'application/pdf',
  sha256: 'abc123',
  generatedAt: '2026-07-12T09:00:00.000Z',
  algorithm: 'ed25519',
  publicKey: '-----BEGIN PUBLIC KEY-----\nMFkw...\n-----END PUBLIC KEY-----\n',
  signature: 'sig==',
};
const manifestNoKey: ProvenanceManifest = { ...manifestWithKey, algorithm: 'HMAC-SHA256', publicKey: null };

test('provenanceHeaders: emits algorithm/sha256/signature and base64-encodes a PEM public key', () => {
  const h = provenanceHeaders(manifestWithKey);
  assert.equal(h['x-provenance-algorithm'], 'ed25519');
  assert.equal(h['x-provenance-sha256'], 'abc123');
  assert.equal(h['x-provenance-signature'], 'sig==');
  const decoded = Buffer.from(h['x-provenance-public-key-b64'], 'base64').toString();
  assert.ok(decoded.includes('BEGIN PUBLIC KEY')); // round-trips the PEM (which has illegal-in-header newlines)
});

test('provenanceHeaders: omits the public-key header when there is no key (e.g. HMAC signer)', () => {
  const h = provenanceHeaders(manifestNoKey);
  assert.equal(h['x-provenance-public-key-b64'], undefined);
  assert.equal(h['x-provenance-algorithm'], 'HMAC-SHA256');
});

test('pdfResponse: application/pdf with an attachment filename and provenance headers', async () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
  const res = pdfResponse(bytes, 'offgrid-regulator-irdai.pdf', manifestNoKey);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(
    res.headers.get('content-disposition'),
    'attachment; filename="offgrid-regulator-irdai.pdf"',
  );
  assert.equal(res.headers.get('x-provenance-sha256'), 'abc123');
  const body = new Uint8Array(await res.arrayBuffer());
  assert.equal(Buffer.from(body).toString(), '%PDF-');
});

test('incompleteReport: returns null when the verdict is ok (caller proceeds)', () => {
  assert.equal(incompleteReport({ ok: true, issues: [] }), null);
});

test('incompleteReport: returns a 422 carrying the issues when the document is incomplete', async () => {
  const res = incompleteReport({
    ok: false,
    issues: [{ path: 'meta.tenantName', message: 'missing tenant name' }],
  });
  assert.ok(res, 'a response is returned');
  assert.equal(res!.status, 422);
  const json = (await res!.json()) as { error: string; issues: { path: string }[] };
  assert.equal(json.error, 'incomplete report');
  assert.equal(json.issues[0].path, 'meta.tenantName');
});
