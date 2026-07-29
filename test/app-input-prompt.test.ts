import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInputPrompt } from '../src/lib/app-input-prompt.ts';

// The screen this fixes asked for one required field labelled "Input", with nothing saying what to type.
// Per docs/APP_AS_PRODUCT.md §3 the answer is NOT hand-authored fields — the prompt describes itself from
// what the app already knows, and quotes a REAL previous case.

test('the label is plain language, never a schema name', () => {
  const p = runInputPrompt();
  assert.equal(p.label, 'The case to work on');
  assert.doesNotMatch(p.label, /^input$/i);
});

test('a real previous case becomes the example and the placeholder', () => {
  const p = runInputPrompt({
    trigger: 'on-demand',
    exampleSubject: 'Training course reimbursement — Vikram Desai, ₹16,107',
  });
  assert.match(p.hint, /For example: Training course reimbursement — Vikram Desai, ₹16,107/);
  assert.equal(p.placeholder, 'Training course reimbursement — Vikram Desai, ₹16,107');
});

test('with no previous case NOTHING is invented', () => {
  // A fabricated example would teach a format the app may never accept.
  const p = runInputPrompt({ trigger: 'on-demand' });
  assert.doesNotMatch(p.hint, /For example/);
  assert.equal(p.placeholder, '');
  for (const blank of ['', '   ', null, undefined]) {
    assert.equal(runInputPrompt({ exampleSubject: blank }).placeholder, '');
  }
});

test('when work arrives on its own, manual entry is framed as the exception', () => {
  for (const trigger of ['webhook', 'email', 'whatsapp', 'schedule']) {
    const p = runInputPrompt({ trigger });
    assert.match(p.hint, /arrive on their own/i, `${trigger} should say work arrives`);
    assert.match(p.hint, /by hand/i);
  }
});

test('an on-demand app asks for the case directly, without claiming work arrives', () => {
  const p = runInputPrompt({ trigger: 'on-demand' });
  assert.match(p.hint, /Describe the case/i);
  assert.doesNotMatch(p.hint, /arrive on their own/i);
});

test('an unknown trigger does not claim work arrives automatically', () => {
  const p = runInputPrompt({ trigger: 'telegram-someday' });
  assert.doesNotMatch(p.hint, /arrive on their own/i);
});
