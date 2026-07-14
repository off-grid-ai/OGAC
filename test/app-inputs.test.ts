import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FormField } from '../src/lib/app-model.ts';
import {
  applyInputDefaults,
  coerceInputValues,
  validateInputValues,
} from '../src/lib/app-inputs.ts';

// PURE unit tests for the run-input rules (the "one input box" fix). No DB, no network. Every branch
// of validate/coerce/defaults is exercised — required presence, typed constraints (number/select/
// date), default-filling, and coercion.

const F = (over: Partial<FormField> & Pick<FormField, 'key' | 'type'>): FormField => ({
  label: over.key,
  ...over,
});

// ─── validateInputValues ───────────────────────────────────────────────────────────────────────

test('validate: required field present passes', () => {
  const fields = [F({ key: 'name', type: 'text', required: true })];
  const r = validateInputValues(fields, { name: 'Priya' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, {});
});

test('validate: required field absent fails with a message', () => {
  const fields = [F({ key: 'name', label: 'Full name', type: 'text', required: true })];
  const r = validateInputValues(fields, {});
  assert.equal(r.ok, false);
  assert.equal(r.errors.name, 'Full name is required');
});

test('validate: required field blank/whitespace string fails', () => {
  const fields = [F({ key: 'name', type: 'text', required: true })];
  assert.equal(validateInputValues(fields, { name: '   ' }).ok, false);
  assert.equal(validateInputValues(fields, { name: '' }).ok, false);
});

test('validate: required field null/undefined fails', () => {
  const fields = [F({ key: 'name', type: 'text', required: true })];
  assert.equal(validateInputValues(fields, { name: null }).ok, false);
  assert.equal(validateInputValues(fields, { name: undefined }).ok, false);
});

test('validate: optional empty field is fine and runs no type check', () => {
  const fields = [F({ key: 'age', type: 'number' })];
  const r = validateInputValues(fields, {}); // absent optional number
  assert.equal(r.ok, true);
  const r2 = validateInputValues(fields, { age: '' }); // empty optional number — no NaN error
  assert.equal(r2.ok, true);
});

test('validate: number field accepts finite numbers (incl. 0 and negatives)', () => {
  const fields = [F({ key: 'amt', type: 'number', required: true })];
  assert.equal(validateInputValues(fields, { amt: '0' }).ok, true);
  assert.equal(validateInputValues(fields, { amt: '-12.5' }).ok, true);
  assert.equal(validateInputValues(fields, { amt: 42 }).ok, true);
});

test('validate: number field rejects non-numeric', () => {
  const fields = [F({ key: 'amt', label: 'Amount', type: 'number', required: true })];
  const r = validateInputValues(fields, { amt: 'abc' });
  assert.equal(r.ok, false);
  assert.equal(r.errors.amt, 'Amount must be a number');
});

test('validate: number field rejects Infinity-producing input', () => {
  const fields = [F({ key: 'amt', type: 'number' })];
  // "Infinity" parses to a non-finite Number → rejected.
  assert.equal(validateInputValues(fields, { amt: 'Infinity' }).ok, false);
});

test('validate: select must be one of options', () => {
  const fields = [F({ key: 'tier', type: 'select', options: ['gold', 'silver'] })];
  assert.equal(validateInputValues(fields, { tier: 'gold' }).ok, true);
  const bad = validateInputValues(fields, { tier: 'bronze' });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.tier, /one of the listed options/);
});

test('validate: select with no options declared rejects any non-empty value', () => {
  const fields = [F({ key: 'tier', type: 'select' })]; // options undefined → [] fallback
  assert.equal(validateInputValues(fields, { tier: 'gold' }).ok, false);
});

test('validate: date accepts a valid date, rejects garbage', () => {
  const fields = [F({ key: 'when', label: 'Date', type: 'date' })];
  assert.equal(validateInputValues(fields, { when: '2026-07-14' }).ok, true);
  const bad = validateInputValues(fields, { when: 'not-a-date' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.when, 'Date must be a valid date');
});

test('validate: text and textarea and file accept any non-empty string', () => {
  const fields = [
    F({ key: 't', type: 'text', required: true }),
    F({ key: 'ta', type: 'textarea', required: true }),
    F({ key: 'f', type: 'file', required: true }),
  ];
  const r = validateInputValues(fields, { t: 'x', ta: 'multi\nline', f: '/path/to/file' });
  assert.equal(r.ok, true);
});

test('validate: aggregates multiple field errors', () => {
  const fields = [
    F({ key: 'name', type: 'text', required: true }),
    F({ key: 'amt', type: 'number', required: true }),
  ];
  const r = validateInputValues(fields, { amt: 'nope' });
  assert.equal(r.ok, false);
  assert.equal(Object.keys(r.errors).length, 2);
});

test('validate: empty fields list is always ok', () => {
  assert.equal(validateInputValues([], { anything: 'x' }).ok, true);
});

// ─── applyInputDefaults ────────────────────────────────────────────────────────────────────────

test('defaults: fills unset field from its default', () => {
  const fields = [F({ key: 'region', type: 'text', default: 'IN' })];
  assert.deepEqual(applyInputDefaults(fields, {}), { region: 'IN' });
});

test('defaults: a provided value overrides the default', () => {
  const fields = [F({ key: 'region', type: 'text', default: 'IN' })];
  assert.deepEqual(applyInputDefaults(fields, { region: 'US' }), { region: 'US' });
});

test('defaults: an empty provided value falls back to the default', () => {
  const fields = [F({ key: 'region', type: 'text', default: 'IN' })];
  assert.deepEqual(applyInputDefaults(fields, { region: '  ' }), { region: 'IN' });
});

test('defaults: field with no default and no value stays absent', () => {
  const fields = [F({ key: 'note', type: 'text' })];
  assert.deepEqual(applyInputDefaults(fields, {}), {});
});

test('defaults: empty-string default is treated as no default', () => {
  const fields = [F({ key: 'note', type: 'text', default: '' })];
  assert.deepEqual(applyInputDefaults(fields, {}), {});
});

test('defaults: carries over non-empty provided values not in the field set as strings', () => {
  const fields: FormField[] = [];
  assert.deepEqual(applyInputDefaults(fields, { extra: 5 }), { extra: '5' });
});

test('defaults: drops empty provided values', () => {
  const fields = [F({ key: 'a', type: 'text' })];
  assert.deepEqual(applyInputDefaults(fields, { a: '', b: null }), {});
});

// ─── coerceInputValues ─────────────────────────────────────────────────────────────────────────

test('coerce: number fields become JS numbers', () => {
  const fields = [F({ key: 'amt', type: 'number' })];
  assert.deepEqual(coerceInputValues(fields, { amt: '42' }), { amt: 42 });
});

test('coerce: non-number fields pass through unchanged', () => {
  const fields = [F({ key: 'name', type: 'text' })];
  assert.deepEqual(coerceInputValues(fields, { name: 'Priya' }), { name: 'Priya' });
});

test('coerce: drops empty values', () => {
  const fields = [F({ key: 'a', type: 'text' }), F({ key: 'n', type: 'number' })];
  assert.deepEqual(coerceInputValues(fields, { a: '  ', n: '' }), {});
});

test('coerce: a value with no matching field passes through as-is', () => {
  const fields: FormField[] = [];
  assert.deepEqual(coerceInputValues(fields, { stray: 'v' }), { stray: 'v' });
});

test('coerce: number field with already-numeric value stays a number', () => {
  const fields = [F({ key: 'amt', type: 'number' })];
  assert.deepEqual(coerceInputValues(fields, { amt: 7 }), { amt: 7 });
});
