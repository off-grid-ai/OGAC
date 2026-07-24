import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  opensearchBaseUrl,
  opensearchConfigured,
  opensearchFetch,
  opensearchHeaders,
} from '@/lib/opensearch-http';

// The ONE place the console decides how to authenticate to the SIEM cluster. Before this existed,
// siem/analytics/accounting/alerting each did a raw fetch with NO auth header — so turning the
// OpenSearch security plugin on would have 401'd every audit/analytics read, and flipping the
// credential PLAN alone would not have fixed it (the header still wouldn't be sent).
// These assert the TERMINAL artifact: the URL + headers actually put on the wire.

const realFetch = globalThis.fetch;
const savedUrl = process.env.OFFGRID_OPENSEARCH_URL;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedUrl === undefined) delete process.env.OFFGRID_OPENSEARCH_URL;
  else process.env.OFFGRID_OPENSEARCH_URL = savedUrl;
});

// Capture what the transport puts on the wire.
function capture(): { calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls };
}

test('base URL honours the env var and falls back to the documented default', () => {
  process.env.OFFGRID_OPENSEARCH_URL = 'http://os.test:9200';
  assert.equal(opensearchBaseUrl(), 'http://os.test:9200');
  assert.equal(opensearchConfigured(), true);
  delete process.env.OFFGRID_OPENSEARCH_URL;
  assert.equal(opensearchBaseUrl(), 'http://127.0.0.1:9200', 'same default the call sites used');
  assert.equal(opensearchConfigured(), false);
});

test('with the service OFF the credential plan, NO auth header is sent (pre-cutover behaviour kept)', async () => {
  // credentialPlan('opensearch') is 'none' today ⇒ the broker yields nothing ⇒ byte-identical to the
  // old raw fetch. This is what makes the transport safe to land before the cluster flips.
  const h = await opensearchHeaders({ 'content-type': 'application/json' });
  assert.equal(h.authorization, undefined, 'no Authorization while the cluster is security-off');
  assert.equal(h['content-type'], 'application/json', 'caller headers preserved');
});

test('opensearchFetch targets base+path and preserves the method, body and caller headers', async () => {
  process.env.OFFGRID_OPENSEARCH_URL = 'http://os.test:9200';
  const { calls } = capture();
  await opensearchFetch('/offgrid-audit/_search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"query":{"match_all":{}}}',
    timeoutMs: 5000,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://os.test:9200/offgrid-audit/_search');
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal((calls[0].init?.headers as Record<string, string>)['content-type'], 'application/json');
  assert.equal(calls[0].init?.body, '{"query":{"match_all":{}}}');
  assert.ok(calls[0].init?.signal, 'a timeout signal is always attached');
});

test('an ndjson _bulk ship keeps its content-type (the SIEM write path)', async () => {
  process.env.OFFGRID_OPENSEARCH_URL = 'http://os.test:9200';
  const { calls } = capture();
  await opensearchFetch('/_bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson' },
    body: '{}\n',
    timeoutMs: 4000,
  });
  assert.equal(calls[0].url, 'http://os.test:9200/_bulk');
  assert.equal((calls[0].init?.headers as Record<string, string>)['content-type'], 'application/x-ndjson');
});

test('a caller-supplied signal is respected instead of the default timeout', async () => {
  process.env.OFFGRID_OPENSEARCH_URL = 'http://os.test:9200';
  const { calls } = capture();
  const ac = new AbortController();
  await opensearchFetch('/_cluster/health', { signal: ac.signal });
  assert.equal(calls[0].init?.signal, ac.signal);
});
