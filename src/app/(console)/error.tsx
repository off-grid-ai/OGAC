'use client';

import { ArrowClockwise, House, Warning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

// Error boundary for the whole console subtree. Without this, a server component that throws (a
// service adapter that errors instead of degrading, a bad response shape) takes down the entire
// screen with Next's default overlay. This keeps the operator in a usable state: a clear message,
// a retry that re-runs the failed render, and a way home — never a blank page.
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface for server logs / observability; the digest correlates with the server-side stack.
    console.error('[console] render error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <Warning className="size-6" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-foreground">Something went wrong here</h1>
          <p className="text-sm text-muted-foreground">
            This screen hit an error while loading. The rest of the console is unaffected — retry,
            or head back to the overview.
          </p>
          {error.digest ? (
            <p className="pt-1 font-mono text-[11px] text-muted-foreground/60">
              ref: {error.digest}
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-center gap-2">
          <Button onClick={reset} className="gap-1.5">
            <ArrowClockwise className="size-4" />
            Try again
          </Button>
          <Button asChild variant="outline" className="gap-1.5">
            <Link href="/overview">
              <House className="size-4" />
              Overview
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
