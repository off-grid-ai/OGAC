import { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface CoverageItem {
  name: string;
  /** What it does, for someone who has not met the term before. */
  what: string;
  /** 'here' = shown on this tab · 'linked' = real but not per-app · 'off' = exists, not wired here. */
  state: 'here' | 'linked' | 'off';
  /** The honest detail: the count, the reason it is not per-app, or why it is not wired. */
  detail: string;
  href?: string;
}

const TONE: Record<CoverageItem['state'], string> = {
  here: 'border-primary/40 text-primary',
  linked: 'border-border text-muted-foreground',
  off: 'border-amber-500/50 text-amber-700 dark:text-amber-500',
};

const LABEL: Record<CoverageItem['state'], string> = {
  here: 'On this tab',
  linked: 'Not per-app',
  off: 'Not set up',
};

// ─── Everything the platform checks, and where it is ─────────────────────────────────────────────────
//
// The app's Quality tab showed evals and test cases. The platform also judges real runs, watches drift,
// gates releases, auto-rolls-back, captures corrections and can alert — all of it reachable only from a
// pipeline the app's owner cannot map to their app, or from a nav section they have no reason to open.
//
// So this states the WHOLE list in one place and, for each, either points at it here or says plainly why
// it is not here. The value is the honesty: an owner should be able to see what is NOT watching their
// app as easily as what is.
export function AppQualityCoverage({ items }: Readonly<{ items: CoverageItem[] }>) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Everything that watches this app</CardTitle>
        <p className="text-xs text-muted-foreground">
          What the platform can check, and where each one stands for this app. Anything not here says
          why.
        </p>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {items.map((i) => (
          <div key={i.name} className="rounded-md border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{i.name}</p>
              <span
                className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${TONE[i.state]}`}
              >
                {LABEL[i.state]}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{i.what}</p>
            <p className="mt-1 text-xs text-foreground">{i.detail}</p>
            {i.href ? (
              <Link
                href={i.href}
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary underline"
              >
                Open it
                <ArrowSquareOut className="size-3" />
              </Link>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
