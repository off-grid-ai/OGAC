import { Warning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';

// ─── NeedsDataSourceBanner (save-with-gap, #128) — plain-language, no engine names ────────────────
// A first-time, non-technical user can save an app before every data source is wired. When they do,
// one or more of its steps still needs a "connected system" to read from — the run will honestly say
// it has nothing to read for that step rather than fake a result. This banner tells the user, in
// plain language, exactly what's missing and links to the Build tab where they resolve it. Rendered
// on the app's Input (run) and detail screens whenever appNeedsDataSource(spec) is true.
//
// SOLID: the "is this app missing a source" decision is the pure appNeedsDataSource rule in
// app-model.ts; this component only presents it. No OSS-engine names — "connected system" / "data
// source" only.
export function NeedsDataSourceBanner({
  appId,
  count,
}: Readonly<{
  /** The saved app's id — links to its Build tab, where the source is wired. */
  appId: string;
  /** How many steps still need a source (for the count in the copy). */
  count: number;
}>) {
  const plural = count === 1 ? 'step' : 'steps';
  return (
    <div className="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2">
        <Warning
          className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500"
          weight="fill"
        />
        <div>
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
            This app still needs a data source
          </p>
          <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300/90">
            {count} {plural} {count === 1 ? 'reads' : 'read'} from a connected system that isn&apos;t
            wired up yet. You can still run it — {count === 1 ? 'that step' : 'those steps'} will just
            have nothing to read until you point {count === 1 ? 'it' : 'them'} at your data.
          </p>
        </div>
      </div>
      <Link
        href={`/build/apps/${appId}`}
        className="inline-flex shrink-0 items-center justify-center rounded-md border border-amber-500/50 bg-background px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
      >
        Wire a data source
      </Link>
    </div>
  );
}
