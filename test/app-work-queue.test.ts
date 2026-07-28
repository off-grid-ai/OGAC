import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  arrivalSentence,
  buildAppWorkQueue,
  caseLabel,
  runSubject,
  statusLabel,
  type WorkRun,
} from '../src/lib/app-work-queue.ts';

// The acceptance bar (docs/APP_AS_PRODUCT.md): a non-technical person in a department must understand
// this screen unaided, and the public demo is READ-ONLY so it has to be understandable by reading it.
// These tests assert the plain-language rules, not just the arithmetic.

const run = (over: Partial<WorkRun> & { id: string }): WorkRun => ({
  status: 'done',
  startedAt: '2026-07-20T10:00:00.000Z',
  ...over,
});

test('waiting cases lead, newest first, and are never truncated', () => {
  const q = buildAppWorkQueue({
    trigger: 'email',
    runs: [
      run({ id: 'a', status: 'awaiting_human', startedAt: '2026-07-01T00:00:00Z' }),
      run({ id: 'b', status: 'awaiting_human', startedAt: '2026-07-28T00:00:00Z' }),
      run({ id: 'c', status: 'awaiting_human', startedAt: '2026-07-14T00:00:00Z' }),
    ],
    recentLimit: 1,
  });
  // A queue that silently hides a case would let it sit unattended forever — the failure this screen
  // exists to prevent. recentLimit must never clip the waiting list.
  assert.deepEqual(
    q.waiting.map((r) => r.id),
    ['b', 'c', 'a'],
  );
});

test('finished cases are capped, waiting cases are not', () => {
  const runs = Array.from({ length: 20 }, (_, i) =>
    run({ id: `d${i}`, startedAt: `2026-07-${String((i % 27) + 1).padStart(2, '0')}T00:00:00Z` }),
  );
  const q = buildAppWorkQueue({ trigger: 'on-demand', runs, recentLimit: 5 });
  assert.equal(q.recent.length, 5);
  assert.equal(q.waiting.length, 0);
});

test('the headline states what is on the plate, in whole sentences', () => {
  const one = buildAppWorkQueue({
    trigger: 'email',
    runs: [run({ id: 'a', status: 'awaiting_human' })],
  });
  assert.equal(one.headline, '1 case is waiting for a person to decide.');

  const many = buildAppWorkQueue({
    trigger: 'email',
    runs: [
      run({ id: 'a', status: 'awaiting_human' }),
      run({ id: 'b', status: 'awaiting_human' }),
    ],
  });
  assert.equal(many.headline, '2 cases are waiting for a person to decide.');
});

test('nothing waiting reports the work already handled rather than looking dead', () => {
  const q = buildAppWorkQueue({
    trigger: 'email',
    runs: [run({ id: 'a' }), run({ id: 'b' }), run({ id: 'c' })],
  });
  assert.equal(q.headline, 'Nothing is waiting. 3 cases have been handled.');
  assert.equal(q.isEmpty, false);
});

test('a genuinely new app says so, and is flagged empty', () => {
  const q = buildAppWorkQueue({ trigger: 'on-demand', runs: [] });
  assert.equal(q.headline, 'No cases yet.');
  assert.equal(q.isEmpty, true);
});

test('an app with only in-flight runs is NOT empty — it is working', () => {
  // queued/running is activity. Calling it empty would show a first-run explanation over a live app.
  const q = buildAppWorkQueue({
    trigger: 'webhook',
    runs: [run({ id: 'a', status: 'running' }), run({ id: 'b', status: 'queued' })],
  });
  assert.equal(q.isEmpty, false);
  assert.equal(q.waiting.length, 0);
  assert.equal(q.recent.length, 0);
});

test('error and cancelled runs count as finished, not as waiting', () => {
  const q = buildAppWorkQueue({
    trigger: 'email',
    runs: [run({ id: 'a', status: 'error' }), run({ id: 'b', status: 'cancelled' })],
  });
  assert.equal(q.waiting.length, 0);
  assert.equal(q.recent.length, 2);
});

test('arrival is explained without technical vocabulary', () => {
  assert.match(arrivalSentence('email'), /arrive by email/i);
  assert.match(arrivalSentence('whatsapp'), /arrive by WhatsApp/i);
  assert.match(arrivalSentence('schedule'), /set schedule/i);
  assert.match(arrivalSentence('on-demand'), /somebody starts/i);
  // "webhook" must never reach the reader — they are told work arrives from a connected system.
  const webhook = arrivalSentence('webhook');
  assert.doesNotMatch(webhook, /webhook|http|endpoint|POST/i);
  assert.match(webhook, /connected system/i);
});

test('an unknown trigger never claims work arrives automatically', () => {
  // Overstating automation would have someone waiting for cases that never come.
  const unknown = arrivalSentence('telegram-someday');
  assert.doesNotMatch(unknown, /automatically/i);
  assert.match(unknown, /started from this screen/i);
});

test('status labels read as plain English, never as machine states', () => {
  assert.equal(statusLabel('awaiting_human'), 'Waiting for you');
  assert.equal(statusLabel('running'), 'Working on it');
  assert.equal(statusLabel('done'), 'Completed');
  assert.equal(statusLabel('error'), 'Could not finish');
  for (const s of ['awaiting_human', 'running', 'done', 'error']) {
    assert.doesNotMatch(statusLabel(s), /_/, 'no snake_case may reach the reader');
  }
});

test('unparseable timestamps sort last instead of throwing', () => {
  const q = buildAppWorkQueue({
    trigger: 'email',
    runs: [
      run({ id: 'bad', status: 'awaiting_human', startedAt: 'not-a-date' }),
      run({ id: 'good', status: 'awaiting_human', startedAt: '2026-07-28T00:00:00Z' }),
    ],
  });
  assert.deepEqual(
    q.waiting.map((r) => r.id),
    ['good', 'bad'],
  );
});

// ─── runSubject: a queue of identical "Case" rows is unusable ─────────────────────────────────────

test('an explicit subject-ish field wins', () => {
  assert.equal(runSubject({ subject: 'Reimbursement for travel' }), 'Reimbursement for travel');
  assert.equal(runSubject({ title: 'Motor claim FNOL' }), 'Motor claim FNOL');
  assert.equal(runSubject({ query: 'Is this PAN valid?' }), 'Is this PAN valid?');
});

test('with no named subject, the first fields describe the case with readable labels', () => {
  // A non-technical reader must never see a database-shaped key.
  const subject = runSubject({ claim_amount: '12400', customer_name: 'Priya Sharma' });
  assert.equal(subject, 'Claim amount: 12,400 · Customer name: Priya Sharma');
  assert.doesNotMatch(subject ?? '', /_/);
});

test('at most two fields are used, so a row stays one line', () => {
  const subject = runSubject({ a: '1', b: '2', c: '3', d: '4' });
  assert.equal(subject, 'A: 1 · B: 2');
});

test('an input that cannot be summarised returns null rather than inventing a subject', () => {
  for (const input of [null, undefined, {}, [], 'a string', 42, { nested: { deep: 'value' } }]) {
    assert.equal(runSubject(input), null, `${JSON.stringify(input)} must not produce a subject`);
  }
});

test('blank and whitespace-only values are not subjects', () => {
  assert.equal(runSubject({ subject: '   ' }), null);
  assert.equal(runSubject({ subject: '', title: 'Fallback title' }), 'Fallback title');
});

test('long text is truncated and newlines collapsed, so a row cannot break the layout', () => {
  const subject = runSubject({ subject: `${'x'.repeat(400)}` });
  assert.ok((subject ?? '').length <= 120);
  assert.equal(runSubject({ subject: 'line one\n\nline two' }), 'line one line two');
});

test('identifiers are NEVER grouped — only quantities are', () => {
  // Grouping an identifier turns 88123 into "88,123", which reads as money and is wrong to copy.
  assert.equal(runSubject({ policy_number: 88123 }), 'Policy number: 88123');
  assert.equal(runSubject({ account_number: '50100234567' }), 'Account number: 50100234567');
  assert.equal(runSubject({ pan: 'ABCDE1234F' }), 'Pan: ABCDE1234F');
  // …while a quantity field IS grouped.
  assert.equal(runSubject({ premium: 145000 }), 'Premium: 145,000');
});

test('large numbers are grouped so an amount reads as money, not as a raw field', () => {
  assert.equal(runSubject({ amount: 361030 }), 'Amount: 361,030');
  // A numeric STRING is still a number to the reader.
  assert.equal(runSubject({ amount: '37562' }), 'Amount: 37,562');
  assert.equal(runSubject({ amount: -1234567 }), 'Amount: -1,234,567');
  assert.equal(runSubject({ total_value: 9876543 }), 'Total value: 9,876,543');
  assert.equal(runSubject({ amount: 1234.56 }), 'Amount: 1,234.56');
  // Short numbers and identifier-named fields are left alone.
  assert.equal(runSubject({ code: 404 }), 'Code: 404');
});

test('no currency symbol is invented — this module cannot know the tenant currency', () => {
  const subject = runSubject({ amount: 500000 }) ?? '';
  assert.doesNotMatch(subject, /[₹$€£]/);
});

test('caseLabel distinguishes rows that have no summarisable input', () => {
  // Every such row used to read the identical word "Case", so a queue of them was unusable.
  assert.equal(caseLabel(null, 'apprun_9a76e76f12'), 'Case 9a76e7');
  assert.equal(caseLabel('   ', 'apprun_c73426cc'), 'Case c73426');
  assert.notEqual(caseLabel(null, 'apprun_aaa111'), caseLabel(null, 'apprun_bbb222'));
});

test('caseLabel prefers a real subject over the reference', () => {
  assert.equal(caseLabel('Reimbursement for travel', 'apprun_9a76e7'), 'Reimbursement for travel');
});
