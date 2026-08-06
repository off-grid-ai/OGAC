// The sixth cross-tenant leak of the same class, and the test that pins it shut.
//
// LIVE FINDING (2026-08-05, read-only demo audit). `GET /api/v1/prompts/common` queried the gateway
// index with `{ bool: { must: [{ exists: { field: 'input' } }] } }` — no org predicate at all — and
// returned the 25 most frequent prompt texts to whoever asked. Measured against the live index:
// 3,338 documents carry an `input`; 112 belong to org_bharat and 94 to org_suraksha. So each tenant's
// demo account could read the other tenant's verbatim prompts, which is the most sensitive content in
// the product — a prompt is a customer's own question, frequently with their data inside it.
//
// These tests assert the RULE rather than the implementation: the org reaches the query, an
// unattributable record reaches nobody, and there is no argument that turns the filter off.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCommonPromptsQuery,
  MAX_COMMON_PROMPTS,
  MAX_PROMPT_LEN,
  normalizePrompt,
  tallyCommonPrompts,
  type GatewayInputHit,
} from '@/lib/common-prompts';

const hit = (input: unknown, ts = '2026-08-05T10:00:00Z'): GatewayInputHit => ({
  _source: { input, '@timestamp': ts },
});

/** Pull every org term out of a built query, however the bool clauses are arranged. */
function orgTerms(query: Record<string, unknown>): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'term' && value && typeof value === 'object') {
        const term = value as Record<string, unknown>;
        if (typeof term['org.keyword'] === 'string') found.push(term['org.keyword'] as string);
      }
      walk(value);
    }
  };
  walk(query);
  return found;
}

test('the query filters on the org it was given', () => {
  assert.deepEqual(orgTerms(buildCommonPromptsQuery('org_suraksha')), ['org_suraksha']);
  assert.deepEqual(orgTerms(buildCommonPromptsQuery('org_bharat')), ['org_bharat']);
});

test('EVERY org produces a scoped query — there is no unscoped path', () => {
  // The pre-fix defect was a query with no org term at all. Any org-shaped input, including the
  // platform operator and odd-looking values, must still carry exactly one org filter.
  for (const org of ['org_suraksha', 'org_bharat', 'default', 'org_1c0e4d', 'queueprobe', '']) {
    const terms = orgTerms(buildCommonPromptsQuery(org));
    assert.equal(terms.length, 1, `org ${JSON.stringify(org)} produced ${terms.length} org filters`);
    assert.equal(terms[0], org);
  }
});

test('the two tenants never produce the same query', () => {
  // Cheap regression guard: if someone reintroduces a constant or drops the argument, these collapse
  // to an identical body and this fails.
  assert.notDeepEqual(
    buildCommonPromptsQuery('org_suraksha'),
    buildCommonPromptsQuery('org_bharat'),
  );
});

test('the input-exists predicate survives alongside the org filter', () => {
  // Scoping must not accidentally drop the condition that made the surface work.
  const q = JSON.stringify(buildCommonPromptsQuery('org_suraksha'));
  assert.ok(q.includes('"exists"'));
  assert.ok(q.includes('"input"'));
});

test('prompts are counted case- and whitespace-insensitively', () => {
  const rows = tallyCommonPrompts([
    hit('What is our exposure?'),
    hit('what is   our EXPOSURE?'),
    hit('\n What Is Our Exposure? \t'),
  ]);
  assert.equal(rows.length, 1, 'one question asked three ways is one prompt');
  assert.equal(rows[0].count, 3);
  assert.equal(rows[0].prompt, 'What is our exposure?', 'keeps a readable original, not the key');
});

test('the most recent timestamp wins and the most frequent prompt sorts first', () => {
  const rows = tallyCommonPrompts([
    hit('rare question', '2026-08-01T00:00:00Z'),
    hit('common question', '2026-08-02T00:00:00Z'),
    hit('common question', '2026-08-04T00:00:00Z'),
  ]);
  assert.equal(rows[0].prompt, 'common question');
  assert.equal(rows[0].lastSeen, '2026-08-04T00:00:00Z');
});

test('unusable rows are ignored rather than counted as prompts', () => {
  // A blank or non-string `input` must not occupy a slot in a list of "what people ask".
  const rows = tallyCommonPrompts([hit(''), hit('   '), hit(null), hit(42), hit(undefined), hit('real')]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].prompt, 'real');
});

test('the returned list and each prompt are both bounded', () => {
  const many: GatewayInputHit[] = Array.from({ length: MAX_COMMON_PROMPTS + 15 }, (_, i) =>
    hit(`question number ${i}`),
  );
  assert.equal(tallyCommonPrompts(many).length, MAX_COMMON_PROMPTS);

  const long = tallyCommonPrompts([hit('x'.repeat(MAX_PROMPT_LEN * 3))]);
  assert.ok(long[0].prompt.length <= MAX_PROMPT_LEN);
  assert.ok(normalizePrompt('y'.repeat(MAX_PROMPT_LEN * 3)).length <= MAX_PROMPT_LEN);
});

test('no rows yields an empty list, not a thrown error', () => {
  assert.deepEqual(tallyCommonPrompts([]), []);
});
