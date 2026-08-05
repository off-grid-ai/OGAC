'use client';

import { useCallback, useRef } from 'react';
import { Markdown } from '@/components/chat/Markdown';
import { Badge } from '@/components/ui/badge';
import { SOURCE_LABEL, type CopilotAnswer } from '@/components/copilot/useCopilotAnswer';

// The one place an answer + its citations are rendered. Extracted from AskPanel so the guide reuses it
// rather than growing a second answer UI that could drift from the honesty rules: the source label
// always states where the answer came from, and when there were no records the absence is stated in
// words instead of leaving an empty space that reads like a citation list.
//
// WHY THE BODY IS MARKDOWN AND NOT A <p>. It used to render into a `whitespace-pre-wrap` paragraph, so
// a model that answered in markdown — which this one does, unprompted — put `**Conclusion:**`, `- ` and
// backticked identifiers on screen as literal characters. The answer was correct and read like a
// dumped log file. It reuses the chat renderer rather than adding a second one, which brings three
// things for free:
//
//   • GFM lists/tables, so an evidence list renders as a list.
//   • `stripControlTokens`, which matters more here than in chat: the fleet's only model is a REASONING
//     model, so a leaked `<think>` block would otherwise print its private working as the answer.
//   • `[n]` markers become clickable chips. These answers are dense with them (`[22]`, `[25]`–`[30]`)
//     and every one is a real cited record — as plain text they were noise, as chips they are the
//     shortest path from a claim to the evidence under it.

export function CopilotAnswerView({ result }: Readonly<{ result: CopilotAnswer }>) {
  const listRef = useRef<HTMLOListElement>(null);

  // Scroll the cited record into view and flash it. Queried inside this component's own list rather
  // than by document id, because two answer views can be mounted at once (the guide and the Ask panel)
  // and a global id would make a chip in one jump to the other's citation.
  const jumpToCitation = useCallback((n: number) => {
    const item = listRef.current?.querySelector<HTMLLIElement>(`[data-cite="${n}"]`);
    if (!item) return;
    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    item.classList.add('bg-primary/10');
    setTimeout(() => item.classList.remove('bg-primary/10'), 1400);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Answer
        </span>
        <Badge variant="secondary" className="text-[11px] font-normal text-muted-foreground">
          {SOURCE_LABEL[result.source]}
        </Badge>
      </div>

      <Markdown sourceCount={result.citations.length} onCiteClick={jumpToCitation}>
        {result.answer}
      </Markdown>

      {result.citations.length > 0 ? (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Cited records
          </p>
          <ol ref={listRef} className="space-y-1.5">
            {result.citations.map((c) => (
              <li
                key={c.n}
                data-cite={c.n}
                className="flex gap-2 rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors duration-300"
              >
                <span className="shrink-0 font-mono text-foreground">[{c.n}]</span>
                <span>
                  <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">
                    {c.source}
                  </span>
                  {c.text}
                  {c.ref ? (
                    <a href={c.ref} className="ml-1 text-primary underline-offset-2 hover:underline">
                      view
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          No underlying records were available for this question.
        </p>
      )}
    </div>
  );
}
