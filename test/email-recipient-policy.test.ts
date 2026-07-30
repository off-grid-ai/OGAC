import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isUndeliverable, resolveRecipient } from '../src/lib/email-recipient-policy.ts';

// ── Resend failures on ops@bharatunion.example ────────────────────────────────────────────────────────
//
// `.example` is reserved by RFC 2606 so it can never resolve. The value was in no config — not in the repo,
// not in any of 696 text/jsonb columns — so it arrives as typed input on a run. The fix is a rule, not a
// find-and-replace: refuse an address that cannot receive mail BEFORE calling the provider.

describe('isUndeliverable', () => {
  test('reserved TLDs can never receive mail', () => {
    for (const a of ['ops@bharatunion.example', 'x@foo.invalid', 'y@bar.test', 'z@host.localhost']) {
      assert.ok(isUndeliverable(a), a);
    }
  });

  test('the reserved documentation domains too', () => {
    for (const a of ['a@example.com', 'b@example.net', 'c@example.org']) assert.ok(isUndeliverable(a), a);
  });

  test('real addresses pass, including the operator inbox', () => {
    for (const a of ['mac@getoffgridai.co', 'ops@bank.in', 'a.b+tag@sub.domain.co.uk']) {
      assert.ok(!isUndeliverable(a), a);
    }
  });

  test('malformed input is undeliverable, not assumed valid', () => {
    for (const a of ['', 'no-at-sign', '@nolocal.com', 'trailing@', 'has space@x.com']) {
      assert.ok(isUndeliverable(a), JSON.stringify(a));
    }
  });

  test('a trailing dot and mixed case do not evade the check', () => {
    assert.ok(isUndeliverable('OPS@BharatUnion.Example.'));
  });
});

describe('resolveRecipient', () => {
  test('redirects an unroutable address to the operator inbox, and says so', () => {
    const d = resolveRecipient('ops@bharatunion.example', 'mac@getoffgridai.co');
    assert.equal(d.to, 'mac@getoffgridai.co');
    assert.equal(d.redirected, true);
    assert.equal(d.blocked, false);
    assert.match(d.reason, /cannot receive mail/);
    assert.match(d.reason, /mac@getoffgridai\.co/);
  });

  test('BLOCKS rather than silently dropping when no redirect is configured', () => {
    // A sink that swallows a send reports success for mail that never existed — the same defect as a failed
    // read presenting as "no rows".
    const d = resolveRecipient('ops@bharatunion.example');
    assert.equal(d.blocked, true);
    assert.equal(d.to, null);
    assert.match(d.reason, /no send was attempted/);
  });

  test('a deliverable address is left completely alone', () => {
    const d = resolveRecipient('mac@getoffgridai.co', 'someone@else.co');
    assert.equal(d.to, 'mac@getoffgridai.co');
    assert.equal(d.redirected, false);
    assert.equal(d.blocked, false);
  });

  test('an unroutable REDIRECT target is refused, not chained into', () => {
    const d = resolveRecipient('a@b.example', 'also@bad.invalid');
    assert.equal(d.blocked, true);
    assert.equal(d.to, null);
  });

  test('an empty recipient blocks with its own reason', () => {
    assert.match(resolveRecipient('').reason, /no recipient/);
  });

  test('every decision carries a reason — a blocked send must be explainable', () => {
    for (const [a, r] of [['ops@x.example', 'mac@getoffgridai.co'], ['ops@x.example', ''], ['ok@real.co', '']]) {
      assert.ok(resolveRecipient(a, r).reason.trim().length > 0, `${a} / ${r}`);
    }
  });
});
