import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  regressionHeadline,
  subjectDisplayName,
  type QualityRegressionView,
  type RegressionStatus,
} from '@/lib/qa/quality-regression';

// Presentation only — every judgement already happened in the pure rule upstream. This decides
// nothing about whether quality regressed; it only renders the verdict it is handed.

const STATUS_CLASS: Record<RegressionStatus, string> = {
  ok: 'bg-primary/10 text-primary',
  regressed: 'bg-destructive/10 text-destructive',
  'insufficient-data': 'bg-muted text-foreground',
};

const STATUS_LABEL: Record<RegressionStatus, string> = {
  ok: 'holding',
  regressed: 'getting worse',
  'insufficient-data': 'not enough data',
};

const pct = (n: number): string => `${Math.round(n * 100)}%`;

export function AnswerQualityCard({ view }: Readonly<{ view: QualityRegressionView }>) {
  const { subjects, measured, retained, names } = view;
  const headline = regressionHeadline(subjects);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Answer quality</CardTitle>
        <CardDescription className="text-xs">
          Drift evidence above watches the data going in. This watches what your people actually
          read: every governed answer is scored, and each app is compared against its own earlier
          runs, so a slide shows up here before your users start noticing it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!measured ? (
          // Honest empty state. Nothing scored yet is NOT the same as everything being fine.
          <p className="py-8 text-center text-xs text-muted-foreground">
            No answers have been scored yet, so quality is unmeasured rather than confirmed healthy.
            Scoring starts on its own as governed runs go through.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className={STATUS_CLASS[headline.tone]}>
                {headline.label}
              </Badge>
              <span>
                {retained} scored {retained === 1 ? 'answer' : 'answers'} across {subjects.length}{' '}
                {subjects.length === 1 ? 'app' : 'apps'}
              </span>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>App or agent</TableHead>
                    <TableHead className="text-right">Recent</TableHead>
                    <TableHead className="text-right">Earlier</TableHead>
                    <TableHead className="text-right">Runs</TableHead>
                    <TableHead className="text-right">Verdict</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subjects.map((s) => (
                    <TableRow key={s.subjectId}>
                      <TableCell className="font-medium">
                        {/* The app's own name. This printed the raw `app:bhapp_reimb` key. */}
                        {(() => {
                          const d = subjectDisplayName(s.subjectId, names ?? {});
                          return d.unresolved && d.kind ? (
                            <span title={s.subjectId}>
                              {d.name}
                              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                                (no longer exists)
                              </span>
                            </span>
                          ) : (
                            <span title={s.subjectId}>{d.name}</span>
                          );
                        })()}
                        {s.status === 'regressed' ? (
                          // TableCell is whitespace-nowrap; without this override the sentence forces
                          // the column to its full width and pushes the score columns off-screen.
                          <span className="block max-w-[28rem] whitespace-normal text-xs font-normal text-muted-foreground">
                            {s.detail}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {pct(s.recentQuality)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {s.baselineCount === 0 ? '—' : pct(s.baselineQuality)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {s.recentCount}/{s.baselineCount}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className={STATUS_CLASS[s.status]}>
                          {STATUS_LABEL[s.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
