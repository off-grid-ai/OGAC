import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractPartialRefs,
  extractVariables,
  inlinePartials,
  renderPromptWithPartials,
} from '../src/lib/prompt-template.ts';
import { slugPartialName } from '../src/lib/prompt-partials.ts';

// PURE unit tests for prompt PARTIALS — the {{>partial-name}} compose/inline logic + the name slug.

test('extractPartialRefs pulls distinct {{>name}} refs in order', () => {
  const tpl = 'A {{>header}} B {{>footer}} C {{>header}}';
  assert.deepEqual(extractPartialRefs(tpl), ['header', 'footer']);
});

test('extractVariables ignores partial refs (they are not variables)', () => {
  const tpl = 'Hi {{name}} — {{>disclaimer}}';
  assert.deepEqual(extractVariables(tpl), ['name']);
  assert.deepEqual(extractPartialRefs(tpl), ['disclaimer']);
});

test('inlinePartials replaces a ref with its body', () => {
  const r = inlinePartials('Start {{>foot}} End', { foot: 'THE FOOTER' });
  assert.equal(r.content, 'Start THE FOOTER End');
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.cyclic, []);
});

test('inlinePartials inlines nested partials recursively', () => {
  const r = inlinePartials('{{>a}}', { a: 'A[{{>b}}]', b: 'B[{{>c}}]', c: 'C' });
  assert.equal(r.content, 'A[B[C]]');
});

test('inlinePartials leaves unknown refs literal and reports them', () => {
  const r = inlinePartials('x {{>nope}} y', {});
  assert.equal(r.content, 'x {{>nope}} y');
  assert.deepEqual(r.missing, ['nope']);
});

test('inlinePartials detects a cycle without infinite recursion', () => {
  const r = inlinePartials('{{>a}}', { a: 'A{{>b}}', b: 'B{{>a}}' });
  // a → b → (a again = cycle, left literal)
  assert.equal(r.content, 'AB{{>a}}');
  assert.deepEqual(r.cyclic, ['a']);
});

test('inlinePartials tolerates whitespace inside the token', () => {
  const r = inlinePartials('{{> spaced }}', { spaced: 'OK' });
  assert.equal(r.content, 'OK');
});

test('renderPromptWithPartials inlines FIRST then fills variables (incl. vars inside a partial)', () => {
  const out = renderPromptWithPartials(
    'Dear {{customer}}, {{>signoff}}',
    { customer: 'Asha', agent: 'Ravi' },
    { signoff: 'regards, {{agent}}' },
  );
  assert.equal(out.rendered, 'Dear Asha, regards, Ravi');
  assert.equal(out.content, 'Dear {{customer}}, regards, {{agent}}');
});

test('renderPromptWithPartials keeps unfilled variables as their placeholder', () => {
  const out = renderPromptWithPartials('{{>greet}}', {}, { greet: 'Hi {{name}}' });
  assert.equal(out.rendered, 'Hi {{name}}');
});

test('slugPartialName normalises to the {{>name}} grammar', () => {
  assert.equal(slugPartialName('My Header Block!'), 'my-header-block');
  assert.equal(slugPartialName('   toneOfVoice  '), 'toneofvoice');
  assert.equal(slugPartialName('a/b\\c'), 'abc');
  assert.equal(slugPartialName(''), 'partial');
  assert.equal(slugPartialName('--edge--'), 'edge');
});

test('a slugged name round-trips through extractPartialRefs', () => {
  const name = slugPartialName('Legal Disclaimer 2026');
  const refs = extractPartialRefs(`text {{>${name}}} more`);
  assert.deepEqual(refs, [name]);
});
