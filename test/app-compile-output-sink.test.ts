import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inferOutputSink } from '../src/lib/app-compile.ts';

// Plain-language DELIVERY intent → the governed output sink. This is the non-technical author's
// "and then email it to finance" turning into a real channel rather than a silent console sink, so
// getting it wrong means their workflow quietly delivers nowhere.
//
// These were written as CHARACTERIZATION tests against the existing implementation before it was
// made table-driven, so the refactor is provably behaviour-preserving rather than hopefully so.

// ─── webhook: the most specific, matched before a generic "send" ─────────────────────────────────

test('an explicit webhook with a URL captures the destination', () => {
  assert.deepEqual(inferOutputSink('post a webhook to https://hooks.example.com/x'), {
    sink: 'webhook',
    config: { url: 'https://hooks.example.com/x' },
  });
});

test('a bare "send" with a URL is a webhook, not a console sink', () => {
  const r = inferOutputSink('send the result to https://api.bank.example/ingest');
  assert.equal(r.sink, 'webhook');
  assert.deepEqual(r.config, { url: 'https://api.bank.example/ingest' });
});

test('a webhook with no URL reports an honest gap instead of inventing one', () => {
  const r = inferOutputSink('send it via webhook');
  assert.equal(r.sink, 'webhook');
  assert.equal(r.config, undefined);
  assert.match(r.gap ?? '', /no destination URL/);
});

// ─── slack ────────────────────────────────────────────────────────────────────────────────────────

test('slack picks up a #channel when the author names one', () => {
  const r = inferOutputSink('post it to slack in #ai-quality');
  assert.equal(r.sink, 'slack');
  assert.deepEqual(r.config, { channel: '#ai-quality' });
});

test('slack ALWAYS reports the setup gap, even with a channel', () => {
  // The incoming-webhook URL is an operator setting, so the author is told regardless — otherwise
  // they publish something that silently cannot post.
  for (const text of ['post to slack', 'post to slack in #ops']) {
    assert.match(inferOutputSink(text).gap ?? '', /incoming-webhook URL/);
  }
});

// ─── whatsapp ─────────────────────────────────────────────────────────────────────────────────────

test('whatsapp extracts and normalises a phone number', () => {
  assert.deepEqual(inferOutputSink('send it on whatsapp to +91 98765-43210'), {
    sink: 'whatsapp',
    config: { to: '+919876543210' },
  });
});

test('whatsapp with no number reports a gap', () => {
  const r = inferOutputSink('notify the RM on whatsapp');
  assert.equal(r.sink, 'whatsapp');
  assert.match(r.gap ?? '', /no recipient number/);
});

// ─── email ────────────────────────────────────────────────────────────────────────────────────────

test('email extracts the recipient address', () => {
  assert.deepEqual(inferOutputSink('email the summary to finance@bank.example'), {
    sink: 'email',
    config: { to: 'finance@bank.example' },
  });
});

test('"e-mail" is recognised too', () => {
  assert.equal(inferOutputSink('e-mail the report').sink, 'email');
});

test('email with no address reports a gap', () => {
  const r = inferOutputSink('email the compliance team');
  assert.equal(r.sink, 'email');
  assert.match(r.gap ?? '', /no recipient address/);
});

// ─── report / console ─────────────────────────────────────────────────────────────────────────────

test('report and pdf both mean the report sink, with no recipient needed', () => {
  assert.deepEqual(inferOutputSink('produce a report'), { sink: 'report' });
  assert.deepEqual(inferOutputSink('generate a pdf'), { sink: 'report' });
});

test('no delivery intent falls back to console', () => {
  assert.deepEqual(inferOutputSink('summarise the findings'), { sink: 'console' });
  assert.deepEqual(inferOutputSink(''), { sink: 'console' });
  assert.deepEqual(inferOutputSink(undefined as unknown as string), { sink: 'console' });
});

// ─── precedence: the order these are tried is behaviour, not an accident ─────────────────────────

test('webhook beats slack when a URL is present alongside it', () => {
  // "post ... https://…" satisfies the webhook rule first; that ordering is deliberate.
  assert.equal(inferOutputSink('post to slack via https://hooks.slack.com/services/x').sink, 'webhook');
});

test('slack beats email when both words appear', () => {
  assert.equal(inferOutputSink('slack the team and email ops@bank.example').sink, 'slack');
});

test('whatsapp beats email when both appear', () => {
  assert.equal(inferOutputSink('whatsapp or email finance@bank.example').sink, 'whatsapp');
});

test('a delivery channel beats a plain report mention', () => {
  assert.equal(inferOutputSink('email the report to ops@bank.example').sink, 'email');
});

test('matching is case-insensitive', () => {
  assert.equal(inferOutputSink('EMAIL the summary').sink, 'email');
  assert.equal(inferOutputSink('Post To SLACK').sink, 'slack');
});
