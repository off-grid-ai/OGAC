import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  webSearchEgressAllowed,
  WEB_SEARCH_ENV,
  PRIMITIVE_EGRESS_ENV,
} from '../src/lib/tool-primitives.ts';
import {
  resolveWebSearchConfig,
  normalizeSearchResults,
  searchWeb,
  formatSearchResults,
  governedWebSearch,
  WEBSEARCH_URL_ENV,
  WEBSEARCH_KEY_ENV,
  WEBSEARCH_METHOD_ENV,
} from '../src/lib/adapters/web-search.ts';

// Real behaviour, no network: a FAKE provider `fetch` is injected so the adapter's real request
// shaping + normalization + all three governance gates are exercised end-to-end. (Online search as a
// governed tool — §14 Exa/Tavily parity.)

// ─── fake provider ────────────────────────────────────────────────────────────────────────────────
function fakeFetch(capture?: { url?: string; init?: RequestInit }, body: unknown = { results: [] }, ok = true) {
  return (async (url: string, init?: RequestInit) => {
    if (capture) {
      capture.url = url;
      capture.init = init;
    }
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

// ─── PURE egress-leash gate ─────────────────────────────────────────────────────────────────────
test('egress gate: cloud egress ALLOWS external web search', () => {
  const v = webSearchEgressAllowed('cloud');
  assert.equal(v.allow, true);
  assert.equal(v.egress, 'cloud');
});

test('egress gate: LOCAL-only egress REFUSES web search (never leaves the network)', () => {
  const v = webSearchEgressAllowed('local');
  assert.equal(v.allow, false);
  assert.match(v.reason, /LOCAL-ONLY/);
});

test('egress gate: BLOCK egress REFUSES web search', () => {
  const v = webSearchEgressAllowed('block');
  assert.equal(v.allow, false);
  assert.match(v.reason, /BLOCK/);
});

// ─── PURE config + normalization ─────────────────────────────────────────────────────────────────
test('config: unconfigured env → null (honest "not configured")', () => {
  assert.equal(resolveWebSearchConfig({}), null);
});

test('config: url + key + method resolve; method defaults to GET', () => {
  const cfg = resolveWebSearchConfig({
    [WEBSEARCH_URL_ENV]: 'https://searx.local/search',
    [WEBSEARCH_KEY_ENV]: 'sk-abc',
    [WEBSEARCH_METHOD_ENV]: 'post',
  });
  assert.deepEqual(cfg, { url: 'https://searx.local/search', key: 'sk-abc', method: 'POST' });
  const cfg2 = resolveWebSearchConfig({ [WEBSEARCH_URL_ENV]: 'https://x/y' });
  assert.equal(cfg2!.method, 'GET');
  assert.equal(cfg2!.key, undefined);
});

test('normalize: maps SearXNG/Tavily/generic shapes + honors limit, skips junk', () => {
  const searx = normalizeSearchResults(
    { results: [{ title: 'A', url: 'https://a', content: 'ca' }, { title: 'B', url: 'https://b' }] },
    5,
  );
  assert.equal(searx.length, 2);
  assert.deepEqual(searx[0], { title: 'A', url: 'https://a', snippet: 'ca' });
  // generic `data` + `link`/`description` aliases
  const generic = normalizeSearchResults({ data: [{ name: 'N', link: 'https://n', description: 'd' }] }, 5);
  assert.deepEqual(generic[0], { title: 'N', url: 'https://n', snippet: 'd' });
  // limit + junk-skip (no url/title entry dropped)
  const limited = normalizeSearchResults({ results: [{ title: '1', url: 'u1' }, {}, { title: '2', url: 'u2' }] }, 1);
  assert.equal(limited.length, 1);
});

// ─── searchWeb with a fake provider (real request shaping) ────────────────────────────────────────
test('searchWeb: unconfigured → not_configured, no results, no fetch', async () => {
  let called = false;
  const resp = await searchWeb('hello', {
    env: {},
    fetchImpl: (async () => {
      called = true;
      return {} as Response;
    }) as unknown as typeof fetch,
  });
  assert.equal(resp.status, 'not_configured');
  assert.equal(resp.ok, false);
  assert.equal(resp.results.length, 0);
  assert.equal(called, false, 'must not reach out when unconfigured');
});

test('searchWeb: GET provider — query encoded into the URL, results normalized', async () => {
  const cap: { url?: string } = {};
  const resp = await searchWeb('acme bank ifsc', {
    env: { [WEBSEARCH_URL_ENV]: 'https://searx.local/search' },
    fetchImpl: fakeFetch(cap, { results: [{ title: 'ACME', url: 'https://acme', content: 'about acme' }] }),
  });
  assert.equal(resp.ok, true);
  assert.equal(resp.status, 'ok');
  assert.equal(resp.results.length, 1);
  assert.ok(cap.url!.includes('q=acme%20bank%20ifsc'), cap.url);
});

test('searchWeb: POST provider — key becomes a bearer header, query in JSON body', async () => {
  const cap: { url?: string; init?: RequestInit } = {};
  await searchWeb('q1', {
    env: { [WEBSEARCH_URL_ENV]: 'https://api.tavily/search', [WEBSEARCH_KEY_ENV]: 'tvly-1', [WEBSEARCH_METHOD_ENV]: 'POST' },
    fetchImpl: fakeFetch(cap, { results: [] }),
  });
  const headers = cap.init!.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer tvly-1');
  assert.match(String(cap.init!.body), /"query":"q1"/);
});

test('searchWeb: provider 500 → honest error, not fabricated results', async () => {
  const resp = await searchWeb('x', {
    env: { [WEBSEARCH_URL_ENV]: 'https://searx.local' },
    fetchImpl: fakeFetch(undefined, {}, false),
  });
  assert.equal(resp.ok, false);
  assert.equal(resp.status, 'error');
  assert.match(resp.detail, /500/);
});

test('searchWeb: empty query → error before any fetch', async () => {
  const resp = await searchWeb('   ', { env: { [WEBSEARCH_URL_ENV]: 'https://x' } });
  assert.equal(resp.ok, false);
  assert.equal(resp.status, 'error');
});

// ─── governedWebSearch — the full three-gate composition ──────────────────────────────────────────
test('governed: air-gap OFF (no opt-in) → disabled, never reaches out', async () => {
  let called = false;
  const resp = await governedWebSearch('q', {
    env: { [WEBSEARCH_URL_ENV]: 'https://x' }, // provider configured, but tool NOT opted in
    egress: 'cloud',
    fetchImpl: (async () => {
      called = true;
      return {} as Response;
    }) as unknown as typeof fetch,
  });
  assert.equal(resp.status, 'disabled');
  assert.equal(resp.ok, false);
  assert.equal(called, false);
});

test('governed: opted-in but LOCAL-only egress → egress_blocked, never reaches out', async () => {
  let called = false;
  const resp = await governedWebSearch('q', {
    env: { [WEB_SEARCH_ENV]: '1', [WEBSEARCH_URL_ENV]: 'https://x' },
    egress: 'local',
    fetchImpl: (async () => {
      called = true;
      return {} as Response;
    }) as unknown as typeof fetch,
  });
  assert.equal(resp.status, 'egress_blocked');
  assert.equal(resp.ok, false);
  assert.equal(called, false, 'egress leash must block the reach');
});

test('governed: opted-in + cloud egress but UNCONFIGURED provider → not_configured', async () => {
  const resp = await governedWebSearch('q', {
    env: { [PRIMITIVE_EGRESS_ENV]: 'true' }, // master opt-in, no provider url
    egress: 'cloud',
  });
  assert.equal(resp.status, 'not_configured');
  assert.equal(resp.ok, false);
});

test('governed: opted-in + cloud egress + configured provider → real results', async () => {
  const resp = await governedWebSearch('rbi circular', {
    env: { [WEB_SEARCH_ENV]: 'yes', [WEBSEARCH_URL_ENV]: 'https://searx.local' },
    egress: 'cloud',
    fetchImpl: fakeFetch(undefined, {
      results: [
        { title: 'RBI', url: 'https://rbi.org.in', content: 'circular text' },
        { title: 'News', url: 'https://news', content: 'coverage' },
      ],
    }),
  });
  assert.equal(resp.ok, true);
  assert.equal(resp.status, 'ok');
  assert.equal(resp.results.length, 2);
  assert.match(formatSearchResults(resp as never), /1\. RBI — https:\/\/rbi\.org\.in/);
});

test('governed: default egress is cloud (no bound pipeline → additive, unchanged behaviour)', async () => {
  const resp = await governedWebSearch('q', {
    env: { [WEB_SEARCH_ENV]: '1', [WEBSEARCH_URL_ENV]: 'https://x' },
    // egress omitted → defaults to 'cloud'
    fetchImpl: fakeFetch(undefined, { results: [{ title: 'T', url: 'https://t' }] }),
  });
  assert.equal(resp.ok, true);
  assert.equal(resp.status, 'ok');
});
