import { Eye } from '@phosphor-icons/react/dist/ssr';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Provit — visual QA — is a coming-soon module in the console. It maps a repo into modules, runs
// every behavior end to end, and judges the recording with vision to catch UI regressions before
// they ship. The surface is intentionally a placeholder until the integration is live; access
// control still applies so the nav entry stays consistent with the module registry.
export default async function ProvitPage() {
  await requireModuleForUser('provit');

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Eye className="size-4" />
        </div>
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            Provit
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Coming soon
            </span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Visual QA that catches regressions before they ship.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-8">
        <h2 className="text-base font-semibold text-foreground">Ship UI changes without breaking what worked</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Provit maps your app into its real modules, drives every behavior end to end, and judges
          the recording with vision — so a broken screen is caught in review, not by a user. It runs
          on your own gateway, under the same auth, budgets, and audit as the rest of the console.
        </p>
        <ul className="mt-5 grid max-w-3xl gap-3 sm:grid-cols-3">
          {[
            ['Map', 'Turn a repo into its real modules and user journeys automatically.'],
            ['Run', 'Exercise every behavior end to end, recorded for review.'],
            ['Judge', 'A vision model scores each run and flags what regressed, and where.'],
          ].map(([title, body]) => (
            <li key={title} className="rounded-lg border border-border p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">{title}</div>
              <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-muted-foreground">
          Landing here in a future release. Want early access? Reach us at{' '}
          <a href="mailto:mac@getoffgridai.co" className="text-primary hover:underline">
            mac@getoffgridai.co
          </a>
          .
        </p>
      </div>
    </div>
  );
}
