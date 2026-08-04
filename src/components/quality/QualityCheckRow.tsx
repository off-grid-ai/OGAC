'use client';

import { CheckCircle, XCircle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  agoText,
  checkDescription,
  passingRule,
  trendOf,
  type CheckRunSummary,
} from '@/lib/quality-plain';

export interface QualityCheck {
  id: string;
  name: string;
  metric: string;
  threshold: number;
  direction: string;
}

/** The in-session result of clicking Run, as both panels already model it. */
export interface JustRan {
  run?: { score: number; total: number; passed: number };
  computedBy?: string;
}

// ─── One quality check, as its owner reads it ────────────────────────────────────────────────────────
//
// This row was duplicated across the app Quality tab and the pipeline Quality panel, with the same two
// defects in both copies — the engine's metric ids on show, and no last result. Fixing one would have
// left the other wrong, which is exactly what the DRY rule is for, so it lives here once.
export function QualityCheckRow({
  check,
  lastRun,
  history,
  justRan,
  running,
  now,
  onRun,
}: Readonly<{
  check: QualityCheck;
  /** The most recent recorded run, read on the server. */
  lastRun?: CheckRunSummary;
  /** Every recorded run, oldest first — the direction, not just the latest point. */
  history?: CheckRunSummary[];
  /** The result of pressing Run in this session, which supersedes the stored one. */
  justRan?: JustRan;
  running: boolean;
  now: Date;
  onRun: () => void;
}>) {
  const live = justRan?.run;
  const pct = live && live.total > 0 ? Math.round((live.passed / live.total) * 100) : null;

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{check.name}</div>
        {/* PLAIN LANGUAGE. This line read "faithfulness · quality checks · threshold 0.8 ·
            higher-better" — the underlying engine's metric ids, which we never surface, plus a
            threshold the reader had to interpret. The good title above was undone by it. */}
        <div className="text-[11px] text-muted-foreground">
          {checkDescription(check.metric) ?? 'Checks this app against a quality bar.'}{' '}
          {passingRule(check.threshold, check.direction)}
        </div>
        {/* WHEN IT LAST RAN. A Run button with no last result cannot answer whether the app is working
            now — the only question this surface exists for. Never-run says so plainly. */}
        <div className="text-[11px] text-muted-foreground/80">
          {lastRun
            ? `Last run ${agoText(lastRun.startedAt, now)} · ${lastRun.passed} of ${lastRun.total} cases passed`
            : 'Never run — this check has not verified anything yet.'}
        </div>
        {/* IS IT GETTING BETTER OR WORSE. The tab could say what happened last time and nothing about
            direction — and direction is what tells you whether a change helped. The runs were already
            recorded; nothing plotted them. */}
        {(() => {
          if (!history || history.length === 0) return null;
          const t = trendOf(history);
          if (t.direction === 'too-few') {
            return <div className="text-[11px] text-muted-foreground/70">{t.sentence}</div>;
          }
          return (
            <div
              className={`text-[11px] ${
                t.direction === 'declining'
                  ? 'font-medium text-destructive'
                  : t.direction === 'improving'
                    ? 'text-primary'
                    : 'text-muted-foreground/80'
              }`}
            >
              {t.sentence}
            </div>
          );
        })()}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {pct !== null ? (
          <span className="flex items-center gap-1 text-xs">
            {pct >= Math.round(check.threshold * 100) ? (
              <CheckCircle className="size-4 text-primary" weight="fill" />
            ) : (
              <XCircle className="size-4 text-destructive" weight="fill" />
            )}
            {pct}%
          </span>
        ) : null}
        <Button size="sm" variant="outline" onClick={onRun} disabled={running}>
          {running ? (
            <>
              <Spinner /> Running…
            </>
          ) : (
            'Run'
          )}
        </Button>
      </div>
    </div>
  );
}
