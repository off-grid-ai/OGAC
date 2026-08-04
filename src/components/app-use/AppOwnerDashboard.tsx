import type { DayCount, OutcomeMix, TimeUse } from '@/lib/app-owner-dashboard';
import { describeDurationMs } from '@/lib/run-time-split';

// ─── "Is this app working, and where is it going wrong?" ─────────────────────────────────────────────
//
// Presentation only — every judgement was made by the pure rules in app-owner-dashboard.ts. This decides
// nothing; it renders the sentences it is handed.
//
// Deliberately no chart library. Volume is a row of bars made of divs: it reads correctly at a glance,
// carries no runtime dependency that can fail to hydrate, and matches the terminal aesthetic. A chart
// package earns its place when the shape is genuinely hard to draw, and thirty daily counts are not.

export interface OwnerDashboardData {
  volume: DayCount[];
  trend: { direction: 'up' | 'down' | 'flat'; sentence: string } | null;
  mix: OutcomeMix;
  time: TimeUse;
  /** The plain-language quality sentence, when anything has been scored. Null when nothing has. */
  qualitySentence: string | null;
}

export function AppOwnerDashboard({ data }: Readonly<{ data: OwnerDashboardData }>) {
  const { volume, trend, mix, time, qualitySentence } = data;
  const peak = Math.max(1, ...volume.map((d) => d.count));
  const total = volume.reduce((n, d) => n + d.count, 0);

  return (
    // Two columns from lg, so a wide screen carries the whole picture without scrolling. The volume band
    // spans both — a thirty-day series squeezed into half a screen loses the shape that makes it useful.
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <section className="rounded-lg border border-border p-4 lg:col-span-2 xl:col-span-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground">How much it has handled</h3>
          <p className="text-xs text-muted-foreground">
            {total} {total === 1 ? 'case' : 'cases'} in the last {volume.length} days
          </p>
        </div>
        {/* Every day is plotted, including the empty ones: dropping them would close the gaps up and make
            an app that ran twice look continuous. */}
        <div className="mt-3 flex h-24 items-end gap-px" role="img" aria-label="Cases per day">
          {volume.map((d) => (
            <div
              key={d.day}
              title={`${d.day} — ${d.count} ${d.count === 1 ? 'case' : 'cases'}`}
              className={`min-w-0 flex-1 rounded-t-sm ${d.count > 0 ? 'bg-primary/70' : 'bg-border'}`}
              style={{ height: d.count > 0 ? `${Math.max(6, (d.count / peak) * 100)}%` : '2px' }}
            />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>{volume[0]?.day}</span>
          <span>{volume[volume.length - 1]?.day}</span>
        </div>
        {trend ? <p className="mt-2 text-xs text-muted-foreground">{trend.sentence}</p> : null}
      </section>

      <section className="rounded-lg border border-border p-4">
        <h3 className="text-sm font-medium text-foreground">What it decided</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{mix.sentence}</p>
        <dl className="mt-3 space-y-1.5">
          {[
            { label: 'Completed', n: mix.completed },
            // Named as a decision, never as a breakdown.
            { label: 'Declined by a person', n: mix.declined },
            { label: 'Waiting for a person', n: mix.waiting },
            { label: 'Still running', n: mix.inFlight },
            { label: 'Could not finish', n: mix.failed, attention: true },
          ]
            .filter((r) => r.n > 0)
            .map((r) => (
              <div key={r.label} className="flex items-center gap-3">
                <dt className="w-44 shrink-0 text-xs text-muted-foreground">{r.label}</dt>
                <dd className="flex min-w-0 flex-1 items-center gap-2">
                  <div
                    className={`h-1.5 rounded-full ${r.attention ? 'bg-destructive/70' : 'bg-primary/60'}`}
                    style={{ width: `${Math.max(2, (r.n / Math.max(1, mix.total)) * 100)}%` }}
                  />
                  <span className="font-mono text-xs tabular-nums text-foreground">{r.n}</span>
                </dd>
              </div>
            ))}
        </dl>
      </section>

      <section className="rounded-lg border border-border p-4">
        <h3 className="text-sm font-medium text-foreground">Where the time goes</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{time.sentence}</p>
        {time.waitingShare !== null ? (
          <>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-border">
              <div className="bg-primary/70" style={{ width: `${100 - time.waitingShare}%` }} />
              <div className="bg-amber-500/70" style={{ width: `${time.waitingShare}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="mr-1.5 inline-block size-2 rounded-sm bg-primary/70" />
                App working — {describeDurationMs(time.workingMs)}
              </span>
              <span>
                <span className="mr-1.5 inline-block size-2 rounded-sm bg-amber-500/70" />
                Waiting for a person — {describeDurationMs(time.waitingMs)}
              </span>
            </div>
          </>
        ) : null}
      </section>

      {/* Its own card, not a footnote under timing: "are its answers right?" is a different question from
          "where does the time go?", and burying it under a progress bar reads as a caption. */}
      {qualitySentence ? (
        <section className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-foreground">Whether its answers hold up</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{qualitySentence}</p>
        </section>
      ) : null}
    </div>
  );
}
