import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { mdmControlAvailable } from '../src/lib/fleetdm.ts';

// DeviceActions is a 'use client' React file (Radix dropdown portal + next/navigation), so - per the
// codebase convention (see test/form-sheet.test.ts) - we assert its STRUCTURE from source rather than
// mounting it. The invariant we protect: while the MDM CONTROL tier is coming soon, the acting
// commands (lock / unlock / wipe) render a disabled "Coming soon" item and never fire a request,
// while INVENTORY (refetch) and the first-party kill switch stay live.

function read(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8');
}

const SRC = read('src/components/fleet/DeviceActions.tsx');

test('DeviceActions reads the single MDM-control gate, not an ad-hoc flag', () => {
  assert.match(SRC, /mdmControlAvailable/, 'must read the shared gate');
  assert.match(SRC, /const CONTROL_AVAILABLE = mdmControlAvailable\(\)/, 'gate resolved once');
  // Sanity: the gate this UI depends on is currently off (coming soon), so the disabled branch is live.
  assert.equal(mdmControlAvailable(), false);
});

test('DeviceActions renders a "Coming soon" label for the gated control commands', () => {
  assert.match(SRC, /Coming soon/, 'a Coming soon label must be present');
  // The label is rendered only while the gate is off.
  assert.match(SRC, /CONTROL_AVAILABLE \? null : <ComingSoon \/>/);
  // And the ComingSoon component exists.
  assert.match(SRC, /function ComingSoon\(\)/);
});

test('DeviceActions disables lock/unlock/wipe while control is gated', () => {
  // Every control item carries disabled={!CONTROL_AVAILABLE}.
  const disabledCount = (SRC.match(/disabled=\{!CONTROL_AVAILABLE\}/g) ?? []).length;
  assert.equal(disabledCount, 3, 'lock, unlock, and wipe must each be gated-disabled');
});

test('DeviceActions guards the click path so a gated control command never fires', () => {
  // The command() runner refuses control commands while gated - the terminal behaviour a user gets.
  assert.match(
    SRC,
    /if \(isMdmControlCommand\(cmd\) && !CONTROL_AVAILABLE\) return;/,
    'command() must early-return on a gated control command',
  );
  // The onClick handlers pass undefined (no request) while gated.
  assert.match(SRC, /CONTROL_AVAILABLE\s*\?\s*command\('lock'/);
  assert.match(SRC, /CONTROL_AVAILABLE \? command\('unlock'\) : undefined/);
  assert.match(SRC, /CONTROL_AVAILABLE\s*\?\s*command\('wipe'/);
});

test('DeviceActions keeps inventory (refetch) and the kill switch live - not gated', () => {
  // Refetch fires unconditionally (inventory re-collect, free tier).
  assert.match(SRC, /onClick=\{\(\) => command\('refetch'\)\}/, 'refetch stays live');
  // The first-party kill switch stays live and is not tied to the MDM-control gate.
  assert.match(SRC, /onClick=\{kill\}/, 'kill switch stays live');
  const killGuarded = /kill[\s\S]{0,80}CONTROL_AVAILABLE/.test(SRC);
  assert.equal(killGuarded, false, 'the kill switch must NOT depend on the MDM-control gate');
});
