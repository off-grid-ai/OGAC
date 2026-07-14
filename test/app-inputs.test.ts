import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FormField } from '../src/lib/app-model.ts';
import {
  applyInputDefaults,
  coerceInputValues,
  validateInputValues,
} from '../src/lib/app-inputs.ts';

// PURE unit tests for the run-input rules. Every branch of validate/defaults/coerce is exercised
// both ways (present/absent, valid/invalid) so the coverage bar is met on real behaviour.

const F = {
  text: (over: Partial<FormField> = {}): FormField => ({ key: 'name', label: 'Name', type: 'text', ...over }),
  textarea: (over: Partial<FormField> = {}): FormField => ({ key: 'notes', label: 'Notes', type: 'textarea', ...over }),
  number: (over: Partial<FormField> = {}): FormField => ({ key: 'amount', label: 'Amount', type: 'number', ...over }),
  select: (over: Partial<FormField> = {}): FormField => ({ key: 'kind', label: 'Kind', type: 'select', options: ['a', 'b'], ...over }),
  date: (over: Partial<FormField> = {}): FormField => ({ key: 'when', label: 'When', type: 'date', ...over }),
  file: (over: Partial<FormField> = {}): FormField => ({ key: 'doc', label: 'Doc', type: 'file', ...over }),
};

// ─── validateInputValues ────────────────────────────────────────────────────

test('validate: empty fields + empty values is ok', () => {
  const r = validateInputValues([], {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, {});
});

test('validate: required text present passes, absent fails', () => {
  const fields = [F.text({ required: true })];
  assert.equal(validateInputValues(fields, { name: 'Asha' }).ok, true);
  const miss = validateInputValues(fields, {});
  assert.equal(miss.ok, false);
  assert.match(miss.errors.name, /required/);
});

test('validate: required text with only whitespace fails (trim)', () => {
  const r = validateInputValues([F.text({ required: true })], { name: '   ' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.name);
});

test('validate: required null/undefined value fails', () => {
  const fields = [F.text({ required: true })];
  assert.equal(validateInputValues(fields, { name: null }).ok, false);
  assert.equal(validateInputValues(fields, { name: undefined }).ok, false);
});

test('validate: non-required absent field passes and is skipped', () => {
  const r = validateInputValues([F.number(), F.select(), F.date()], {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, {});
});

test('validate: number present finite passes; non-numeric fails', () => {
  assert.equal(validateInputValues([F.number()], { amount: '42' }).ok, true);
  assert.equal(validateInputValues([F.number()], { amount: 42 }).ok, true);
  const bad = validateInputValues([F.number()], { amount: 'not-a-number' });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.amount, /number/);
});

test('validate: number Infinity fails', () => {
  const r = validateInputValues([F.number()], { amount: 'Infinity' });
  assert.equal(r.ok, false);
});

test('validate: select in options passes; not-in-options fails; missing options fails', () => {
  assert.equal(validateInputValues([F.select()], { kind: 'a' }).ok, true);
  assert.equal(validateInputValues([F.select()], { kind: 'z' }).ok, false);
  // A select declared with no options: any present value fails (nothing valid to pick).
  const noOpts = validateInputValues([F.select({ options: undefined })], { kind: 'a' });
  assert.equal(noOpts.ok, false);
});

test('validate: date valid passes; garbage fails', () => {
  assert.equal(validateInputValues([F.date()], { when: '2026-07-14' }).ok, true);
  const bad = validateInputValues([F.date()], { when: 'yesterday-ish' });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.when, /date/);
});

test('validate: textarea and file only check required, not format', () => {
  assert.equal(validateInputValues([F.textarea(), F.file()], { notes: 'x', doc: 'y' }).ok, true);
  const req = validateInputValues([F.textarea({ required: true })], {});
  assert.equal(req.ok, false);
});

test('validate: undeclared extra keys are ignored', () => {
  const r = validateInputValues([F.text()], { extra: 'whatever' });
  assert.equal(r.ok, true);
});

test('validate: multiple failures collected per key', () => {
  const r = validateInputValues([F.text({ required: true }), F.number(), F.select()], {
    amount: 'nope',
    kind: 'z',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.name && r.errors.amount && r.errors.kind);
  assert.equal(Object.keys(r.errors).length, 3);
});

// ─── applyInputDefaults ──────────────────────────────────────────────────────

test('defaults: seeds default when no incoming value', () => {
  const r = applyInputDefaults([F.text({ default: 'Asha' })]);
  assert.equal(r.name, 'Asha');
});

test('defaults: incoming value wins over default', () => {
  const r = applyInputDefaults([F.text({ default: 'Asha' })], { name: 'Ravi' });
  assert.equal(r.name, 'Ravi');
});

test('defaults: no default + no value leaves key absent', () => {
  const r = applyInputDefaults([F.text()]);
  assert.equal('name' in r, false);
});

test('defaults: empty-string default is treated as no default', () => {
  const r = applyInputDefaults([F.text({ default: '' })]);
  assert.equal('name' in r, false);
});

test('defaults: carries over incoming present values, drops absent ones', () => {
  const r = applyInputDefaults([F.text(), F.number()], { name: 'Asha', amount: null });
  assert.equal(r.name, 'Asha');
  assert.equal('amount' in r, false);
});

test('defaults: coerces incoming non-string to string', () => {
  const r = applyInputDefaults([F.number()], { amount: 42 });
  assert.equal(r.amount, '42');
});

test('defaults: default omitted arg (no values)', () => {
  const r = applyInputDefaults([F.text({ default: 'x' })]);
  assert.equal(r.name, 'x');
});

// ─── coerceInputValues ───────────────────────────────────────────────────────

test('coerce: number string → finite number', () => {
  const r = coerceInputValues([F.number()], { amount: '42' });
  assert.equal(r.amount, 42);
  assert.equal(typeof r.amount, 'number');
});

test('coerce: invalid number dropped', () => {
  const r = coerceInputValues([F.number()], { amount: 'nope' });
  assert.equal('amount' in r, false);
});

test('coerce: absent declared field dropped', () => {
  const r = coerceInputValues([F.text(), F.number()], { name: '  ', amount: '' });
  assert.equal('name' in r, false);
  assert.equal('amount' in r, false);
});

test('coerce: string trimmed', () => {
  const r = coerceInputValues([F.text()], { name: '  Asha  ' });
  assert.equal(r.name, 'Asha');
});

test('coerce: undeclared keys pass through unchanged', () => {
  const r = coerceInputValues([F.text()], { name: 'x', extra: { deep: 1 } });
  assert.deepEqual(r.extra, { deep: 1 });
});

test('coerce: already-number value stays (non-string, present) for number field', () => {
  const r = coerceInputValues([F.number()], { amount: 7 });
  assert.equal(r.amount, 7);
});

test('coerce: non-string present value for text field left as-is', () => {
  const r = coerceInputValues([F.text()], { name: 5 });
  assert.equal(r.name, 5);
});
