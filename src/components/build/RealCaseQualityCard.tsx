import { CheckCircle, Warning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { RealCaseQuality } from '@/lib/quality-on-real-cases';

// ─── Quality on the work it actually does ────────────────────────────────────────────────────────────
//
// The platform judges every finished run out of band — app-run-store fires scoreAppRun and the verdict
// lands in online_scores — and nothing surfaced it on the app that produced it. So the Quality tab
// showed how an app did on a handful of TEST cases and said nothing about the real work, which is the
// question its owner actually has.
//
// Coverage leads, deliberately. Measured on this tenant: 10 finished cases, 1 scored. An average over
// one case is not this app's quality, and a reader shown only the average will take it as one.
export function RealCaseQualityCard({
  quality,
  appHref,
}: Readonly<{ quality: RealCaseQuality; appHref: string }>) {
  const good = quality.judged > 0 && quality.belowBar === 0;
  const nothingKnown = quality.judged === 0;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {nothingKnown ? (
            <Warning className="size-4 text-amber-600" weight="fill" />
          ) : good ? (
            <CheckCircle className="size-4 text-primary" weight="fill" />
          ) : (
            <Warning className="size-4 text-destructive" weight="fill" />
          )}
          Quality on real cases
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          How this app scored on the work it actually did — separate from the test cases below, which
          only tell you how it does on examples somebody wrote.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <p
          className={`text-sm ${
            nothingKnown
              ? 'text-amber-700 dark:text-amber-500'
              : good
                ? 'text-foreground'
                : 'font-medium text-destructive'
          }`}
        >
          {quality.sentence}
        </p>

        {/* A real example beats a number. Someone who sees a low score needs the case, not the average. */}
        {quality.worst && quality.belowBar > 0 ? (
          <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs">
            <p className="font-medium text-foreground">Worst scored case</p>
            <p className="mt-0.5 text-muted-foreground">
              {quality.worst.reasoning?.trim()
                ? quality.worst.reasoning.slice(0, 240)
                : 'The judge recorded no reasoning for this one.'}
            </p>
            <Link
              href={`${appHref}/runs/${encodeURIComponent(quality.worst.runId)}`}
              className="mt-1 inline-block text-primary underline"
            >
              Open that case
            </Link>
          </div>
        ) : null}

        {/* Scoring is best-effort and out of band, so most finished runs simply have no verdict. Saying
            so is the difference between "this app is good" and "we barely looked". */}
        {quality.neverScored > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {quality.neverScored} finished{' '}
            {quality.neverScored === 1 ? 'case has' : 'cases have'} no score at all. Scoring runs in the
            background after a case finishes and is not guaranteed, so absence here means nobody looked
            — not that the case was fine.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
