import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anonymizeWithPolicy } from '@/lib/adapters/presidio-anonymize';
import { DEFAULT_ANONYMIZER_POLICY, type AnonymizerPolicy } from '@/lib/presidio-anonymizers';
import { DEFAULT_THRESHOLDS } from '@/lib/presidio-recognizers';

// Orchestration test for the advanced-anonymizer adapter. The ONLY fake is at the network boundary
// (a stub `fetch`) + the DB loaders (injected pure values) — the REAL request builder, threshold
// filter, response normalizer, and status logic all run. Asserts the terminal artifact: the masked
// text + the honest status.

const CONFIG = { analyzerUrl: 'http://presidio:5002', anonymizerUrl: 'http://presidio:5001', timeoutMs: 8000 };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? status : status,
    headers: { 'content-type': 'application/json' },
  });
}

// A fetcher that routes /analyze and /anonymize to canned handlers, recording the bodies it saw.
function fakeFetch(handlers: {
  analyze?: (body: unknown) => Response | Promise<Response>;
  anonymize?: (body: unknown) => Response | Promise<Response>;
  seen?: { analyze?: unknown; anonymize?: unknown };
}): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (u.endsWith('/analyze')) {
      if (handlers.seen) handlers.seen.analyze = body;
      return handlers.analyze ? handlers.analyze(body) : jsonResponse([]);
    }
    if (handlers.seen) handlers.seen.anonymize = body;
    return handlers.anonymize ? handlers.anonymize(body) : jsonResponse({ text: '', items: [] });
  }) as unknown as typeof fetch;
}

const stubLoaders = (policy: AnonymizerPolicy) => ({
  loadRecognizers: async () => [],
  loadThresholds: async () => DEFAULT_THRESHOLDS,
  loadPolicy: async () => policy,
});

test('unconfigured when no analyzer/anonymizer URL is set', async () => {
  const res = await anonymizeWithPolicy('My PAN is ABCDE1234F', 'org', {
    config: { analyzerUrl: null, anonymizerUrl: null, timeoutMs: 8000 },
  });
  assert.equal(res.configured, false);
  assert.equal(res.status, 'unconfigured');
  assert.equal(res.text, 'My PAN is ABCDE1234F'); // untouched
  assert.match(res.reason ?? '', /not configured/);
});

test('applied: analyzer detects, anonymizer masks per the operator policy', async () => {
  const seen: { analyze?: unknown; anonymize?: unknown } = {};
  const fetcher = fakeFetch({
    seen,
    analyze: () => jsonResponse([{ entity_type: 'IN_PAN', start: 10, end: 20, score: 0.95 }]),
    anonymize: (body) => {
      // Assert the request honored the MASK operator (not a hard-coded replace).
      const b = body as { anonymizers: Record<string, { type: string; chars_to_mask?: number }> };
      assert.equal(b.anonymizers.IN_PAN.type, 'mask');
      assert.equal(b.anonymizers.IN_PAN.chars_to_mask, 6);
      assert.equal(b.anonymizers.DEFAULT.type, 'replace');
      return jsonResponse({
        text: 'My PAN is ******234F',
        items: [{ start: 10, end: 20, entity_type: 'IN_PAN', text: '******234F', operator: 'mask' }],
      });
    },
  });

  const res = await anonymizeWithPolicy('My PAN is ABCDE1234F', 'org', {
    config: CONFIG,
    fetcher,
    ...stubLoaders(DEFAULT_ANONYMIZER_POLICY),
  });

  assert.equal(res.status, 'applied');
  assert.equal(res.configured, true);
  assert.equal(res.text, 'My PAN is ******234F'); // terminal artifact — the masked string
  assert.deepEqual(res.entities, ['IN_PAN']);
  assert.equal(res.items[0].operator, 'mask');
  // The analyze call still went out with the org detection config.
  assert.ok((seen.analyze as { text: string }).text === 'My PAN is ABCDE1234F');
});

test('applied with no entities: clean text passes through unchanged, no anonymize call', async () => {
  let anonymizeCalled = false;
  const fetcher = fakeFetch({
    analyze: () => jsonResponse([]),
    anonymize: () => {
      anonymizeCalled = true;
      return jsonResponse({ text: '', items: [] });
    },
  });
  const res = await anonymizeWithPolicy('nothing sensitive here', 'org', {
    config: CONFIG,
    fetcher,
    ...stubLoaders(DEFAULT_ANONYMIZER_POLICY),
  });
  assert.equal(res.status, 'applied');
  assert.equal(res.text, 'nothing sensitive here');
  assert.deepEqual(res.entities, []);
  assert.equal(anonymizeCalled, false, 'no anonymize call when nothing detected');
});

test('down: analyzer unreachable → status down, text untouched', async () => {
  const fetcher = fakeFetch({
    analyze: () => {
      throw new Error('ECONNREFUSED');
    },
  });
  const res = await anonymizeWithPolicy('My PAN is ABCDE1234F', 'org', {
    config: CONFIG,
    fetcher,
    ...stubLoaders(DEFAULT_ANONYMIZER_POLICY),
  });
  assert.equal(res.status, 'down');
  assert.equal(res.configured, true);
  assert.equal(res.text, 'My PAN is ABCDE1234F');
  assert.match(res.reason ?? '', /analyzer unavailable/);
});

test('down: analyzer returns non-2xx → status down', async () => {
  const fetcher = fakeFetch({
    analyze: () => jsonResponse({ error: 'boom' }, false, 500),
  });
  const res = await anonymizeWithPolicy('My PAN is ABCDE1234F', 'org', {
    config: CONFIG,
    fetcher,
    ...stubLoaders(DEFAULT_ANONYMIZER_POLICY),
  });
  assert.equal(res.status, 'down');
  assert.match(res.reason ?? '', /Presidio 500/);
});

test('fallback: anonymizer errors after a detection → text left unmasked, entities still reported', async () => {
  const fetcher = fakeFetch({
    analyze: () => jsonResponse([{ entity_type: 'IN_PAN', start: 10, end: 20, score: 0.95 }]),
    anonymize: () => {
      throw new Error('anonymizer down');
    },
  });
  const res = await anonymizeWithPolicy('My PAN is ABCDE1234F', 'org', {
    config: CONFIG,
    fetcher,
    ...stubLoaders(DEFAULT_ANONYMIZER_POLICY),
  });
  assert.equal(res.status, 'fallback');
  assert.equal(res.text, 'My PAN is ABCDE1234F'); // unmasked
  assert.deepEqual(res.entities, ['IN_PAN']);
  assert.match(res.reason ?? '', /anonymizer unavailable/);
});

test('fallback: anonymizer returns no change → status fallback', async () => {
  const fetcher = fakeFetch({
    analyze: () => jsonResponse([{ entity_type: 'IN_PAN', start: 10, end: 20, score: 0.95 }]),
    anonymize: (body) => {
      // Echo the original text back with no items → "no changes".
      const b = body as { text: string };
      return jsonResponse({ text: b.text, items: [] });
    },
  });
  const res = await anonymizeWithPolicy('My PAN is ABCDE1234F', 'org', {
    config: CONFIG,
    fetcher,
    ...stubLoaders(DEFAULT_ANONYMIZER_POLICY),
  });
  assert.equal(res.status, 'fallback');
  assert.match(res.reason ?? '', /no changes/);
});

test('loader failure degrades to defaults, still masks', async () => {
  const fetcher = fakeFetch({
    analyze: () => jsonResponse([{ entity_type: 'IN_PAN', start: 10, end: 20, score: 0.95 }]),
    anonymize: (body) => {
      const b = body as { anonymizers: Record<string, { type: string }> };
      // Default BFSI policy (used when the loader throws) masks IN_PAN.
      assert.equal(b.anonymizers.IN_PAN.type, 'mask');
      return jsonResponse({
        text: 'My PAN is ******234F',
        items: [{ start: 10, end: 20, entity_type: 'IN_PAN', text: '******234F', operator: 'mask' }],
      });
    },
  });
  const res = await anonymizeWithPolicy('My PAN is ABCDE1234F', '', {
    config: CONFIG,
    fetcher,
    loadRecognizers: async () => [],
    loadThresholds: async () => DEFAULT_THRESHOLDS,
    loadPolicy: async () => {
      throw new Error('policy store down');
    },
  });
  assert.equal(res.status, 'applied');
  assert.equal(res.text, 'My PAN is ******234F');
});
