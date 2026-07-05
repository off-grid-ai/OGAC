import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatCompileErrors,
  hasPackageDeclaration,
  isValidModuleId,
  normalizeModule,
  normalizeModuleList,
  opaPolicyUrl,
  packageOf,
  parseOpaCompileErrors,
  slugifyModuleId,
  validateRegoModule,
} from '../src/lib/opa-policy-policy.ts';

// ─── module id ──────────────────────────────────────────────────────────────

test('isValidModuleId accepts slugs, rejects junk', () => {
  assert.ok(isValidModuleId('offgrid/authz'));
  assert.ok(isValidModuleId('my-policy'));
  assert.ok(isValidModuleId('a.b.c'));
  assert.ok(isValidModuleId('x'));
  assert.equal(isValidModuleId('Offgrid'), false, 'uppercase rejected');
  assert.equal(isValidModuleId('-lead'), false, 'leading sep rejected');
  assert.equal(isValidModuleId('trail-'), false, 'trailing sep rejected');
  assert.equal(isValidModuleId('has space'), false);
  assert.equal(isValidModuleId(''), false);
});

test('slugifyModuleId derives a safe id from a title', () => {
  assert.equal(slugifyModuleId('My Authz Policy!'), 'my-authz-policy');
  assert.equal(slugifyModuleId('  Trim / Me  '), 'trim-/-me');
  assert.equal(slugifyModuleId('###'), '');
});

// ─── package parsing ──────────────────────────────────────────────────────────

test('hasPackageDeclaration / packageOf', () => {
  const rego = 'package offgrid.authz\n\ndefault allow := false\n';
  assert.ok(hasPackageDeclaration(rego));
  assert.equal(packageOf(rego), 'offgrid.authz');
  assert.equal(hasPackageDeclaration('default allow := false'), false);
  assert.equal(packageOf('no package here'), '');
});

// ─── validation ─────────────────────────────────────────────────────────────

test('validateRegoModule accepts well-formed input', () => {
  const r = validateRegoModule({ id: 'offgrid/authz', rego: 'package offgrid.authz\nallow := true\n' });
  assert.ok(r.ok);
  assert.equal(r.value?.id, 'offgrid/authz');
});

test('validateRegoModule rejects missing package + bad id + empty source', () => {
  const noPkg = validateRegoModule({ id: 'x', rego: 'allow := true' });
  assert.equal(noPkg.ok, false);
  assert.ok(noPkg.errors.some((e) => e.includes('package')));

  const badId = validateRegoModule({ id: 'Bad Id', rego: 'package p' });
  assert.equal(badId.ok, false);
  assert.ok(badId.errors.some((e) => e.includes('slug')));

  const empty = validateRegoModule({ id: 'x', rego: '' });
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.some((e) => e.includes('required')));
});

// ─── compile-error parsing ──────────────────────────────────────────────────

test('parseOpaCompileErrors flattens nested OPA errors with location', () => {
  const body = {
    code: 'invalid_parameter',
    message: 'error(s) occurred while compiling module(s)',
    errors: [
      {
        code: 'rego_parse_error',
        message: 'unexpected identifier token',
        location: { file: 'x', row: 3, col: 5 },
      },
      { code: 'rego_type_error', message: 'undefined function' },
    ],
  };
  const errs = parseOpaCompileErrors(body);
  assert.equal(errs.length, 2);
  assert.equal(errs[0].location, '3:5');
  assert.equal(errs[0].code, 'rego_parse_error');
  assert.equal(errs[1].location, '', 'no location degrades to empty string');
  assert.match(formatCompileErrors(errs), /3:5 unexpected identifier token/);
});

test('parseOpaCompileErrors falls back to top-level code/message', () => {
  const errs = parseOpaCompileErrors({ code: 'bad_request', message: 'nope' });
  assert.equal(errs.length, 1);
  assert.equal(errs[0].message, 'nope');
});

test('parseOpaCompileErrors is safe on junk', () => {
  assert.deepEqual(parseOpaCompileErrors(null), []);
  assert.deepEqual(parseOpaCompileErrors('str'), []);
  assert.deepEqual(parseOpaCompileErrors({}), []);
});

// ─── response shaping ───────────────────────────────────────────────────────

test('normalizeModule + normalizeModuleList shape OPA responses', () => {
  const single = normalizeModule({ id: 'authz', raw: 'package offgrid.authz\n' });
  assert.equal(single?.id, 'authz');
  assert.equal(single?.package, 'offgrid.authz');
  assert.equal(normalizeModule({ raw: 'x' }), null, 'no id → null');

  const list = normalizeModuleList({
    result: [
      { id: 'b', raw: 'package b' },
      { id: 'a', raw: 'package a' },
      { raw: 'no id' },
    ],
  });
  assert.deepEqual(
    list.map((m) => m.id),
    ['a', 'b'],
    'sorted by id, id-less dropped',
  );
  assert.deepEqual(normalizeModuleList(null), []);
  assert.deepEqual(normalizeModuleList({ result: 'nope' }), []);
});

// ─── url building ───────────────────────────────────────────────────────────

test('opaPolicyUrl builds collection + item urls, trims slash, encodes id', () => {
  assert.equal(opaPolicyUrl('http://opa:8181'), 'http://opa:8181/v1/policies');
  assert.equal(opaPolicyUrl('http://opa:8181/'), 'http://opa:8181/v1/policies');
  assert.equal(opaPolicyUrl('http://opa:8181', 'authz'), 'http://opa:8181/v1/policies/authz');
  assert.equal(
    opaPolicyUrl('http://opa:8181', 'offgrid/authz'),
    'http://opa:8181/v1/policies/offgrid%2Fauthz',
  );
});
