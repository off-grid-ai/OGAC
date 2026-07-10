import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripControlTokens } from '../src/lib/strip-control-tokens.ts';

// Unit tests for the pure control-token sanitizer. Drives the REAL function, asserts the terminal
// string output. Every branch of stripControlTokens is exercised (100% target for this new module).

test('empty / falsy input returns empty string (guard branch)', () => {
  assert.equal(stripControlTokens(''), '');
  // @ts-expect-error — exercise the runtime guard against a non-string falsy value
  assert.equal(stripControlTokens(undefined), '');
});

test('clean content is returned UNCHANGED (no-op fast path, identity preserved)', () => {
  const clean = 'Your loan is approved.\n\nNext steps: sign the form.';
  // Identical reference-equality is not required, but the value must be byte-identical (no
  // whitespace collapse when nothing was stripped).
  assert.equal(stripControlTokens(clean), clean);
});

test('strips a <function=…> call token', () => {
  const out = stripControlTokens('The result is <function=search{"q":"pii"}> forty-two.');
  assert.ok(!/[<>]/.test(out), out);
  assert.ok(!/function=/.test(out), out);
  assert.equal(out, 'The result is forty-two.');
});

test('strips a paired <tool_call>…</tool_call> block INCLUDING its payload', () => {
  const out = stripControlTokens('Before <tool_call>{"name":"x","args":{}}</tool_call> after.');
  assert.ok(!/tool_call/.test(out), out);
  assert.ok(!out.includes('"name":"x"'), out);
  assert.equal(out, 'Before after.');
});

test('removes a <think> chain-of-thought block and its inner reasoning entirely', () => {
  const out = stripControlTokens(
    '<think>The user is probably lying about their income.</think>Your loan is approved.',
  );
  assert.ok(!out.includes('probably lying'), out);
  assert.ok(!/think/i.test(out), out);
  assert.equal(out, 'Your loan is approved.');
});

test('strips chat-template sentinels (<|im_start|> / <|im_end|>)', () => {
  const out = stripControlTokens('<|im_start|>assistant\nHi<|im_end|>');
  assert.ok(!/<\|/.test(out), out);
  assert.equal(out, 'assistant\nHi');
});

test('strips a STRAY/unclosed control tag (malformed stream) — no leak', () => {
  // An open <reasoning> with no close: the paired regex won't match, the stray regex must.
  const out = stripControlTokens('answer <reasoning> then more');
  assert.ok(!/reasoning/i.test(out), out);
  assert.equal(out, 'answer then more');
});

test('collapses the whitespace left behind but preserves paragraph newlines', () => {
  const out = stripControlTokens('Para one.\n\n<think>x</think>\n\n\nPara two.');
  assert.ok(!/think/.test(out), out);
  assert.ok(!/\n{3,}/.test(out), `should not leave 3+ consecutive newlines: ${JSON.stringify(out)}`);
  assert.match(out, /Para one\./);
  assert.match(out, /Para two\./);
});

test('handles multiple mixed tokens in one string', () => {
  const out = stripControlTokens(
    '<|im_start|><think>hidden</think>Visible <function=x{}> and <tool_call>{}</tool_call> done.<|im_end|>',
  );
  assert.ok(!/[<>]/.test(out), out);
  assert.ok(!/hidden/.test(out), out);
  assert.ok(out.includes('Visible'), out);
  assert.ok(out.includes('done.'), out);
});
