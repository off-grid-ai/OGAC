import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  REPORT_SECTIONS,
  slugifyTemplateName,
  validateTemplate,
} from '../src/lib/reports-template.ts';

test('validates and normalizes a complete custom template', () => {
  const v = validateTemplate({
    name: '  Quarterly Board Pack  ',
    description: '  For the board  ',
    sections: ['Compliance', 'controls', 'audit'],
    frameworks: ['DPDP', 'gdpr'],
    source: 'Regulatory plane',
    schedule: 'Quarterly',
  });
  assert.equal(v.ok, true);
  assert.ok(v.value);
  assert.equal(v.value.name, 'Quarterly Board Pack');
  assert.equal(v.value.description, 'For the board');
  // sections lowercased + validated
  assert.deepEqual(v.value.sections, ['compliance', 'controls', 'audit']);
  assert.deepEqual(v.value.frameworks, ['dpdp', 'gdpr']);
  assert.equal(v.value.schedule, 'quarterly');
});

test('requires a name and at least one section (non-partial)', () => {
  const v = validateTemplate({ name: '', sections: [] });
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes('name is required'));
  assert.ok(v.errors.includes('at least one valid section is required'));
});

test('rejects unknown sections', () => {
  const v = validateTemplate({ name: 'x', sections: ['controls', 'bogus'] });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('unknown section: bogus')));
});

test('rejects unknown source', () => {
  const v = validateTemplate({ name: 'x', sections: ['controls'], source: 'Made Up' });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('unknown source')));
});

test('defaults source and schedule when omitted', () => {
  const v = validateTemplate({ name: 'x', sections: ['controls'] });
  assert.equal(v.ok, true);
  assert.equal(v.value?.source, 'Regulatory plane');
  assert.equal(v.value?.schedule, 'none');
});

test('drops duplicate + non-string sections and frameworks', () => {
  const v = validateTemplate({
    name: 'x',
    sections: ['controls', 'controls', 42, 'audit'],
    frameworks: ['dpdp', 'dpdp', null],
  });
  assert.equal(v.ok, true);
  assert.deepEqual(v.value?.sections, ['controls', 'audit']);
  assert.deepEqual(v.value?.frameworks, ['dpdp']);
});

test('unknown schedule falls back to none rather than erroring', () => {
  const v = validateTemplate({ name: 'x', sections: ['controls'], schedule: 'hourly' });
  assert.equal(v.ok, true);
  assert.equal(v.value?.schedule, 'none');
});

test('partial validation skips required-field checks', () => {
  const v = validateTemplate({ description: 'just a tweak' }, true);
  assert.equal(v.ok, true);
  assert.equal(v.value?.description, 'just a tweak');
  assert.deepEqual(v.value?.sections, []);
});

test('partial validation still rejects an unknown section if supplied', () => {
  const v = validateTemplate({ sections: ['nope'] }, true);
  assert.equal(v.ok, false);
});

test('every declared section is accepted by the validator', () => {
  const v = validateTemplate({ name: 'all', sections: [...REPORT_SECTIONS] });
  assert.equal(v.ok, true);
  assert.equal(v.value?.sections.length, REPORT_SECTIONS.length);
});

test('slugify produces stable url-safe ids', () => {
  assert.equal(slugifyTemplateName('Quarterly Board Pack!'), 'quarterly-board-pack');
  assert.equal(slugifyTemplateName('  RBI / SEBI  '), 'rbi-sebi');
  assert.equal(slugifyTemplateName('***'), 'report');
  assert.equal(slugifyTemplateName(''), 'report');
});
