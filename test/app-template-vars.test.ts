import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec } from '../src/lib/app-model.ts';
import {
  bindTemplateVars,
  collectSpecPlaceholders,
  extractPlaceholders,
  isValidVarName,
  resolveValues,
  substituteSpec,
  substituteString,
  validateVarSchema,
  type TemplateVarSchema,
} from '../src/lib/app-template-vars.ts';

function templatedApp(over: Partial<AppSpec> = {}): AppSpec {
  return {
    id: 'app_t',
    orgId: 'org',
    ownerId: 'o',
    title: '{{team}} Renewals',
    summary: 'For the {{team}} team in {{region}}',
    visibility: 'org',
    published: true,
    pipelineId: null,
    trigger: { kind: 'on-demand', config: { note: 'owner is {{owner}}' } },
    inputForm: [{ key: 'x', label: 'Policy for {{team}}', type: 'text' }],
    steps: [
      {
        id: 's1',
        label: 'Draft for {{team}}',
        kind: 'agent',
        inlineAgent: { systemPrompt: 'You help {{team}} in {{region}}. Escalate to {{owner}}.', grounded: true },
      },
    ],
    edges: [],
    ...over,
  };
}

const schema: TemplateVarSchema = {
  vars: [
    { name: 'team', type: 'text', required: true, description: 'Owning team' },
    { name: 'region', type: 'select', options: ['APAC', 'EU'], default: 'APAC' },
    { name: 'owner', type: 'text', default: 'ops@x' },
  ],
};

test('isValidVarName: accepts word tokens, rejects spaces/braces/empty', () => {
  assert.equal(isValidVarName('team'), true);
  assert.equal(isValidVarName('team.name-1'), true);
  assert.equal(isValidVarName('bad name'), false);
  assert.equal(isValidVarName(''), false);
  assert.equal(isValidVarName('{{x}}'), false);
  assert.equal(isValidVarName(undefined as unknown as string), false);
});

test('extractPlaceholders: distinct names, whitespace-tolerant, empty/non-string safe', () => {
  assert.deepEqual(extractPlaceholders('{{a}} and {{ b }} and {{a}}'), ['a', 'b']);
  assert.deepEqual(extractPlaceholders('no vars here'), []);
  assert.deepEqual(extractPlaceholders(''), []);
  assert.deepEqual(extractPlaceholders(null as unknown as string), []);
});

test('substituteString: binds known vars, leaves unknown placeholders UNTOUCHED', () => {
  assert.equal(substituteString('hi {{a}} {{b}}', { a: 'X' }), 'hi X {{b}}');
  assert.equal(substituteString('', { a: 'X' }), '');
  assert.equal(substituteString('none', {}), 'none');
});

test('substituteString: a bound empty-string value replaces (explicit binding, not a gap)', () => {
  assert.equal(substituteString('[{{a}}]', { a: '' }), '[]');
});

test('collectSpecPlaceholders: walks title/summary/trigger/inputForm/steps', () => {
  const found = collectSpecPlaceholders(templatedApp()).sort();
  assert.deepEqual(found, ['owner', 'region', 'team']);
});

test('resolveValues: adopter value wins; blank falls to default; required-without-value flagged', () => {
  const { values, missingRequired } = resolveValues(schema, { team: 'Claims', region: '  ' });
  assert.equal(values.team, 'Claims'); // supplied
  assert.equal(values.region, 'APAC'); // blank → default
  assert.equal(values.owner, 'ops@x'); // omitted → default
  assert.deepEqual(missingRequired, []);
});

test('resolveValues: required var with no value and no default → missingRequired', () => {
  const { values, missingRequired } = resolveValues(schema, {});
  assert.equal(values.team, undefined);
  assert.deepEqual(missingRequired, ['team']);
});

test('resolveValues: coerces a non-string supplied value', () => {
  const s: TemplateVarSchema = { vars: [{ name: 'n', type: 'number' }] };
  const { values } = resolveValues(s, { n: 42 as unknown as string });
  assert.equal(values.n, '42');
});

test('resolveValues: null supplied value falls through to default', () => {
  const s: TemplateVarSchema = { vars: [{ name: 'n', type: 'text', default: 'd' }] };
  const { values } = resolveValues(s, { n: null as unknown as string });
  assert.equal(values.n, 'd');
});

test('substituteSpec: binds across all text fields, returns a NEW spec (no mutation)', () => {
  const src = templatedApp();
  const bound = substituteSpec(src, { team: 'Claims', region: 'EU', owner: 'lead@x' });
  assert.equal(bound.title, 'Claims Renewals');
  assert.equal(bound.summary, 'For the Claims team in EU');
  assert.equal(bound.trigger.config?.note, 'owner is lead@x');
  assert.equal(bound.inputForm?.[0].label, 'Policy for Claims');
  const step = bound.steps[0];
  if (step.kind !== 'agent') throw new Error('unreachable');
  assert.equal(step.inlineAgent?.systemPrompt, 'You help Claims in EU. Escalate to lead@x.');
  // Source untouched.
  assert.equal(src.title, '{{team}} Renewals');
});

test('substituteSpec: no inputForm / no trigger is handled', () => {
  const src = templatedApp({ inputForm: undefined, trigger: { kind: 'on-demand' } });
  const bound = substituteSpec(src, { team: 'T', region: 'EU', owner: 'o' });
  assert.equal(bound.inputForm, undefined);
  assert.equal(bound.title, 'T Renewals');
});

test('bindTemplateVars: fully bound → ok, no gaps', () => {
  const res = bindTemplateVars(templatedApp(), schema, { team: 'Claims' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.missingRequired, []);
  assert.deepEqual(res.unbound, []);
  assert.deepEqual(res.undeclared, []);
  assert.equal(res.spec.title, 'Claims Renewals');
});

test('bindTemplateVars: missing required var → honest gap, spec still carries the raw placeholder', () => {
  const res = bindTemplateVars(templatedApp(), schema, {});
  assert.equal(res.ok, false);
  assert.deepEqual(res.missingRequired, ['team']);
  assert.ok(res.unbound.includes('team'));
  // The raw {{team}} is left in the spec — NEVER silently blanked.
  assert.ok(res.spec.title.includes('{{team}}'));
});

test('bindTemplateVars: placeholder used in spec but not declared → undeclared gap', () => {
  const app = templatedApp({ summary: 'uses {{ghost}}' });
  const res = bindTemplateVars(app, schema, { team: 'C' });
  assert.equal(res.ok, false);
  assert.ok(res.undeclared.includes('ghost'));
  assert.ok(res.unbound.includes('ghost'));
});

test('validateVarSchema: clean schema against its spec → no errors', () => {
  assert.deepEqual(validateVarSchema(schema, templatedApp()), []);
});

test('validateVarSchema: illegal name, duplicate, bad type', () => {
  const bad: TemplateVarSchema = {
    vars: [
      { name: 'ok', type: 'text' },
      { name: 'ok', type: 'text' }, // duplicate
      { name: 'bad name', type: 'text' }, // illegal
      { name: 'weird', type: 'json' as unknown as 'text' }, // bad type
    ],
  };
  const errors = validateVarSchema(bad);
  assert.ok(errors.some((e) => e.includes("duplicate variable: 'ok'")));
  assert.ok(errors.some((e) => e.includes("invalid variable name: 'bad name'")));
  assert.ok(errors.some((e) => e.includes("unknown type 'json'")));
});

test('validateVarSchema: select needs options; default must be one of them', () => {
  const noOpts: TemplateVarSchema = { vars: [{ name: 's', type: 'select' }] };
  assert.ok(validateVarSchema(noOpts).some((e) => e.includes('at least one option')));
  const badDefault: TemplateVarSchema = {
    vars: [{ name: 's', type: 'select', options: ['a', 'b'], default: 'z' }],
  };
  assert.ok(validateVarSchema(badDefault).some((e) => e.includes('not one of its options')));
});

test('validateVarSchema: flags a spec placeholder the schema forgot to declare', () => {
  const app = templatedApp({ summary: 'uses {{undeclared_one}}' });
  const errors = validateVarSchema(schema, app);
  assert.ok(errors.some((e) => e.includes("undeclared variable: 'undeclared_one'")));
});

test('validateVarSchema: empty schema is valid', () => {
  assert.deepEqual(validateVarSchema({ vars: [] }), []);
});
