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
