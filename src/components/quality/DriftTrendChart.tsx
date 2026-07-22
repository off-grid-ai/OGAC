import type { TrendSeries } from '@/lib/evidently-monitoring';

// PURE presentational SVG — drift share over time with a threshold line and breach highlighting.
// No client interactivity, so it renders on the server. Full-width + responsive via viewBox.

const W = 900;
const H = 280;
const PAD = { top: 20, right: 24, bottom: 40, left: 44 };

function niceMax(peak: number, threshold: number): number {
  const top = Math.max(peak, threshold, 0.1) * 1.25;
  return Math.min(1, Math.max(0.2, Number(top.toFixed(2))));
}

export function DriftTrendChart({ trend }: Readonly<{ trend: TrendSeries }>) {
  const pts = trend.points;
  if (pts.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
        No drift runs with a reported share yet — run a drift check to start the trend.
      </div>
    );
  }

  const yMax = niceMax(trend.peak, trend.threshold);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number): number =>
    PAD.left + (pts.length === 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW);
  const y = (share: number): number => PAD.top + plotH - (share / yMax) * plotH;

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.driftShare)}`).join(' ');
  const areaPath = `${linePath} L ${x(pts.length - 1)} ${PAD.top + plotH} L ${x(0)} ${PAD.top + plotH} Z`;
  const thresholdY = y(trend.threshold);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].filter((t) => t <= yMax + 0.001);
  // Show at most ~8 x labels so a long history doesn't overprint.
  const labelStep = Math.max(1, Math.ceil(pts.length / 8));

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full min-w-[520px]"
        role="img"
        aria-label="Drift share over time"
      >
        {/* y gridlines + ticks */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(t) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}

        {/* threshold line */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={thresholdY}
          y2={thresholdY}
          className="stroke-destructive"
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
        <text
          x={W - PAD.right}
          y={thresholdY - 5}
          textAnchor="end"
          className="fill-destructive text-[10px]"
        >
          threshold {Math.round(trend.threshold * 100)}%
        </text>

        {/* area + line */}
        <path d={areaPath} className="fill-primary/10" />
        <path d={linePath} className="fill-none stroke-primary" strokeWidth={2} />

        {/* points — breaches are destructive-filled + haloed */}
        {pts.map((p, i) => (
          <g key={p.bucket}>
            {p.breach ? (
              <circle cx={x(i)} cy={y(p.driftShare)} r={7} className="fill-destructive/20" />
            ) : null}
            <circle
              cx={x(i)}
              cy={y(p.driftShare)}
              r={3.5}
              className={p.breach ? 'fill-destructive' : 'fill-primary'}
            >
              <title>
                {p.bucket}: {p.driftPct}% ({p.runs} run{p.runs === 1 ? '' : 's'})
                {p.breach ? ' — breach' : ''}
              </title>
            </circle>
            {i % labelStep === 0 || i === pts.length - 1 ? (
              <text
                x={x(i)}
                y={H - PAD.bottom + 16}
                textAnchor="middle"
                className="fill-muted-foreground text-[9px]"
              >
                {p.bucket.slice(5)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}
