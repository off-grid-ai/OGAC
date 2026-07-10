import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectDialect } from '../src/lib/connector-exec.ts';
import { validateConnectorCreate, validateConnectorUpdate } from '../src/lib/connector-policy.ts';
import { isPublicEndpointHost, isPublicHost } from '../src/lib/connector-endpoint.ts';
import { checkRateLimit, type Counter } from '../src/lib/rate-limit.ts';
import { analyticsScopeFilters, buildAggsQuery, scopedQuery } from '../src/lib/analytics-aggs.ts';

// ─── ADVERSARIAL (QA bug-hunt / SECURITY #236) — SSRF + PATCH bypass + rate-limit wedge + tenant leak
// Each block is RED against the pre-fix code and GREEN after the fix in this branch. Every assertion
// pins the TERMINAL outcome (rejected / not-wedged / cross-tenant-excluded), not an intermediate.

// ══ G-ADV-DATA-2: connector SSRF — a private/link-local/metadata host is rejected before any fetch ══
// The pure guard connector-endpoint.ts#isPublicEndpointHost is applied by BOTH validateConnectorCreate
// and validateConnectorUpdate, so neither the create form nor the PATCH edit can store/reach a
// connector pointed at the cloud metadata IP, loopback, or an RFC-1918 host.
test('G-ADV-DATA-2: the SSRF host guard rejects link-local / loopback / RFC-1918 endpoints', () => {
  assert.equal(typeof isPublicEndpointHost, 'function', 'a public-host SSRF guard must exist');
  // Cloud metadata IP — the classic SSRF target.
  assert.equal(isPublicEndpointHost('http://169.254.169.254/latest/meta-data/'), false);
  // Loopback (the internal warehouse) + localhost (the vault).
  assert.equal(isPublicEndpointHost('http://127.0.0.1:8941/'), false);
  assert.equal(isPublicEndpointHost('http://localhost:8200/'), false);
  // RFC-1918 private ranges.
  assert.equal(isPublicEndpointHost('http://10.0.0.5/internal'), false);
  assert.equal(isPublicEndpointHost('http://172.16.0.1/x'), false);
  assert.equal(isPublicEndpointHost('http://192.168.1.1/x'), false);
  // IPv6 loopback / link-local.
  assert.equal(isPublicHost('::1'), false);
  assert.equal(isPublicHost('[fe80::1]'), false);
  // A genuine public host is allowed.
  assert.equal(isPublicEndpointHost('https://api.example.com/v1'), true);
  assert.equal(isPublicHost('api.example.com'), true);
});

// The metadata-IP REST endpoint is STILL a recognized dialect (nothing changed there) — the guard is
// the layer that refuses it, not detectDialect. This documents the surface the guard now closes.
test('control: detectDialect still recognizes a metadata-IP REST endpoint (guard is the gate, not this)', () => {
  assert.equal(detectDialect('rest', 'http://169.254.169.254/latest/meta-data/'), 'rest');
});

// TERMINAL: the metadata-IP is refused at the actual create gate the POST route runs.
test('G-ADV-DATA-2: validateConnectorCreate REJECTS a metadata-IP REST base URL (terminal)', () => {
  const res = validateConnectorCreate({ name: 'x', type: 'rest', baseUrl: 'http://169.254.169.254/latest/' });
  assert.equal(res.ok, false);
  assert.equal(res.value, null);
});

// TERMINAL: a SQL connector whose host is a private/loopback address is refused on create.
test('G-ADV-DATA-2: validateConnectorCreate REJECTS a loopback SQL host (terminal)', () => {
  const res = validateConnectorCreate({
    name: 'x', type: 'postgres', host: '127.0.0.1', database: 'd', user: 'u', password: 'p',
  });
  assert.equal(res.ok, false);
  // A genuine public SQL host still creates.
  const ok = validateConnectorCreate({
    name: 'x', type: 'postgres', host: 'db.example.com', database: 'd', user: 'u', password: 'p',
  });
  assert.equal(ok.ok, true);
});

// ══ G-ADV-DATA-3: PATCH cannot bypass validation — a shared validator gates type + endpoint ══
// TERMINAL: the metadata-IP + non-http + coming-soon inputs that create rejects are ALSO rejected on
// edit (the PATCH route runs validateConnectorUpdate before touching the store).
test('G-ADV-DATA-3: validateConnectorUpdate REJECTS non-http / private / bad-type edits (terminal)', () => {
  assert.equal(typeof validateConnectorUpdate, 'function');
  // A file:// endpoint (create refuses non-http; edit must too).
  assert.equal(validateConnectorUpdate({ endpoint: 'file:///etc/passwd' }).ok, false);
  // A metadata-IP / loopback / private endpoint (the SSRF pivot) is refused on edit.
  assert.equal(validateConnectorUpdate({ endpoint: 'http://169.254.169.254/latest/' }).ok, false);
  assert.equal(validateConnectorUpdate({ endpoint: 'http://127.0.0.1:8941/' }).ok, false);
  assert.equal(validateConnectorUpdate({ endpoint: 'postgres://u@10.0.0.5:5432/db' }).ok, false);
  // gopher:// (another SSRF scheme) is refused.
  assert.equal(validateConnectorUpdate({ endpoint: 'gopher://127.0.0.1:6379/_INFO' }).ok, false);
  // A coming-soon / unknown type must be refused on edit just like on create.
  assert.equal(validateConnectorUpdate({ type: 'snowflake' }).ok, false);
  assert.equal(validateConnectorUpdate({ type: 'totally-made-up' }).ok, false);
});

// A LEGITIMATE edit still passes — the validator is a guard, not a wall: a public REST endpoint, a
// public SQL connection URL, a valid type change, and an empty patch (metadata-only edit) all pass.
test('G-ADV-DATA-3: validateConnectorUpdate ALLOWS a legitimate public edit', () => {
  assert.equal(validateConnectorUpdate({ endpoint: 'https://api.example.com/v2' }).ok, true);
  assert.equal(validateConnectorUpdate({ endpoint: 'postgres://u@db.example.com:5432/prod' }).ok, true);
  assert.equal(validateConnectorUpdate({ type: 'postgres' }).ok, true);
  assert.equal(validateConnectorUpdate({}).ok, true); // name/description-only edit
});

// Proof the asymmetry existed: create rejects exactly what PATCH used to wave through.
test('control: create rejects file:// + coming-soon type (the exact inputs PATCH let through)', () => {
  assert.equal(validateConnectorCreate({ name: 'x', type: 'rest', baseUrl: 'file:///etc/passwd' }).ok, false);
  assert.equal(validateConnectorCreate({ name: 'x', type: 'snowflake', baseUrl: 'https://ok.example.com' }).ok, false);
});

// ══ G-ADV-GW-1: a NaN clock must NOT permanently wedge the bucket ══
// Pre-fix: checkRateLimit(now=NaN) set resetAt = NaN + windowMs = NaN; every later `now > resetAt`
// compares against NaN (always false) → the window never resets → the bucket denies FOREVER once its
// count exceeds the limit. The fix clamps a non-finite clock so resetAt stays finite.
test('G-ADV-GW-1: a NaN clock does not permanently wedge the bucket (terminal: real time still allowed)', () => {
  const counters = new Map<string, Counter>();
  const cfg = { limit: 2, windowMs: 60_000 };
  // Hammer the bucket with a NaN clock past the limit — pre-fix this poisons resetAt = NaN.
  checkRateLimit('k', cfg, NaN, counters);
  checkRateLimit('k', cfg, NaN, counters);
  checkRateLimit('k', cfg, NaN, counters);
  const denied = checkRateLimit('k', cfg, NaN, counters);
  assert.equal(denied.allow, false, 'over-limit under a NaN clock is denied (expected)');
  // resetAt must be a FINITE number — never NaN — or the window can never expire.
  assert.equal(Number.isFinite(counters.get('k')!.resetAt), true, 'resetAt must stay finite, not NaN');
  // TERMINAL: a subsequent REAL timestamp well past the window resets the bucket and allows again —
  // the bucket is NOT wedged forever.
  const later = checkRateLimit('k', cfg, 10_000_000_000, counters);
  assert.equal(later.allow, true, 'a real clock past the window must reset and allow — bucket not wedged');
});

// ±Infinity is handled the same way (non-finite clamp).
test('G-ADV-GW-1: an Infinity clock also stays finite (no wedge)', () => {
  const counters = new Map<string, Counter>();
  const cfg = { limit: 1, windowMs: 1000 };
  checkRateLimit('k', cfg, Infinity, counters);
  assert.equal(Number.isFinite(counters.get('k')!.resetAt), true);
});

// ══ G-ADV-OBS-ORG: analytics/logs queries carry an `org` term so a tenant never counts another's docs
// The pure query builders add `{ term: { org } }` when an org is supplied. Org A's query filters to
// org A's docs; it cannot match a doc stamped org B.
test('G-ADV-OBS-ORG: analyticsScopeFilters adds an org term that scopes to exactly one tenant', () => {
  const a = analyticsScopeFilters('org-a');
  assert.deepEqual(a, [{ term: { org: 'org-a' } }]);
  // A different org yields a DIFFERENT term — org A's filter can never match an org-b doc.
  const b = analyticsScopeFilters('org-b');
  assert.notDeepEqual(a, b);
  // The pipeline tag is layered on top, org term first.
  assert.deepEqual(analyticsScopeFilters('org-a', 'pipeline:1'), [
    { term: { org: 'org-a' } },
    { term: { 'project.keyword': 'pipeline:1' } },
  ]);
  // No org → no org scoping (single-tenant / default org), the historical behavior.
  assert.deepEqual(analyticsScopeFilters(null), []);
  assert.deepEqual(scopedQuery([]), { match_all: {} });
});

test('G-ADV-OBS-ORG: buildAggsQuery scopes the whole rollup to the caller org (terminal)', () => {
  const qa = buildAggsQuery(Date.now(), null, 'org-a') as { query: { bool: { filter: unknown[] } } };
  const filters = qa.query.bool.filter;
  // The org term is present — the aggregation only rolls up org A's docs.
  assert.ok(
    filters.some((f) => JSON.stringify(f) === JSON.stringify({ term: { org: 'org-a' } })),
    'the aggregation query must carry the caller org term',
  );
  // Org B's query does NOT carry org A's term — no cross-tenant counting.
  const qb = buildAggsQuery(Date.now(), null, 'org-b') as { query: { bool: { filter: unknown[] } } };
  assert.equal(
    qb.query.bool.filter.some((f) => JSON.stringify(f) === JSON.stringify({ term: { org: 'org-a' } })),
    false,
    "org B's query must never filter on org A",
  );
  // With no org, the query stays match_all (unchanged single-tenant behavior).
  const q0 = buildAggsQuery(Date.now(), null) as { query: Record<string, unknown> };
  assert.deepEqual(q0.query, { match_all: {} });
});
