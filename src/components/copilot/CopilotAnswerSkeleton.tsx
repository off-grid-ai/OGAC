'use client';

import { Skeleton } from '@/components/ui/skeleton';

// ─── What the reader looks at while the answer is being written ───────────────────────────────────
//
// This wait is LONG and it is not going to get short: the copilot gathers live records and then calls
// a model on on-prem hardware, measured at ~15-20s end to end. What sat here was a single static line
// of grey text — "Reading the live records…" — which after about three seconds is indistinguishable
// from a surface that has hung. Nothing moved, nothing indicated progress, and the only other signal
// was a disabled button at 40% opacity.
//
// So this shows the SHAPE of the answer that is coming: a heading, a few lines of prose, and a short
// evidence list, pulsing. It sets the expectation that something substantial is arriving rather than
// a one-word reply, and because the placeholder lines are the same rhythm as the real answer, the
// swap when it lands is not a jolt.
//
// Line widths are deliberately uneven. A stack of equal-length bars reads as a table or a loading
// grid; prose has a ragged right edge, and matching that is what makes this read as "text is coming".
//
// Uses the shared `Skeleton` primitive rather than a local shimmer so it inherits the design system's
// pulse and, importantly, the reduced-motion rule that switches the animation off (styles.css disables
// `og-skeleton`'s animation under `prefers-reduced-motion`).

/** Ragged widths, so the placeholder reads as prose rather than as a grid. */
const PROSE_LINES = ['w-[92%]', 'w-[97%]', 'w-[78%]'];
const EVIDENCE_LINES = ['w-[85%]', 'w-[68%]'];

export function CopilotAnswerSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    // `aria-busy` + `role="status"` so a screen reader announces that work is in progress rather than
    // reading out a pile of empty decorative divs.
    <div className="space-y-3" role="status" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-2">
        <span className="size-1.5 animate-pulse rounded-full bg-primary" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
      </div>

      <Skeleton className="h-3 w-1/3" />
      <div className="space-y-1.5">
        {PROSE_LINES.map((w) => (
          <Skeleton key={w} className={`h-2.5 ${w}`} />
        ))}
      </div>

      <div className="space-y-1.5 border-t border-border pt-3">
        {EVIDENCE_LINES.map((w) => (
          <Skeleton key={w} className={`h-2.5 ${w}`} />
        ))}
      </div>
    </div>
  );
}
