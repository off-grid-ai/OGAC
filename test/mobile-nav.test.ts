import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawerReducer, type DrawerAction } from '../src/lib/mobile-nav.ts';

// Unit tests for the mobile-drawer state machine — pure function, NO React, NO router, NO mocks.
// This owns the close-on-nav invariant that keeps the phone drawer coherent (tapping a nav row
// navigates AND dismisses the overlay); a regression here strands the drawer open over the new page.

test('open: always resolves to open (from closed)', () => {
  assert.equal(drawerReducer(false, { type: 'open' }), true);
});

test('open: idempotent when already open', () => {
  assert.equal(drawerReducer(true, { type: 'open' }), true);
});

test('close: always resolves to closed (from open)', () => {
  assert.equal(drawerReducer(true, { type: 'close' }), false);
});

test('close: idempotent when already closed', () => {
  assert.equal(drawerReducer(false, { type: 'close' }), false);
});

test('toggle: closed -> open', () => {
  assert.equal(drawerReducer(false, { type: 'toggle' }), true);
});

test('toggle: open -> closed', () => {
  assert.equal(drawerReducer(true, { type: 'toggle' }), false);
});

test('navigate: closes when open (tapped a nav row -> dismiss over the new page)', () => {
  assert.equal(drawerReducer(true, { type: 'navigate' }), false);
});

test('navigate: stays closed when already closed', () => {
  assert.equal(drawerReducer(false, { type: 'navigate' }), false);
});

test('unknown action type is inert (defensive default keeps prior state)', () => {
  // Exercises the switch's implicit fall-through for a runtime-only bad action (type-cast to bypass
  // the compile-time union) — the reducer must not crash or flip state on an unrecognized intent.
  const bogus = { type: 'nope' } as unknown as DrawerAction;
  assert.equal(drawerReducer(true, bogus), true);
  assert.equal(drawerReducer(false, bogus), false);
});
