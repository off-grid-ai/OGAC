import { CircleNotch } from '@phosphor-icons/react/dist/ssr';
import { cn } from '@/lib/utils';

// The one spinner for the whole console — a spinning notch in the current text color. Use inside
// buttons (with a label), as a page/section loader, or anywhere an async action is in flight so the
// UI never looks dead. Size via className (defaults to 1em so it matches surrounding text).
export function Spinner({ className }: Readonly<{ className?: string }>) {
  return <CircleNotch className={cn('size-[1em] animate-spin', className)} aria-hidden />;
}

// A centered block loader for a whole panel/section while its data loads.
export function LoadingBlock({ label = 'Loading…', className }: Readonly<{ label?: string; className?: string }>) {
  return (
    <div
      className={cn('flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground', className)}
      role="status"
      aria-live="polite"
    >
      <Spinner className="size-4" />
      {label}
    </div>
  );
}
