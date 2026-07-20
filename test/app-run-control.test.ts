import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APP_RUN_CONTROL_ACTIONS,
  availableAppRunControls,
  decideAppRunControl,
  parseAppRunControlAction,
} from '../src/lib/app-run-control.ts';

// PURE tests for the full durable app-run workflow control matrix (run-actions). No cluster.

test('cancel/terminate allowed only for in-flight runs', () => {
  for (const status of ['queued', 'running', 'awaiting_human']) {
    assert.equal(decideAppRunControl(status, 'cancel').allow, true, `cancel ${status}`);
    assert.equal(decideAppRunControl(status, 'terminate').allow, true, `terminate ${status}`);
  }
  for (const status of ['done', 'error', 'cancelled']) {
    const d = decideAppRunControl(status, 'cancel');
    assert.equal(d.allow, false);
    assert.match(d.reason ?? '', new RegExp(`run is ${status}, not in flight`));
    assert.match(d.reason ?? '', /nothing to cancel/);
    assert.equal(decideAppRunControl(status, 'terminate').allow, false);
  }
});

test('reset/rerun allowed only for terminal runs', () => {
  for (const status of ['done', 'error', 'cancelled']) {
    assert.equal(decideAppRunControl(status, 'reset').allow, true, `reset ${status}`);
    assert.equal(decideAppRunControl(status, 'rerun').allow, true, `rerun ${status}`);
  }
  for (const status of ['queued', 'running', 'awaiting_human']) {
    const d = decideAppRunControl(status, 'reset');
    assert.equal(d.allow, false);
    assert.match(d.reason ?? '', /still in flight/);
    assert.match(d.reason ?? '', /cancel it first/);
    assert.equal(decideAppRunControl(status, 'rerun').allow, false);
  }
});

test('rerun reason uses the re-run verb', () => {
  assert.match(decideAppRunControl('running', 'rerun').reason ?? '', /re-run applies to a finished run/);
});

test('unknown/blank status is refused for every action', () => {
  for (const action of APP_RUN_CONTROL_ACTIONS) {
    assert.equal(decideAppRunControl('', action).allow, false);
    assert.match(decideAppRunControl('   ', action).reason ?? '', /unknown status/);
    assert.equal(decideAppRunControl('weird', action).allow, false);
  }
});

test('parseAppRunControlAction accepts the four actions, rejects anything else', () => {
  for (const a of APP_RUN_CONTROL_ACTIONS) assert.equal(parseAppRunControlAction(a), a);
  assert.equal(parseAppRunControlAction('force'), null);
  assert.equal(parseAppRunControlAction(undefined), null);
  assert.equal(parseAppRunControlAction(null), null);
  assert.equal(parseAppRunControlAction(3), null);
});

test('availableAppRunControls reflects status — in-flight → stop, terminal → replay/retry', () => {
  assert.deepEqual(availableAppRunControls('running'), ['cancel', 'terminate']);
  assert.deepEqual(availableAppRunControls('awaiting_human'), ['cancel', 'terminate']);
  assert.deepEqual(availableAppRunControls('done'), ['reset', 'rerun']);
  assert.deepEqual(availableAppRunControls('error'), ['reset', 'rerun']);
  assert.deepEqual(availableAppRunControls('cancelled'), ['reset', 'rerun']);
  assert.deepEqual(availableAppRunControls('bogus'), []);
});
