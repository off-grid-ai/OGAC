'use client';

import { ArrowRight } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useRef } from 'react';
import { Markdown } from '@/components/chat/Markdown';
import { Badge } from '@/components/ui/badge';
import { sourceLabel, type CopilotAnswer } from '@/components/copilot/useCopilotAnswer';
import { isCurrentPath } from '@/lib/guide-copilot';

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
  const router = useRouter();
  const pathname = usePathname();

  // Scroll the cited record into view and flash it. Queried inside this component's own list rather
  // than by document id, because two answer views can be mounted at once (the guide and the Ask panel)
  // and a global id would make a chip in one jump to the other's citation.
  /**
   * Open the evidence behind a citation.
   *
   * Reported as "the citations aren't clickable". They were — the chip scrolled its record into view
   * — but the record list sits directly under the answer and is usually already on screen, so the
   * click produced no visible change and read as dead. Same failure as a link to the page you are
   * already on: handling it is not the same as it doing something.
   *
   * So a citation with a ref NAVIGATES to the record. Scroll-and-flash is kept for the two cases
   * where navigating cannot help: a citation with no ref, and one pointing at the screen already
   * open.
   */
  const openCitation = useCallback(
    (n: number) => {
      const cite = result.citations.find((c) => c.n === n);
      if (cite?.ref && !isCurrentPath(cite.ref, pathname)) {
        router.push(cite.ref);
        return;
      }
      const item = listRef.current?.querySelector<HTMLLIElement>(`[data-cite="${n}"]`);
      if (!item) return;
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      // A strong, slow flash: the subtle one was invisible when the row was already in view, which
      // is most of the time on a panel this size.
      item.classList.add('bg-primary/20', 'ring-1', 'ring-primary/40');
      setTimeout(() => item.classList.remove('bg-primary/20', 'ring-1', 'ring-primary/40'), 1600);
    },
    [pathname, result.citations, router],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Answer
        </span>
        <Badge variant="secondary" className="text-[11px] font-normal text-muted-foreground">
          {sourceLabel(result)}
        </Badge>
      </div>

      <Markdown sourceCount={result.citations.length} onCiteClick={openCitation}>
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
                className="rounded transition-colors duration-300"
              >
                {/* The WHOLE row is the control. It was a four-character "view" link at the end of a
                    wrapped paragraph — the smallest possible target for the most important action on
                    the surface, and invisible unless you went looking for it. */}
                <button
                  type="button"
                  onClick={() => openCitation(c.n)}
                  className="group flex w-full gap-2 rounded px-1 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted"
                >
                  <span className="shrink-0 font-mono text-foreground">[{c.n}]</span>
                  <span>
                    <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">
                      {c.source}
                    </span>
                    {c.text}
                    {c.ref ? (
                      <ArrowRight className="ml-1 inline size-3 shrink-0 align-[-1px] text-primary transition-transform group-hover:translate-x-0.5" />
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        // A screen explanation has no records BY NATURE, so captioning it "no underlying records were
        // available" reads as a failed lookup for a question that never needed one. Only say it when
        // the reader actually asked something the records were supposed to answer.
        result.kind === 'page' ? null : (
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            No underlying records were available for this question.
          </p>
        )
      )}
    </div>
  );
}
