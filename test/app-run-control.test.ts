import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideAppRunControl, parseAppRunControlAction } from '../src/lib/app-run-control.ts';

// PURE tests for durable app-run workflow control eligibility (run-actions). No cluster.

test('running + paused runs are controllable (cancel and terminate)', () => {
  for (const status of ['running', 'awaiting_human']) {
    for (const action of ['cancel', 'terminate'] as const) {
      assert.equal(decideAppRunControl(status, action).allow, true, `${status}/${action}`);
    }
  }
});

test('terminal runs are refused with a clear reason', () => {
  for (const status of ['done', 'error', 'cancelled']) {
    const d = decideAppRunControl(status, 'cancel');
    assert.equal(d.allow, false);
    assert.match(d.reason ?? '', new RegExp(`run is ${status}`));
    assert.match(d.reason ?? '', /nothing to cancel/);
  }
});

test('terminate reason uses the terminate verb', () => {
  assert.match(decideAppRunControl('done', 'terminate').reason ?? '', /nothing to terminate/);
});

test('unknown/blank status is refused', () => {
  assert.equal(decideAppRunControl('', 'cancel').allow, false);
  assert.match(decideAppRunControl('   ', 'terminate').reason ?? '', /unknown status/);
  assert.equal(decideAppRunControl('weird', 'cancel').allow, false);
});

test('parseAppRunControlAction defaults to cancel, only "terminate" escalates', () => {
  assert.equal(parseAppRunControlAction('terminate'), 'terminate');
  assert.equal(parseAppRunControlAction('cancel'), 'cancel');
  assert.equal(parseAppRunControlAction(undefined), 'cancel');
  assert.equal(parseAppRunControlAction('force'), 'cancel');
  assert.equal(parseAppRunControlAction(null), 'cancel');
});
