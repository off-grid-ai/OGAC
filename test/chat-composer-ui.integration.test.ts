import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const chatSource = readFileSync(
  new URL('../src/components/chat/ChatWorkspace.tsx', import.meta.url),
  'utf8',
);
const pipelineChipSource = readFileSync(
  new URL('../src/components/pipelines/PipelineChip.tsx', import.meta.url),
  'utf8',
);

test('chat toolbar reflows its governing controls instead of overflowing narrow threads', () => {
  assert.match(chatSource, /grid min-h-12[^"\n]*grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(chatSource, /col-span-2 flex min-w-0[^"\n]*sm:col-span-1/);
  assert.match(chatSource, /className="hidden items-center gap-1 sm:flex"/);
  assert.match(chatSource, /aria-label="Open chat options"/);
  assert.match(chatSource, /className="[^"\n]*min-w-0 flex-1[^"\n]*sm:flex-none"/);
  assert.match(pipelineChipSource, /containerClassName/);
  assert.match(pipelineChipSource, /max-w-\[7rem\] truncate/);
});

test('chat composer extends the shared textarea with a complete listbox contract', () => {
  assert.match(chatSource, /import \{ Textarea \} from '@\/components\/ui\/textarea'/);
  assert.match(chatSource, /<Textarea/);
  assert.match(chatSource, /role="combobox"/);
  assert.match(chatSource, /aria-autocomplete="list"/);
  assert.match(chatSource, /aria-expanded=\{Boolean\(suggestionListboxId\)\}/);
  assert.match(chatSource, /aria-controls=\{suggestionListboxId\}/);
  assert.match(chatSource, /aria-activedescendant=\{activeSuggestionId\}/);

  assert.equal((chatSource.match(/role="listbox"/g) ?? []).length, 2);
  assert.equal((chatSource.match(/role="option"/g) ?? []).length, 2);
  assert.equal((chatSource.match(/aria-selected=/g) ?? []).length, 2);
  assert.match(chatSource, /role="group"/);
  assert.match(chatSource, /aria-labelledby=\{`chat-mention-group-\$\{section\.key\}`\}/);
});

test('chat actions are non-submitting and mention rendering has a dedicated owner', () => {
  const nativeButtons = chatSource.match(/<button\b[^>]*>/gs) ?? [];
  const sharedButtons = chatSource.match(/<Button\b[^>]*>/gs) ?? [];

  assert.ok(nativeButtons.length > 0);
  assert.ok(sharedButtons.length > 0);
  assert.ok(nativeButtons.every((button) => /type="button"/.test(button)));
  assert.ok(sharedButtons.every((button) => /type="button"/.test(button)));
  assert.match(chatSource, /function MentionSuggestionList\(/);
  assert.doesNotMatch(chatSource, /\{\(\(\) => \{/);
});

test('outbound guardrail events erase generated content and surface the established inline feedback', () => {
  assert.match(chatSource, /function isBlockedOutboundGuardrailEvent\(event: unknown\)/);
  assert.match(chatSource, /value\.phase === 'post' && value\.blocked === true/);
  assert.match(chatSource, /if \(isBlockedOutboundGuardrailEvent\(evt\)\)/);
  assert.match(chatSource, /last\.content = ''/);
  assert.match(chatSource, /last\.reasoning = null/);
  assert.match(chatSource, /last\.citations = null/);
  assert.match(chatSource, /last\.error = OUTBOUND_GUARDRAIL_BLOCKED_MESSAGE/);
  assert.match(
    chatSource,
    /Response blocked by output guardrails\. No generated content was released\./,
  );
  assert.match(chatSource, /\) : m\.error \? null : \(/);
});
