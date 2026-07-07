import Link from 'next/link';
import { ArrowUpRight } from '@phosphor-icons/react/dist/ssr';

// ─── LensLink — "this pipeline's slice of <global surface>" ────────────────────────────────────────
//
// Every per-pipeline telemetry tab is a LENS over a global roll-up (the run is the join key; a tab is
// that run data filtered by pipeline id). This small band states that honestly and links to the
// global page so an operator can widen from the pipeline's slice to the org-wide roll-up.
export function LensLink({
  pipelineName,
  surface,
  href,
}: {
  pipelineName: string;
  surface: string;
  href: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <span>
        This is <span className="font-medium text-foreground">{pipelineName}</span>&apos;s slice of{' '}
        {surface}.
      </span>
      <Link href={href} className="inline-flex items-center gap-1 text-primary hover:underline">
        Open global {surface} <ArrowUpRight className="size-3.5" />
      </Link>
    </div>
  );
}
