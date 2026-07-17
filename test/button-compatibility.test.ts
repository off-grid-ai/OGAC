import assert from 'node:assert/strict';
import test from 'node:test';

import {
  legacyButtonSizeClass,
  sharedButtonSize,
  type LegacyButtonSize,
} from '@/lib/button-compatibility';

test('every legacy Console button size maps to a supported shared primitive size', () => {
  const expected = new Map<LegacyButtonSize, string>([
    ['default', 'default'],
    ['xs', 'sm'],
    ['sm', 'sm'],
    ['lg', 'lg'],
    ['icon', 'icon'],
    ['icon-xs', 'icon'],
    ['icon-sm', 'icon'],
    ['icon-lg', 'icon'],
  ]);

  for (const [legacy, shared] of expected) {
    assert.equal(sharedButtonSize(legacy), shared);
    assert.ok(
      legacyButtonSizeClass(legacy).length > 0,
      `${legacy} must retain its Console density class`,
    );
  }
});

test('compact and icon compatibility sizes retain explicit minimum-height semantics', () => {
  for (const size of ['xs', 'sm', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'] as const) {
    assert.match(legacyButtonSizeClass(size), /min-h-/);
  }
});
