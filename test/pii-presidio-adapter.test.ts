import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { buildAnalyzeRequest, DEFAULT_THRESHOLDS } from '../src/lib/presidio-recognizers.ts';
import { presidioPii, resolveDeepConfigOrgId } from '../src/lib/adapters/pii.ts';

// Adapter-level regression guard for the Presidio PII scan. The bug this locks down: with Presidio
// reachable, the scan was silently degrading to the regex floor (result.engine === 'regex') even
// though /analyze would have answered. Two failure modes are covered:
//
//   1. The deep-config load (org recognizers + thresholds, which touches auth + DB) throwing MUST
//      NOT force a regex fallback — it must fall through to a PLAIN analyze and still report
//      engine:'presidio'. Under `node --test` there is no request/auth context and no DB, so the
//      dynamic import inside loadDeepConfig genuinely fails here — i.e. we exercise the real path,
//      not a simulated one. The only thing stubbed is the network (global fetch).
//   2. A Presidio 200 with entities is reported as engine:'presidio' with the entities, and a
//      Presidio 200 with NO entities is STILL engine:'presidio' (a real "found nothing" answer),
//      distinct from a Presidio error which is the only thing that legitimately drops to regex.

const realFetch = globalThis.fetch;
const PRESIDIO_URL = 'http://127.0.0.1:8938';

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.OFFGRID_PRESIDIO_URL;
  delete process.env.OFFGRID_PRESIDIO_ANONYMIZER_URL;
});

// A minimal /analyze stub: returns a canned analyzer-result list for POST /analyze, records the
// request body it saw, and 404s anything else. Anonymizer is intentionally NOT wired (so the scan
// falls back to local span redaction, keeping the test free of a second service).
function stubAnalyze(entities: Array<{ entity_type: string; start: number; end: number; score?: number }>) {
  const seen: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/analyze')) {
      seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(entities), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return seen;
}

test('scan: a recognizers/deep-config load failure does NOT force a regex fallback — plain analyze still runs as presidio', async () => {
  process.env.OFFGRID_PRESIDIO_URL = PRESIDIO_URL;
  // No DB / no auth context here → loadDeepConfig's dynamic import throws internally and is
  // swallowed. If the scan degraded on that (the regression), engine would be 'regex'.
  const seen = stubAnalyze([{ entity_type: 'PERSON', start: 0, end: 4, score: 0.95 }]);

  const r = await presidioPii.scan('John lives here');

  assert.equal(r.engine, 'presidio', 'must stay on presidio despite the deep-config load failing');
  assert.equal(r.hits, true);
  assert.deepEqual(r.entities, ['PERSON']);
  assert.match(r.redacted ?? '', /\[PERSON\]/);
  // And it must have actually reached Presidio with a valid, minimal body.
  assert.equal(seen.length, 1);
  const body = seen[0].body as Record<string, unknown>;
  assert.equal(body.text, 'John lives here');
  assert.equal(body.language, 'en');
  // Even with no org-custom recognizers loadable, the body carries the always-on Indian-BFSI
  // default set (PAN/Aadhaar/IFSC/UPI) as valid PatternRecognizers — G-F2. These are a NON-empty,
  // well-formed ad_hoc_recognizers array (the degenerate EMPTY array that could 400 /analyze is
  // still never sent), so the request stays a valid presidio analyze, not a regex fallback.
  const adhoc = body.ad_hoc_recognizers as Array<{ supported_entity: string }> | undefined;
  assert.ok(Array.isArray(adhoc) && adhoc.length === 4, 'default recognizer set rides the body');
  assert.deepEqual(
    adhoc?.map((r) => r.supported_entity).sort(),
    ['IN_AADHAAR', 'IN_IFSC', 'IN_PAN', 'UPI_ID'],
  );
});

test('scan: Presidio 200 with no entities is reported as presidio (not regex) — "found nothing" is a real answer', async () => {
  process.env.OFFGRID_PRESIDIO_URL = PRESIDIO_URL;
  stubAnalyze([]);

  const r = await presidioPii.scan('nothing sensitive here');

  assert.equal(r.engine, 'presidio');
  assert.equal(r.hits, false);
  assert.deepEqual(r.entities, []);
  assert.equal(r.redacted, 'nothing sensitive here');
});

test('scan: Presidio error (non-2xx) is the ONLY thing that degrades to the regex floor', async () => {
  process.env.OFFGRID_PRESIDIO_URL = PRESIDIO_URL;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/analyze')) {
      return new Response('bad ad_hoc_recognizer', { status: 400 });
    }
    return new Response('nf', { status: 404 });
  }) as typeof fetch;

  // A regex-detectable email so we can confirm the floor actually engaged.
  const r = await presidioPii.scan('mail me at jane@example.com');
  assert.equal(r.engine, 'regex', 'a Presidio 400 must fall back to the regex floor');
  assert.equal(r.hits, true);
  assert.deepEqual(r.entities, ['EMAIL_ADDRESS']);
});

test('scan: no OFFGRID_PRESIDIO_URL configured → regex floor without any network call', async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response('x', { status: 200 });
  }) as typeof fetch;

  const r = await presidioPii.scan('mail me at bob@corp.io');
  assert.equal(r.engine, 'regex');
  assert.equal(called, false, 'must not touch the network when Presidio is unconfigured');
});

// ── Gap #121: org deep-config resolves via an EXPLICIT orgId on the worker path, no headers() ──────

test('resolveDeepConfigOrgId: an explicit orgId is used verbatim and the session resolver is NEVER called (worker path)', async () => {
  let resolverCalled = false;
  const sessionResolver = async () => {
    resolverCalled = true;
    // On the durable worker there is no request scope, so a real currentOrgId() would throw here.
    throw new Error('headers() called outside a request scope');
  };
  const orgId = await resolveDeepConfigOrgId('acme-corp', sessionResolver);
  assert.equal(orgId, 'acme-corp');
  assert.equal(resolverCalled, false, 'explicit orgId must bypass the session/headers() path entirely');
});

test('resolveDeepConfigOrgId: a blank/whitespace explicit org falls through to the session resolver (request path)', async () => {
  const sessionResolver = async () => 'session-org';
  assert.equal(await resolveDeepConfigOrgId(undefined, sessionResolver), 'session-org');
  assert.equal(await resolveDeepConfigOrgId('', sessionResolver), 'session-org');
  assert.equal(await resolveDeepConfigOrgId('   ', sessionResolver), 'session-org');
});

test('resolveDeepConfigOrgId: an explicit orgId is trimmed', async () => {
  const orgId = await resolveDeepConfigOrgId('  team-7  ', async () => 'unused');
  assert.equal(orgId, 'team-7');
});

test('scan(text, orgId): passing an explicit orgId scans as presidio without needing a request scope', async () => {
  // The worker path: an explicit orgId means the deep-config resolver never calls headers(). Under
  // node --test there is no request scope AND no DB, so this proves the scan completes as presidio
  // (deep-config load degrades to plain analyze on the missing DB, but NOT to the regex floor and
  // NOT via a headers() throw). This is the end-to-end shape the app-worker guardrail step relies on.
  process.env.OFFGRID_PRESIDIO_URL = PRESIDIO_URL;
  const seen = stubAnalyze([{ entity_type: 'EMAIL_ADDRESS', start: 11, end: 27, score: 0.9 }]);

  const r = await presidioPii.scan('mail me at jane@example.com', 'explicit-org');

  assert.equal(r.engine, 'presidio', 'explicit-org worker path must still reach Presidio');
  assert.equal(r.hits, true);
  assert.deepEqual(r.entities, ['EMAIL_ADDRESS']);
  assert.equal(seen.length, 1);
  assert.equal((seen[0].body as Record<string, unknown>).text, 'mail me at jane@example.com');
});

// Pure-builder guard (also lives in presidio-recognizers.test.ts, restated here as the load-bearing
// invariant behind the adapter): with no org-custom recognizers the body still carries the always-on
// Indian-BFSI default set as a NON-empty, well-formed ad_hoc_recognizers array — never the degenerate
// EMPTY array that Presidio can 400 on, and never a missing entity/regex. G-F2.
test('buildAnalyzeRequest: no custom recognizers → ships the 4 default recognizers, never an empty array', () => {
  const req = buildAnalyzeRequest('hello', [], DEFAULT_THRESHOLDS);
  assert.equal(req.text, 'hello');
  assert.equal(req.language, 'en');
  assert.equal(req.ad_hoc_recognizers?.length, 4);
  for (const r of req.ad_hoc_recognizers ?? []) {
    assert.ok(r.supported_entity, 'each default recognizer has an entity');
    assert.ok(r.patterns && r.patterns.length > 0, 'each default is a pattern recognizer');
  }
});
