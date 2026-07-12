import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyOutcome,
  DEFAULT_SIEM_INDEX,
  filterByOutcome,
  normalizeSiem,
  type RawSiemHit,
  resolveSiemIndex,
} from '../src/lib/siem-view.ts';

// Pure SIEM/security-events normalizer. No network, no mocks — sample OpenSearch hits in, asserted
// display model out. Covers a realistic response, empty input, and malformed/partial shapes.

// A trimmed but realistic OpenSearch _search response for the security index.
const SAMPLE = {
  hits: {
    hits: [
      {
        _id: 'a1',
        _source: {
          '@timestamp': '2026-07-01T10:00:00Z',
          actor: 'alice@corp',
          action: 'login',
          outcome: 'success',
          sourceIp: '10.0.0.5',
        },
      },
      {
        _id: 'a2',
        _source: {
          '@timestamp': '2026-07-03T12:30:00Z',
          user: 'bob@corp',
          event: 'access.denied',
          result: 'denied',
          client_ip: '10.0.0.9',
          reason: 'insufficient role',
        },
      },
      {
        _id: 'a3',
        _source: {
          '@timestamp': '2026-07-02T08:15:00Z',
          principal: 'alice@corp',
          action: 'query',
          status: 403,
        },
      },
      {
        _id: 'a4',
        _source: {
          '@timestamp': '2026-07-04T09:00:00Z',
          subject: 'scanner',
          action: 'upload',
          outcome: 'blocked',
          ip: '203.0.113.7',
        },
      },
    ],
  },
};

test('normalizeSiem: realistic response → events newest-first with rollups', () => {
  const v = normalizeSiem(SAMPLE);

  assert.equal(v.total, 4);

  // Newest-first ordering by timestamp.
  assert.deepEqual(
    v.events.map((e) => e.id),
    ['a4', 'a2', 'a3', 'a1'],
  );

  // Field aliasing resolved.
  const denied = v.events.find((e) => e.id === 'a2')!;
  assert.equal(denied.actor, 'bob@corp');
  assert.equal(denied.action, 'access.denied');
  assert.equal(denied.outcome, 'denied');
  assert.equal(denied.ip, '10.0.0.9');
  assert.equal(denied.detail, 'insufficient role');

  // Status-code fallback classification (403 → denied).
  assert.equal(v.events.find((e) => e.id === 'a3')!.outcome, 'denied');

  // Rollups: byOutcome ordered denied/blocked/error/allowed/unknown, only present ones.
  assert.deepEqual(v.byOutcome, [
    { outcome: 'denied', count: 2 },
    { outcome: 'blocked', count: 1 },
    { outcome: 'allowed', count: 1 },
  ]);

  // Top actors sorted by count desc.
  assert.deepEqual(v.topActors, [
    { actor: 'alice@corp', count: 2 },
    { actor: 'bob@corp', count: 1 },
    { actor: 'scanner', count: 1 },
  ]);

  assert.equal(v.blockedDenied, 3);
});

test('normalizeSiem: structured actor object ({type,id,label}) renders its label, not "unknown"', () => {
  // The shipped audit docs carry the actor as a structured object (audit-actor.ts `actorFrom`),
  // NOT a bare string. Before the str() fix this fell through to '' → 'unknown' on every row.
  const hits: RawSiemHit[] = [
    {
      _id: 'e1',
      _source: {
        '@timestamp': '2026-07-10T10:00:00Z',
        actor: { type: 'user', id: 'priya.nair@surakshalife.example', label: 'Priya Nair' },
        action: 'run.execute',
        outcome: 'done',
        source_ip: '10.20.5.12',
      },
    },
    {
      _id: 'e2',
      _source: {
        // No label → falls back to id (still a real identity, never 'unknown').
        actor: { type: 'user', id: 'service@offgrid.local' },
        action: 'policy.push',
        outcome: 'ok',
      },
    },
  ];
  const v = normalizeSiem({ hits: { hits } });
  const e1 = v.events.find((e) => e.id === 'e1')!;
  const e2 = v.events.find((e) => e.id === 'e2')!;
  assert.equal(e1.actor, 'Priya Nair');
  assert.equal(e1.ip, '10.20.5.12');
  assert.equal(e2.actor, 'service@offgrid.local');
  assert.ok(!v.events.some((e) => e.actor === 'unknown'));
});

test('normalizeSiem: accepts a bare hits array', () => {
  const hits: RawSiemHit[] = [{ _id: 'x', _source: { actor: 'u', action: 'a', outcome: 'ok' } }];
  const v = normalizeSiem(hits);
  assert.equal(v.total, 1);
  assert.equal(v.events[0].outcome, 'allowed');
});

test('normalizeSiem: empty / null inputs → zeroed model', () => {
  for (const input of [null, undefined, [], { hits: { hits: [] } }] as const) {
    const v = normalizeSiem(input);
    assert.equal(v.total, 0);
    assert.deepEqual(v.events, []);
    assert.deepEqual(v.byOutcome, []);
    assert.deepEqual(v.topActors, []);
    assert.equal(v.blockedDenied, 0);
  }
});

test('normalizeSiem: malformed / partial hits are handled defensively', () => {
  const v = normalizeSiem({
    hits: {
      hits: [
        {}, // no _id, no _source
        { _source: {} }, // empty source
        { _id: 'm1', _source: { actor: 42, action: null, outcome: 'weird-verdict' } },
        { _id: 'm2', _source: { '@timestamp': 'not-a-date', outcome: 'allow' } },
      ],
    },
  });

  assert.equal(v.total, 4);
  // Missing ids get synthesized, missing fields default to 'unknown'.
  assert.equal(v.events.filter((e) => e.actor === 'unknown').length >= 2, true);
  assert.equal(v.events.filter((e) => e.action === 'unknown').length >= 2, true);
  // Numeric actor coerced to string.
  assert.equal(v.events.find((e) => e.id === 'm1')!.actor, '42');
  // Unknown verdict word + no status → 'unknown'.
  assert.equal(v.events.find((e) => e.id === 'm1')!.outcome, 'unknown');
  // Unparseable timestamp → empty string, not a crash.
  assert.equal(v.events.find((e) => e.id === 'm2')!.ts, '');
});

test('classifyOutcome: verdict words and status fallbacks', () => {
  assert.equal(classifyOutcome('DENIED', 0), 'denied');
  assert.equal(classifyOutcome('forbidden', 0), 'denied');
  assert.equal(classifyOutcome('Blocked', 0), 'blocked');
  assert.equal(classifyOutcome('success', 0), 'allowed');
  assert.equal(classifyOutcome('failed', 0), 'error');
  assert.equal(classifyOutcome('', 500), 'error');
  assert.equal(classifyOutcome('', 401), 'denied');
  assert.equal(classifyOutcome('', 404), 'blocked');
  assert.equal(classifyOutcome('', 200), 'allowed');
  assert.equal(classifyOutcome('', 0), 'unknown');
});

// ── resolveSiemIndex (SIEM read defaults to where the attributed audit stream ships) ─────────────
test('resolveSiemIndex: defaults to offgrid-audit when nothing is set', () => {
  assert.equal(resolveSiemIndex({}), 'offgrid-audit');
  assert.equal(DEFAULT_SIEM_INDEX, 'offgrid-audit');
});

test('resolveSiemIndex: falls back to the ship-side OFFGRID_OPENSEARCH_INDEX', () => {
  assert.equal(resolveSiemIndex({ OFFGRID_OPENSEARCH_INDEX: 'offgrid-audit' }), 'offgrid-audit');
  assert.equal(resolveSiemIndex({ OFFGRID_OPENSEARCH_INDEX: 'custom-audit' }), 'custom-audit');
});

test('resolveSiemIndex: explicit SIEM var wins over the ship-side var', () => {
  assert.equal(
    resolveSiemIndex({ OFFGRID_SIEM_INDEX: 'offgrid-security', OFFGRID_OPENSEARCH_INDEX: 'offgrid-audit' }),
    'offgrid-security',
  );
});

test('resolveSiemIndex: comma list is trimmed, deduped, and URL-encoded', () => {
  assert.equal(
    resolveSiemIndex({ OFFGRID_SIEM_INDEX: ' offgrid-audit , offgrid-security , offgrid-audit ' }),
    'offgrid-audit,offgrid-security',
  );
  // Empty/whitespace-only falls back to the default rather than an empty path segment.
  assert.equal(resolveSiemIndex({ OFFGRID_SIEM_INDEX: '  ' }), 'offgrid-audit');
});

test('filterByOutcome: narrows events, keeps rollups, ignores bad filter', () => {
  const v = normalizeSiem(SAMPLE);

  const denied = filterByOutcome(v, 'denied');
  assert.equal(denied.events.length, 2);
  assert.ok(denied.events.every((e) => e.outcome === 'denied'));
  // Rollups remain over the full set so chips show every total.
  assert.deepEqual(denied.byOutcome, v.byOutcome);
  assert.equal(denied.blockedDenied, 2);

  // Unknown / absent filter is a no-op.
  assert.equal(filterByOutcome(v, 'nonsense').events.length, 4);
  assert.equal(filterByOutcome(v, undefined).events.length, 4);
});
