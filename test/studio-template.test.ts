import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeVisibility,
  parseProvidedVars,
  parseTemplatePatch,
  parseTemplateVarSchema,
  slugFromTitle,
} from '../src/lib/studio-template.ts';

test('slugFromTitle: url-safe base + suffix', () => {
  assert.equal(slugFromTitle('Renewals Assistant!', 'ab12'), 'renewals-assistant-ab12');
  assert.equal(slugFromTitle('   ', 'zz99'), 'app-zz99');
  assert.equal(slugFromTitle('///', 'x1'), 'app-x1');
});

test('slugFromTitle: base is capped at 32 chars', () => {
  const long = 'a'.repeat(60);
  const slug = slugFromTitle(long, 'ab12');
  assert.equal(slug, `${'a'.repeat(32)}-ab12`);
});

test('normalizeVisibility: coerces to the allowed set', () => {
  assert.equal(normalizeVisibility('org'), 'org');
  assert.equal(normalizeVisibility('public'), 'public');
  assert.equal(normalizeVisibility('private'), 'private');
  assert.equal(normalizeVisibility('nonsense'), 'private');
  assert.equal(normalizeVisibility(undefined), 'private');
});

test('parseTemplatePatch: only present keys are written', () => {
  const patch = parseTemplatePatch({ summary: '  hi  ' }, { slug: null, title: 'T' });
  assert.deepEqual(patch, { summary: 'hi' });
});

test('parseTemplatePatch: blank title → null', () => {
  assert.equal(parseTemplatePatch({ title: '   ' }, { slug: null, title: 'T' }), null);
});

test('parseTemplatePatch: publishing mints a slug + forces public', () => {
  const patch = parseTemplatePatch({ published: true }, { slug: null, title: 'My App' });
  assert.equal(patch?.published, true);
  assert.equal(patch?.visibility, 'public');
  assert.ok(patch?.slug?.startsWith('my-app-'));
});

test('parseTemplatePatch: re-publishing keeps the existing slug', () => {
  const patch = parseTemplatePatch({ published: true }, { slug: 'my-app-abcd', title: 'My App' });
  assert.equal(patch?.published, true);
  assert.equal(patch?.slug, undefined); // no new slug minted
  assert.equal(patch?.visibility, 'public');
});

test('parseTemplatePatch: unpublish clears published, keeps slug (not touched here)', () => {
  const patch = parseTemplatePatch({ published: false }, { slug: 'x-abcd', title: 'X' });
  assert.equal(patch?.published, false);
  assert.equal(patch?.slug, undefined);
  assert.equal(patch?.visibility, undefined);
});

test('parseTemplatePatch: publish uses the new title for the slug when renaming', () => {
  const patch = parseTemplatePatch(
    { title: 'Fresh Name', published: true },
    { slug: null, title: 'Old' },
  );
  assert.ok(patch?.slug?.startsWith('fresh-name-'));
});

test('parseTemplateVarSchema: coerces a valid vars body, keeps only meaningful fields', () => {
  const schema = parseTemplateVarSchema([
    { name: '  team  ', type: 'text', required: true, description: '  the team  ' },
    { name: 'region', type: 'select', options: ['APAC', '', 'EU'], default: 'APAC' },
    { name: 'x', type: 'number', default: '' }, // empty default dropped
  ]);
  assert.deepEqual(schema.vars, [
    { name: 'team', type: 'text', description: 'the team', required: true },
    { name: 'region', type: 'select', default: 'APAC', options: ['APAC', 'EU'] },
    { name: 'x', type: 'number' },
  ]);
});

test('parseTemplateVarSchema: unknown type falls back to text; options only for select', () => {
  const schema = parseTemplateVarSchema([
    { name: 'a', type: 'weird', options: ['x'] },
    { name: 'b', type: 'text', options: ['y'] }, // non-select options ignored
  ]);
  assert.deepEqual(schema.vars, [
    { name: 'a', type: 'text' },
    { name: 'b', type: 'text' },
  ]);
});

test('parseTemplateVarSchema: drops entries with no name / non-object / non-array input', () => {
  assert.deepEqual(parseTemplateVarSchema([{ type: 'text' }, null, 'nope', { name: '  ' }]).vars, []);
  assert.deepEqual(parseTemplateVarSchema(null).vars, []);
  assert.deepEqual(parseTemplateVarSchema('not an array').vars, []);
});

test('parseTemplateVarSchema: select with no valid options drops options', () => {
  const schema = parseTemplateVarSchema([{ name: 's', type: 'select', options: ['', '  '] }]);
  assert.deepEqual(schema.vars, [{ name: 's', type: 'select' }]);
});

test('parseProvidedVars: coerces string/number/boolean values, drops the rest', () => {
  assert.deepEqual(
    parseProvidedVars({ team: 'Claims', count: 3, live: true, obj: {}, arr: [], empty: '' }),
    { team: 'Claims', count: '3', live: 'true', empty: '' },
  );
});

test('parseProvidedVars: non-object input → empty map', () => {
  assert.deepEqual(parseProvidedVars(null), {});
  assert.deepEqual(parseProvidedVars('x'), {});
  assert.deepEqual(parseProvidedVars(42), {});
});
