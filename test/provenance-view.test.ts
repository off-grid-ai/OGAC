import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildProvenanceView, type ProvenanceRecord } from '../src/lib/provenance-view.ts';

// Unit tests for the pure provenance-view normalizer — NO mocks. Exercises the real display rule
// that powers the Provenance surface: verified/unverified rollup, per-record shaping, newest-first
// ordering, and graceful handling of malformed/empty input (it must never throw).

test('buildProvenanceView: empty / nullish input → empty view', () => {
  for (const input of [[], null, undefined]) {
    const v = buildProvenanceView(input as ProvenanceRecord[] | null | undefined);
    assert.deepEqual(v, { total: 0, verified: 0, unverified: 0, records: [] });
  }
});

test('buildProvenanceView: non-array input → empty view (never throws)', () => {
  // Deliberately wrong type — the normalizer must degrade, not blow up.
  const v = buildProvenanceView({ nope: true } as unknown as ProvenanceRecord[]);
  assert.deepEqual(v, { total: 0, verified: 0, unverified: 0, records: [] });
});

test('buildProvenanceView: counts verified vs unverified', () => {
  const recs: ProvenanceRecord[] = [
    { subject: 'a', signer: 'ed25519', sha256: 'aabbccddeeff00112233', verified: true, timestamp: '2026-01-01T00:00:00Z' },
    { subject: 'b', signer: 'ed25519', sha256: 'ffee', verified: false, timestamp: '2026-01-02T00:00:00Z' },
    { subject: 'c', signer: 'hmac', verified: true, timestamp: '2026-01-03T00:00:00Z' },
  ];
  const v = buildProvenanceView(recs);
  assert.equal(v.total, 3);
  assert.equal(v.verified, 2);
  assert.equal(v.unverified, 1);
});

test('buildProvenanceView: newest-first ordering; unknown timestamps sink', () => {
  const recs: ProvenanceRecord[] = [
    { subject: 'old', timestamp: '2026-01-01T00:00:00Z', verified: true },
    { subject: 'new', timestamp: '2026-06-01T00:00:00Z', verified: true },
    { subject: 'no-time', verified: false }, // unparseable/absent → last
    { subject: 'mid', timestamp: '2026-03-01T00:00:00Z', verified: false },
  ];
  const v = buildProvenanceView(recs);
  assert.deepEqual(
    v.records.map((r) => r.subject),
    ['new', 'mid', 'old', 'no-time'],
  );
});

test('buildProvenanceView: sha256 shortened to 12 hex chars, sha256: prefix stripped', () => {
  const v = buildProvenanceView([
    { subject: 'x', sha256: 'sha256:AABBCCDDEEFF00112233445566', verified: true, timestamp: '2026-01-01T00:00:00Z' },
  ]);
  assert.equal(v.records[0].sha256Short, 'aabbccddeeff');
});

test('buildProvenanceView: malformed / missing fields degrade to safe defaults', () => {
  const recs = [
    { subject: 123, signer: null, sha256: 'not-hex!!', verified: 'yes', timestamp: 'garbage' },
    null,
    undefined,
    'string-not-object',
    {},
  ] as unknown as ProvenanceRecord[];
  const v = buildProvenanceView(recs);
  // null / undefined / non-object (string) entries are dropped; two object rows remain ({} + malformed).
  assert.equal(v.total, 2);
  const first = v.records.find((r) => r.sha256Short === '—' && r.timestamp === '');
  assert.ok(first, 'the malformed record should be present');
  assert.equal(first!.subject, '(unknown)'); // number subject is not a string → fallback
  assert.equal(first!.signer, '(unsigned)'); // null signer → fallback
  assert.equal(first!.sha256Short, '—'); // non-hex → em dash
  assert.equal(first!.verified, false); // 'yes' is a string, not === true → false
  assert.equal(first!.timestamp, ''); // unparseable → ''
});

test('buildProvenanceView: verified only true for strict boolean true', () => {
  const recs = [
    { subject: 'a', verified: true },
    { subject: 'b', verified: 1 },
    { subject: 'c', verified: 'true' },
  ] as unknown as ProvenanceRecord[];
  const v = buildProvenanceView(recs);
  assert.equal(v.verified, 1);
  assert.equal(v.unverified, 2);
});
