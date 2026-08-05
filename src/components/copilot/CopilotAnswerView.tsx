'use client';

import { Badge } from '@/components/ui/badge';
import { SOURCE_LABEL, type CopilotAnswer } from '@/components/copilot/useCopilotAnswer';

// The one place an answer + its citations are rendered. Extracted from AskPanel so the floating guide
// reuses it rather than growing a second answer UI that could drift from the honesty rules: the source
// label always states where the answer came from, and when there were no records the absence is stated
// in words instead of leaving an empty space that reads like a citation list.

export function CopilotAnswerView({
  result,
  compact = false,
}: Readonly<{ result: CopilotAnswer; compact?: boolean }>) {
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

      <p
        className={`whitespace-pre-wrap leading-relaxed text-foreground ${compact ? 'text-[13px]' : 'text-sm'}`}
      >
        {result.answer}
      </p>

      {result.citations.length > 0 ? (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Cited records
          </p>
          <ol className="space-y-1.5">
            {result.citations.map((c) => (
              <li key={c.n} className="flex gap-2 text-xs text-muted-foreground">
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
