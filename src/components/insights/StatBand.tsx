import type { StatTile } from '@/lib/insights-stats';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Shared value-forward stat band for the Insights surfaces. Renders a small array of pre-shaped
// StatTiles (built by the pure builders in src/lib/insights-stats.ts) as a responsive grid that
// fills wide desktops — 2-up on narrow, 4-up from lg. Pure render, no logic; the tone→class map
// is the only presentational decision and it stays inside the accent/semantic token system
// (emerald for good, amber for warn, destructive for bad) — no ad-hoc colors.

const TONE_CLASS: Record<StatTile['tone'], string> = {
  default: 'text-foreground',
  good: 'text-primary',
  warn: 'text-amber-600',
  bad: 'text-destructive',
};

export function StatBand({ stats }: { stats: StatTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map((s) => (
        <Card key={s.label} className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
              {s.label}
            </CardTitle>
          </CardHeader>
          <CardContent
            className={cn('text-2xl font-semibold capitalize tabular-nums', TONE_CLASS[s.tone])}
          >
            {s.value}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
