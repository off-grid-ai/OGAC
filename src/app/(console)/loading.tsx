import { CircleNotch } from '@phosphor-icons/react/dist/ssr';

// Suspense fallback for the console subtree — shown while a page's server components fetch. Beats a
// frozen previous screen or a blank flash: the operator gets an immediate, on-brand loading state
// on every navigation.
export default function ConsoleLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex items-center gap-2.5 text-muted-foreground">
        <CircleNotch className="size-5 animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    </div>
  );
}
