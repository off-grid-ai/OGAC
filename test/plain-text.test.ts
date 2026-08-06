// The input below is the real answer that appeared, markdown-source-and-all, in a run's timeline.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewText, toPlainText } from '@/lib/plain-text';

const REAL = `**Retention Action Recommendation: Advisor Call**

**Rationale:**
- The premium amount of ₹69,000 is substantial and likely represents a multi-period renewal.
- However, the closest matching policy in the data is **SL1277504002**, which has two
  semi-annual installments.

**Note:** If the ₹69,000 is a single premium, an advisor call ensures clarity.`;

test('the syntax goes, the words stay', () => {
  const out = toPlainText(REAL);
  assert.ok(!out.includes('**'), out);
  assert.ok(out.startsWith('Retention Action Recommendation: Advisor Call'));
  assert.ok(out.includes('SL1277504002'), 'a policy number must survive');
  assert.ok(out.includes('₹69,000'), 'the amount must survive');
});

test('blocks become separated words, not run together', () => {
  // "Advisor CallRationale" reads as a typo, not as a heading followed by a paragraph.
  assert.ok(!/CallRationale/.test(toPlainText(REAL)));
  assert.equal(toPlainText('# Title\n\nBody text'), 'Title Body text');
});

test('every inline mark is handled', () => {
  assert.equal(toPlainText('**bold** and *em* and `code` and ~~gone~~'), 'bold and em and code and gone');
  assert.equal(toPlainText('see [the runs page](/operations/runs) now'), 'see the runs page now');
  assert.equal(toPlainText('_emphasis_ here'), 'emphasis here');
});

test('an identifier containing the mark characters is left alone', () => {
  // A preview that mangles unfamiliar text is worse than one that shows a stray character.
  assert.equal(toPlainText('run_0d632888 and snake_case_name'), 'run_0d632888 and snake_case_name');
  assert.equal(toPlainText('2 * 3 * 4'), '2 * 3 * 4', 'arithmetic is not emphasis');
});

test('lists lose their bullets but keep their items', () => {
  assert.equal(toPlainText('- one\n- two\n3. three'), 'one two three');
});

test('a code fence keeps the code and drops the fence', () => {
  assert.equal(toPlainText('```sql\nSELECT 1\n```'), 'SELECT 1');
});

test('nothing in, nothing out — never the string "null"', () => {
  for (const v of [null, undefined, '', '   ']) assert.equal(toPlainText(v), '');
});

test('a preview cuts on a word boundary', () => {
  const out = previewText(REAL, 60);
  assert.ok(out.length <= 61, out);
  assert.ok(out.endsWith('…'));
  assert.ok(!/\w…$/.test(out), 'must not end mid-word');
});

test('a short answer is not truncated at all', () => {
  assert.equal(previewText('**Short**', 60), 'Short');
});
