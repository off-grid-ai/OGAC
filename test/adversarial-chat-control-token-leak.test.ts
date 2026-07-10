import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textForSpeech } from '../src/lib/chat-audio.ts';

// ADVERSARIAL — the OD14 control-token LEAK class, exercised at the one pure seam the harness can
// reach. When a model (esp. a local one without native structured tool-calling) emits control/tool
// tokens INLINE in `content` — `<function=search{…}>`, `<think>…</think>`, `<tool_call>{…}</tool_call>`,
// `<|im_start|>` — nothing in the chat content path strips them (verified: no stripper in
// src/lib/chat* or src/components/chat). So:
//   • the chat bubble renders them as literal visible text (react-markdown escapes → the reader still
//     SEES `<function=…>` / the chain-of-thought). Proven via renderToStaticMarkup(<Markdown>) — see
//     docs/adversarial/chat.md §break-3; not runnable here (node --test cannot import .tsx).
//   • TTS (api/v1/chat/speak → textForSpeech) reads them ALOUD — asserted below (pure, runnable).
//
// TERMINAL artifact: the spoken string synthesized to audio. If it still contains the tokens, the
// user hears `<function=…>` / the hidden reasoning as speech. Currently RED — textForSpeech strips
// markdown but NOT control/tool tokens. Skipped so the shared suite stays green.
// GAPS: G-ADV-CHAT-3 (control-token leak in rendered content + TTS).

test('ADVERSARIAL: currently RED, documents G-ADV-CHAT-3 — TTS reads control/tool tokens aloud (textForSpeech does not strip them)', () => {
  const spoken = textForSpeech(
    'The result is <function=search{"q":"pii"}> and <tool_call>{"name":"x"}</tool_call> forty-two.',
  );
  // A leak-free TTS sanitizer removes tool/control markup before synthesis. On current code the
  // angle-bracket tokens survive verbatim, so the synthesized audio pronounces them.
  assert.ok(!/[<>]/.test(spoken), `TTS text still contains angle-bracket tokens: "${spoken}"`);
  assert.ok(
    !/function=|tool_call|im_start/.test(spoken),
    `TTS text still contains control-token keywords (read aloud): "${spoken}"`,
  );
});

test('ADVERSARIAL: currently RED, documents G-ADV-CHAT-3 — TTS speaks a chain-of-thought <think> block the UI keeps collapsed', () => {
  // The reasoning block is deliberately collapsible in the bubble (ThinkingBlock). If reasoning
  // leaks INTO content as a <think>…</think> span, textForSpeech does not strip the wrapper, so the
  // synthesized audio reads the private chain-of-thought aloud.
  const spoken = textForSpeech(
    '<think>The user is probably lying about their income.</think>Your loan is approved.',
  );
  assert.ok(
    !spoken.includes('The user is probably lying about their income.'),
    `TTS spoke the hidden chain-of-thought: "${spoken}"`,
  );
});
