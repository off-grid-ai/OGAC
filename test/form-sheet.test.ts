import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// The FormSheet + the create/edit panels are 'use client' React files (Radix portals, next/navigation),
// so — following the codebase convention (see test/nav-groups.test.ts) — we assert their STRUCTURE from
// source rather than rendering them. The invariant we protect: create/edit panels use the canonical
// <FormSheet>, never a hand-rolled <SheetContent> whose fields can clip at the panel's left edge.

function read(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8');
}

const FORM_SHEET = 'src/components/ui/form-sheet.tsx';

// The panels the founder flagged as at-risk (SheetContent WITHOUT SheetBody → fields clipped).
// Every one of these MUST render through <FormSheet>.
const MIGRATED_PANELS = [
  'src/components/data-domains/DomainFormPanel.tsx',
  'src/components/integrations/AddConnectorButton.tsx',
  'src/components/integrations/ConnectorRowActions.tsx',
  'src/components/fleet/EnrollDeviceButton.tsx',
  'src/components/data/AddConnectorButton.tsx',
  'src/components/data/AddMaskingRuleButton.tsx',
];

test('FormSheet composes the Sheet primitives in the safe order (Header › Body › Footer)', () => {
  const src = read(FORM_SHEET);
  // It must use the shared primitives — not re-implement the shell.
  for (const part of ['SheetContent', 'SheetHeader', 'SheetTitle', 'SheetBody', 'SheetFooter']) {
    assert.ok(src.includes(part), `FormSheet should compose ${part}`);
  }
  // Body must wrap children (the padded, scrollable region) — this is what prevents clipping.
  assert.match(src, /<SheetBody>\{children\}<\/SheetBody>/, 'children must go inside SheetBody');
  // Header/Title/Body/Footer must appear in that order in the JSX (look past the import block).
  const jsx = src.slice(src.indexOf('return ('));
  const iHeader = jsx.indexOf('<SheetHeader>');
  const iBody = jsx.indexOf('<SheetBody>');
  const iFooter = jsx.indexOf('<SheetFooter>');
  assert.ok(iHeader >= 0 && iBody > iHeader, 'SheetBody must come after SheetHeader');
  assert.ok(iFooter > iBody, 'SheetFooter must come after SheetBody');
});

test('FormSheet size mapping stays sm/md/lg → sm:max-w-*', () => {
  const src = read(FORM_SHEET);
  assert.match(src, /sm:\s*'sm:max-w-sm'/);
  assert.match(src, /md:\s*'sm:max-w-md'/);
  assert.match(src, /lg:\s*'sm:max-w-lg'/);
  // And it exports the pure helper so the mapping is unit-checkable / reusable.
  assert.match(src, /export function formSheetSizeClass/);
});

test('every at-risk create/edit panel uses <FormSheet>, not a hand-rolled <SheetContent>', () => {
  for (const rel of MIGRATED_PANELS) {
    const src = read(rel);
    assert.ok(src.includes('<FormSheet'), `${rel} must render through <FormSheet>`);
    assert.ok(
      !/<SheetContent\b/.test(src),
      `${rel} must NOT hand-roll <SheetContent> (clip risk); use <FormSheet>`,
    );
    // Import must resolve to the canonical component.
    assert.match(src, /from '@\/components\/ui\/form-sheet'/, `${rel} must import FormSheet`);
  }
});

test('migrated panels put their submit action in the FormSheet footer', () => {
  for (const rel of MIGRATED_PANELS) {
    const src = read(rel);
    assert.match(src, /footer=\{/, `${rel} should pass a footer to FormSheet`);
  }
});
