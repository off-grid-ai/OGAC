import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auditFacets,
  auditFiltersToQuery,
  auditFiltersToSearchParams,
  auditRowsToCsv,
  auditRowsToJson,
  classifyAuditOutcome,
  DEFAULT_PAGE_SIZE,
  filterAuditRows,
  MAX_PAGE_SIZE,
  normalizeAudit,
  parseAuditFilters,
  type AuditRow,
} from '../src/lib/audit-log-view.ts';

// Pure audit-log view-model. No network, no mocks — sample OpenSearch hits (both the canonical
// Phase-4.11 shape AND the legacy device/gateway Shippable) in, asserted display model out. Plus the
// filter contract (parse/serialize/post-filter) and the CSV/JSON export serializers.

// ── normalizeAudit: canonical + legacy shapes ────────────────────────────────────────────────
// searchAudit FLATTENS hits (doc fields + id + score), so this mirrors real production output.
const CANONICAL = {
  total: 2,
  configured: true,
  hits: [
    {
      id: 'c1',
      score: null,
      ts: '2026-07-04T10:00:00Z',
      actor: { type: 'user', id: 'u1', label: 'alice@corp' },
      org: 'acme',
      project: 'billing',
      action: 'chat.send',
      resource: 'conv-123',
      model: 'llama-3.1-70b',
      tokens: { prompt: 100, completion: 40, total: 140 },
      costUsd: 0.0021,
      outcome: 'ok',
      runId: 'run-abc',
      ip: '10.0.0.9',
    },
    {
      id: 'c2',
      score: null,
      ts: '2026-07-05T09:00:00Z',
      actor: { type: 'machine', id: 'svc-agent-7' },
      project: 'ops',
      action: 'agent.run',
      tokens: { prompt: 10, completion: 5 }, // no total → summed
      outcome: 'blocked',
    },
  ],
};

test('normalizeAudit maps the canonical audit-event shape', () => {
  const v = normalizeAudit(CANONICAL);
  assert.equal(v.configured, true);
  assert.equal(v.total, 2);
  // newest-first: c2 (07-05) before c1 (07-04)
  assert.deepEqual(
    v.rows.map((r) => r.id),
    ['c2', 'c1'],
  );
  const alice = v.rows.find((r) => r.id === 'c1')!;
  assert.equal(alice.actor, 'alice@corp');
  assert.equal(alice.actorType, 'user');
  assert.equal(alice.action, 'chat.send');
  assert.equal(alice.project, 'billing');
  assert.equal(alice.resource, 'conv-123');
  assert.equal(alice.model, 'llama-3.1-70b');
  assert.equal(alice.tokens, 140);
  assert.equal(alice.costUsd, 0.0021);
  assert.equal(alice.outcome, 'ok');
  assert.equal(alice.runId, 'run-abc');

  const agent = v.rows.find((r) => r.id === 'c2')!;
  assert.equal(agent.actorType, 'machine');
  assert.equal(agent.actor, 'svc-agent-7'); // id used when no label
  assert.equal(agent.tokens, 15); // prompt+completion when total absent
  assert.equal(agent.outcome, 'blocked');
});

test('normalizeAudit maps the legacy device/gateway Shippable shape', () => {
  const legacy = {
    configured: true,
    total: 2,
    hits: [
      {
        id: 'run-1',
        score: null,
        runId: 'run-1',
        deviceId: 'agent:summarizer',
        keyId: 'client-42',
        model: 'gpt-oss-20b',
        outcome: 'error',
        tokens: 512, // flat number
        leftDevice: true,
        ts: '2026-07-02T08:00:00Z',
      },
      {
        id: 'dev-9',
        score: null,
        deviceId: 'macbook-pro-9',
        model: 'phi-3',
        outcome: 'success',
        tokens: 0,
        ts: '2026-07-01T08:00:00Z',
      },
    ],
  };
  const v = normalizeAudit(legacy);
  const run = v.rows.find((r) => r.id === 'run-1')!;
  assert.equal(run.actorType, 'machine');
  assert.equal(run.actor, 'client-42'); // keyId is the caller for agent: docs
  assert.equal(run.resource, 'agent:summarizer'); // deviceId falls into resource
  assert.equal(run.tokens, 512); // flat number honored
  assert.equal(run.outcome, 'error');
  const dev = v.rows.find((r) => r.id === 'dev-9')!;
  assert.equal(dev.actor, 'macbook-pro-9');
  assert.equal(dev.outcome, 'ok'); // 'success' → ok
});

test('normalizeAudit handles null / empty / bare-array input defensively', () => {
  assert.deepEqual(normalizeAudit(null), { total: 0, rows: [], configured: false, error: undefined });
  const bare = normalizeAudit([{ id: 'x', action: 'flag.toggle', outcome: 'ok' }]);
  assert.equal(bare.configured, true); // bare array assumed configured
  assert.equal(bare.total, 1);
  assert.equal(bare.rows[0].action, 'flag.toggle');
});

test('normalizeAudit tolerates raw _source-wrapped hits defensively', () => {
  const v = normalizeAudit([
    { _id: 'w1', _source: { action: 'secret.write', outcome: 'ok', project: 'vault' } },
  ]);
  assert.equal(v.rows[0].id, 'w1');
  assert.equal(v.rows[0].action, 'secret.write');
  assert.equal(v.rows[0].project, 'vault');
});

test('normalizeAudit surfaces the search error + rows without ts sort last', () => {
  const v = normalizeAudit({
    configured: true,
    error: 'OpenSearch 503',
    hits: [
      { id: 'no-ts', action: 'x', outcome: 'ok' },
      { id: 'has-ts', ts: '2026-07-01T00:00:00Z', action: 'y', outcome: 'ok' },
    ],
  });
  assert.equal(v.error, 'OpenSearch 503');
  assert.deepEqual(
    v.rows.map((r) => r.id),
    ['has-ts', 'no-ts'],
  );
});

// ── classifyAuditOutcome ─────────────────────────────────────────────────────────────────────
test('classifyAuditOutcome maps producer words into the canonical closed set', () => {
  assert.equal(classifyAuditOutcome('success'), 'ok');
  assert.equal(classifyAuditOutcome('OK'), 'ok');
  assert.equal(classifyAuditOutcome('redacted'), 'redacted');
  assert.equal(classifyAuditOutcome('blocked'), 'blocked');
  assert.equal(classifyAuditOutcome('forbidden'), 'denied');
  assert.equal(classifyAuditOutcome('failed'), 'error');
  assert.equal(classifyAuditOutcome(''), 'unknown');
  assert.equal(classifyAuditOutcome('weirdword'), 'unknown');
});

// ── parseAuditFilters ────────────────────────────────────────────────────────────────────────
test('parseAuditFilters trims, drops blanks, and clamps pagination', () => {
  const map: Record<string, string> = {
    q: '  hello  ',
    actor: 'alice@corp',
    action: '',
    project: '  ',
    outcome: 'blocked',
    from: '2026-07-01T00:00:00Z',
    page: '3',
    size: '9999',
  };
  const f = parseAuditFilters((k) => map[k] ?? null);
  assert.equal(f.q, 'hello');
  assert.equal(f.actor, 'alice@corp');
  assert.equal(f.action, undefined); // empty dropped
  assert.equal(f.project, undefined); // whitespace-only dropped
  assert.equal(f.outcome, 'blocked');
  assert.equal(f.page, 3);
  assert.equal(f.size, MAX_PAGE_SIZE); // clamped
});

test('parseAuditFilters defaults page=1 and size=DEFAULT for bad input', () => {
  const f = parseAuditFilters(() => null);
  assert.equal(f.page, 1);
  assert.equal(f.size, DEFAULT_PAGE_SIZE);
});

// ── auditFiltersToSearchParams ─────────────────────────────────────────────────────────────────
test('auditFiltersToSearchParams computes offset from page/size', () => {
  const p = auditFiltersToSearchParams({ page: 3, size: 50, actor: 'bob' });
  assert.equal(p.from_offset, 100);
  assert.equal(p.size, 50);
  assert.equal(p.actor, 'bob');
});

// ── auditFiltersToQuery ────────────────────────────────────────────────────────────────────────
test('auditFiltersToQuery serializes filters and optionally paging', () => {
  const base = auditFiltersToQuery({ actor: 'a b', outcome: 'ok', page: 2, size: 50 });
  assert.equal(base.includes('actor=a+b'), true);
  assert.equal(base.includes('outcome=ok'), true);
  assert.equal(base.includes('page='), false); // paging omitted by default
  const withPaging = auditFiltersToQuery({ actor: 'x', page: 2, size: 100 }, { includePaging: true });
  assert.equal(withPaging.includes('page=2'), true);
  assert.equal(withPaging.includes('size=100'), true);
});

// ── filterAuditRows (graceful-degradation post-filter) ──────────────────────────────────────────
const ROWS: AuditRow[] = [
  row({ id: '1', ts: '2026-07-01T00:00:00Z', actor: 'alice@corp', action: 'chat.send', project: 'billing', outcome: 'ok' }),
  row({ id: '2', ts: '2026-07-03T00:00:00Z', actor: 'bob@corp', action: 'agent.run', project: 'ops', outcome: 'blocked' }),
  row({ id: '3', ts: '2026-07-05T00:00:00Z', actor: 'alice@corp', action: 'policy.change', project: 'billing', outcome: 'ok' }),
];

test('filterAuditRows exact-matches actor/action/project/outcome case-insensitively', () => {
  assert.deepEqual(ids(filterAuditRows(ROWS, { actor: 'ALICE@CORP' })), ['1', '3']);
  assert.deepEqual(ids(filterAuditRows(ROWS, { action: 'agent.run' })), ['2']);
  assert.deepEqual(ids(filterAuditRows(ROWS, { project: 'ops' })), ['2']);
  assert.deepEqual(ids(filterAuditRows(ROWS, { outcome: 'ok' })), ['1', '3']);
});

test('filterAuditRows applies inclusive time-range on ts', () => {
  const r = filterAuditRows(ROWS, { from: '2026-07-02T00:00:00Z', to: '2026-07-04T00:00:00Z' });
  assert.deepEqual(ids(r), ['2']);
});

test('filterAuditRows is idempotent (already-narrowed set unchanged)', () => {
  const once = filterAuditRows(ROWS, { actor: 'alice@corp' });
  const twice = filterAuditRows(once, { actor: 'alice@corp' });
  assert.deepEqual(ids(once), ids(twice));
});

test('filterAuditRows with no filters returns everything', () => {
  assert.equal(filterAuditRows(ROWS, {}).length, 3);
});

test('filterAuditRows hideAutotest drops the autotest actor (only when the flag is set)', () => {
  const withAt: AuditRow[] = [
    ...ROWS,
    row({ id: 'at', ts: '2026-07-06T00:00:00Z', actor: 'autotest@offgrid', action: 'app.run', project: 'ops', outcome: 'ok' }),
  ];
  // Flag off → autotest row is kept (behaviour-preserving for non-demo tenants).
  assert.deepEqual(ids(filterAuditRows(withAt, {})), ['1', '2', '3', 'at']);
  // Flag on → autotest row is dropped.
  assert.deepEqual(ids(filterAuditRows(withAt, { hideAutotest: true })), ['1', '2', '3']);
});

// ── auditFacets ──────────────────────────────────────────────────────────────────────────────
test('auditFacets returns distinct sorted values', () => {
  const f = auditFacets(ROWS);
  assert.deepEqual(f.actors, ['alice@corp', 'bob@corp']);
  assert.deepEqual(f.actions, ['agent.run', 'chat.send', 'policy.change']);
  assert.deepEqual(f.projects, ['billing', 'ops']);
});

// ── CSV / JSON export serializers ──────────────────────────────────────────────────────────────
test('auditRowsToCsv writes a header + one row per record, CRLF-terminated', () => {
  const csv = auditRowsToCsv([ROWS[0]]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'time,actor_type,actor,action,project,resource,model,tokens,cost_usd,outcome,run_id,ip');
  assert.equal(lines[1].startsWith('2026-07-01T00:00:00Z,'), true);
  assert.equal(lines[1].includes('alice@corp'), true);
});

test('auditRowsToCsv quotes/escapes cells with commas or quotes', () => {
  const csv = auditRowsToCsv([row({ id: 'q', actor: 'a,b', resource: 'he said "hi"' })]);
  assert.equal(csv.includes('"a,b"'), true);
  assert.equal(csv.includes('"he said ""hi"""'), true);
});

test('auditRowsToJson round-trips to the row array', () => {
  const parsed = JSON.parse(auditRowsToJson(ROWS));
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].actor, 'alice@corp');
});

// ── helpers ────────────────────────────────────────────────────────────────────────────────────
function row(p: Partial<AuditRow>): AuditRow {
  return {
    id: 'x',
    ts: '',
    actorType: 'user',
    actor: 'someone',
    action: 'act',
    project: '',
    resource: '',
    model: '',
    tokens: 0,
    costUsd: 0,
    outcome: 'ok',
    runId: '',
    ip: '',
    ...p,
  };
}
function ids(rows: AuditRow[]): string[] {
  return rows.map((r) => r.id);
}
