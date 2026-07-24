import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanWithPresidio, type PresidioScanPolicy } from '@/lib/adapters/presidio';
import { bindEncryptKey, type AnonymizerPolicy } from '@/lib/presidio-anonymizers';

// The gap this closes: an operator could configure per-entity operators (mask/hash/encrypt/keep) and
// the ADMIN TEST box honoured them, but PRODUCTION redaction (getPii().scan → scanWithPresidio) sent a
// hard-coded single `replace` for every entity — so the configured policy never governed real runs.
// These assert the TERMINAL artifact: the exact /anonymize wire body the production path sends.
// The ONLY fake is the network boundary.

const CONFIG = { analyzerUrl: 'http://presidio:5002', anonymizerUrl: 'http://presidio:5001', timeoutMs: 8000 };
const ENTITY = { entity_type: 'IN_PAN', start: 11, end: 21, score: 0.95 };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

// Records the /anonymize body the adapter actually posts.
function recordingFetch(seen: { anonymize?: unknown }): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (u.endsWith('/analyze')) return jsonResponse([ENTITY]);
    seen.anonymize = body;
    return jsonResponse({ text: 'My PAN is ****1234F', items: [] });
  }) as unknown as typeof fetch;
}

test('production path WITHOUT an operator policy keeps the legacy single-replace body', async () => {
  const seen: { anonymize?: unknown } = {};
  const res = await scanWithPresidio('My PAN is ABCDE1234F', CONFIG, {}, recordingFetch(seen));
  const body = seen.anonymize as { anonymizers: Record<string, unknown> };
  assert.deepEqual(body.anonymizers, { IN_PAN: { type: 'replace', new_value: '[IN_PAN]' } });
  assert.equal(res.hits, true);
  assert.equal(res.engine, 'presidio');
});

test("production path WITH an operator policy sends the operator's configured operators", async () => {
  const operators: AnonymizerPolicy = {
    default: { type: 'replace', newValue: '<PII>' },
    perEntity: { IN_PAN: { type: 'mask', maskingChar: '*', charsToMask: 6, fromEnd: false } },
  };
  const seen: { anonymize?: unknown } = {};
  await scanWithPresidio('My PAN is ABCDE1234F', CONFIG, { operators }, recordingFetch(seen));
  const body = seen.anonymize as { anonymizers: Record<string, unknown> };
  // The configured MASK reaches Presidio for IN_PAN, and the org DEFAULT rides along — not `replace`.
  assert.deepEqual(body.anonymizers.IN_PAN, {
    type: 'mask', masking_char: '*', chars_to_mask: 6, from_end: false,
  });
  assert.deepEqual(body.anonymizers.DEFAULT, { type: 'replace', new_value: '<PII>' });
});

test('an ENCRYPT policy carries the bound vault key to Presidio (never an empty key)', async () => {
  const key = 'k'.repeat(32);
  // The adapter receives an ALREADY-BOUND policy (loadPolicy binds the vaulted key); prove the bound
  // key is what reaches the wire.
  const { policy } = bindEncryptKey({ default: { type: 'replace' }, perEntity: { IN_PAN: { type: 'encrypt' } } }, key);
  const seen: { anonymize?: unknown } = {};
  await scanWithPresidio('My PAN is ABCDE1234F', CONFIG, { operators: policy }, recordingFetch(seen));
  const body = seen.anonymize as { anonymizers: Record<string, { type: string; key?: string }> };
  assert.deepEqual(body.anonymizers.IN_PAN, { type: 'encrypt', key });
  assert.notEqual(body.anonymizers.IN_PAN.key, '', 'an empty key would be rejected by Presidio');
});

test('encrypt with NO resolvable key degrades to masking on the wire — never plaintext', async () => {
  const { policy, downgraded } = bindEncryptKey(
    { default: { type: 'replace' }, perEntity: { IN_PAN: { type: 'encrypt' } } },
    null,
  );
  assert.deepEqual(downgraded, ['IN_PAN']);
  const seen: { anonymize?: unknown } = {};
  await scanWithPresidio('My PAN is ABCDE1234F', CONFIG, { operators: policy }, recordingFetch(seen));
  const body = seen.anonymize as { anonymizers: Record<string, unknown> };
  assert.deepEqual(body.anonymizers.IN_PAN, { type: 'replace' }, 'masked, not encrypted-with-empty-key');
});

test('a policy-driven scan still fails safe to local redaction when the anonymizer dies', async () => {
  const operators: AnonymizerPolicy = { default: { type: 'redact' }, perEntity: {} };
  const dying = (async (url: string | URL) =>
    String(url).endsWith('/analyze') ? jsonResponse([ENTITY]) : new Response('boom', { status: 500 })
  ) as unknown as typeof fetch;
  const res = await scanWithPresidio('My PAN is ABCDE1234F', CONFIG, { operators } as PresidioScanPolicy, dying);
  assert.equal(res.hits, true);
  assert.ok(!res.redacted?.includes('ABCDE1234F'), 'the raw PAN is gone even on the failure path');
  assert.equal(res.status, 'fallback');
});
