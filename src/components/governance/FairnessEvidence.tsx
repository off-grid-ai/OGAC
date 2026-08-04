'use client';

import { Play, ShieldWarning, CheckCircle, Info } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { explainResponse } from '@/lib/api-failure';
import { ADVERSE_IMPACT_RATIO, MIN_PER_GROUP } from '@/lib/fairness';
import { utcStamp } from '@/lib/timestamp';

export interface FairnessAppRow {
  appId: string;
  appTitle: string;
  /** Whether this app has a step that decides about a person. */
  decides: boolean;
  latest: {
    ranAt: string;
    ranBy: string;
    decided: number;
    tested: number;
    flagged: number;
    sentence: string;
    remedy: string | null;
    absent: string[];
    coverage: { attribute: string; recorded: number; of: number }[];
    findings: { attribute: string; verdict: string; sentence: string }[];
  } | null;
}

// Presentation only. Every judgement — the four-fifths ratio, the minimum group size, whether an attribute
// is a group at all — was made by the pure rule in `fairness.ts`. This renders the verdicts it is handed.
export function FairnessEvidence({ rows }: Readonly<{ rows: FairnessAppRow[] }>) {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);

  async function run(appId: string) {
    setRunning(appId);
    try {
      const res = await fetch(`/api/v1/admin/apps/${encodeURIComponent(appId)}/fairness`, {
        method: 'POST',
      });
      if (!res.ok) {
        const f = await explainResponse(res, 'run a fairness check');
        toast.error(f.message);
        return;
      }
      toast.success('Fairness check run and filed');
      router.refresh();
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="w-full space-y-4">
      <p className="max-w-4xl text-xs text-muted-foreground">
        For each app that decides about a person, this compares how often each group is approved against
        the best-performing group. A ratio below {ADVERSE_IMPACT_RATIO} — the long-established
        four-fifths rule — means the gap is worth explaining, not that anyone discriminated. A group with
        fewer than {MIN_PER_GROUP} decided cases is reported as untestable and never scored: a rate from
        fewer than that moves on a single case, and a number like that will be quoted.
      </p>

      {rows.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No apps on this tenant decide about people, so there is nothing to test for fairness.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.appId} className="shadow-sm">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    {r.latest === null ? (
                      <ShieldWarning className="size-4 text-amber-600" weight="fill" />
                    ) : r.latest.flagged > 0 ? (
                      <ShieldWarning className="size-4 text-destructive" weight="fill" />
                    ) : r.latest.tested > 0 ? (
                      <CheckCircle className="size-4 text-primary" weight="fill" />
                    ) : (
                      <Info className="size-4 text-muted-foreground" />
                    )}
                    <span className="truncate">{r.appTitle}</span>
                  </CardTitle>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {r.latest
                      ? `Last checked ${utcStamp(r.latest.ranAt)} by ${r.latest.ranBy || 'unknown'}`
                      : 'Never checked'}
                  </p>
                </div>
                <Button size="sm" variant="outline" disabled={running === r.appId} onClick={() => void run(r.appId)}>
                  <Play className="size-3.5" />
                  {running === r.appId ? 'Running…' : 'Run check'}
                </Button>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {r.latest === null ? (
                  // Never checked is its own state and must not read like a pass.
                  <p className="text-amber-700 dark:text-amber-500">
                    No fairness check has ever been run for this app, so nothing is known about whether it
                    approves some groups less often than others.
                  </p>
                ) : (
                  <>
                    <p className={r.latest.flagged > 0 ? 'font-medium text-destructive' : 'text-foreground'}>
                      {r.latest.sentence}
                    </p>

                    {/* The flagged findings first — they are the only part that demands action. */}
                    {r.latest.findings
                      .filter((f) => f.verdict === 'investigate')
                      .map((f) => (
                        <p key={f.attribute} className="rounded-md border border-destructive/40 bg-destructive/[0.06] p-2 text-[11px] text-destructive">
                          {f.sentence}
                        </p>
                      ))}

                    {/* WHAT WOULD MAKE IT TESTABLE. Without this the reader concludes the platform cannot
                        do fairness, when in fact the decision records simply do not carry the fields. */}
                    {r.latest.remedy ? (
                      <p className="rounded-md border border-border bg-muted/40 p-2 text-[11px] text-muted-foreground">
                        {r.latest.remedy}
                      </p>
                    ) : null}

                    {r.latest.coverage.length > 0 ? (
                      <div>
                        <p className="text-[11px] font-medium text-foreground">
                          What the decisions actually record
                        </p>
                        <ul className="mt-0.5 space-y-0.5">
                          {r.latest.coverage.slice(0, 5).map((c) => (
                            <li key={c.attribute} className="text-[11px] text-muted-foreground">
                              {c.attribute} — on {c.recorded} of {c.of} decided{' '}
                              {c.of === 1 ? 'case' : 'cases'}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
