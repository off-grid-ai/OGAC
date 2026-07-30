import { displayCell, humanizeColumn, parseRowsOutput } from '@/lib/step-output-view';

/**
 * A step's evidence, rendered for a REVIEWER. ONE component, used by every surface that shows it.
 *
 * Flow 6 in `docs/roadmap-real.md` requires that the reviewer "understands the action and evidence". A
 * data read arrives as `label (resource): 6 row(s).` followed by a JSON payload, and showing that raw made
 * approving a claim a rubber stamp — nobody can check a decision against a positional array.
 *
 * It lives here rather than inside one screen because it was already duplicated: `AppRunStatus` renders the
 * step list and `AppReview` renders "Context so far", and fixing only the first left the reviewer looking at
 * a readable table in one place and raw JSON in the other — on the very surface Flow 6 is about. Two copies
 * of a render is how that drift happens, so there is now one.
 *
 * When the payload parses into rows it becomes a table with the source's OWN column names (their
 * vocabulary, not ours). Anything else — a failure sentence, a prose outcome, an empty read — is already
 * legible and shown exactly as written, so the fallback is never worse than before.
 */
export function StepEvidence({ outcome, maxHeight = 'max-h-56' }: { outcome: string; maxHeight?: string }) {
  const view = parseRowsOutput(outcome);
  if (!view) {
    return (
      <pre
        className={`mt-1 ${maxHeight} overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px] text-foreground`}
      >
        {outcome}
      </pre>
    );
  }
  return (
    <div className="mt-1 rounded border border-border bg-muted/20">
      <div className="flex flex-wrap items-baseline gap-x-2 border-b border-border px-2 py-1">
        <span className="text-[11px] font-medium text-foreground">{view.head}</span>
        {view.coverage ? <span className="text-[10px] text-muted-foreground">{view.coverage}</span> : null}
      </div>
      {/* Wide reads scroll inside their own container; the page body never scrolls sideways. */}
      <div className={`${maxHeight} overflow-auto`}>
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 bg-muted/60">
            <tr>
              {view.columns.map((c) => (
                <th
                  key={c}
                  className="whitespace-nowrap px-2 py-1 text-left font-medium text-muted-foreground"
                >
                  {humanizeColumn(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row, i) => (
              <tr key={i} className="border-t border-border/60">
                {view.columns.map((c) => (
                  <td key={c} className="whitespace-nowrap px-2 py-1 text-foreground">
                    {displayCell(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
