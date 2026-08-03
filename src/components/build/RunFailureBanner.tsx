import { Warning } from '@phosphor-icons/react/dist/ssr';
import { failureExplanation, progressSentence, type FailedStep } from '@/lib/run-failure';

// ─── Why it could not finish ─────────────────────────────────────────────────────────────────────────
//
// This sits ABOVE everything else on a failed run, because it is the only thing the person who owns the
// process came to find out. Before it, the page opened with a JSON dump of the run input, a red chip and
// "3/6 steps", and the actual reason was engineer text buried one step down.
//
// The technical detail is kept — not deleted — in a collapsed disclosure. Someone technical will want the
// exact string, and hiding it entirely would just move the dependency rather than remove it.
export function RunFailureBanner({ steps }: Readonly<{ steps: readonly FailedStep[] | undefined }>) {
  const f = failureExplanation(steps);
  const progress = progressSentence(steps);

  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/[0.05] p-4">
      <div className="flex items-start gap-2.5">
        <Warning className="mt-0.5 size-4 shrink-0 text-destructive" weight="fill" />
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-medium text-foreground">{f.why}</p>
          <p className="text-xs text-muted-foreground">
            {f.where ? (
              <>
                It stopped at <span className="font-medium text-foreground">{f.where}</span>.
              </>
            ) : null}
            {progress ? ` ${progress}` : ''}
          </p>
          {f.nextStep ? <p className="text-xs text-foreground">{f.nextStep}</p> : null}
          {/* Preserved for whoever IS technical — one click away, not first. */}
          {f.technicalDetail ? (
            <details className="pt-1">
              <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                Technical detail for whoever supports this
              </summary>
              <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">
                {f.technicalDetail}
              </pre>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}
