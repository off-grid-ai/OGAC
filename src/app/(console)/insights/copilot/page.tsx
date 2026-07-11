import { Sparkle } from '@phosphor-icons/react/dist/ssr';
import { CopilotConsole } from '@/components/copilot/CopilotConsole';
import { deriveAnomalies } from '@/lib/copilot-gather';
import { computeFinOps } from '@/lib/finops';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Ops Copilot (M5 — "the platform runs itself"). Uses the platform's OWN AI to operate the platform:
// ask why a run failed, why cost is up, what's drifting, which pipelines are unhealthy. It gathers
// real spine context (audit, finops, drift, evals + anomaly scans) and asks the gateway to synthesise
// an answer WITH citations to the underlying records — honest: cites real data or says "no data".
export default async function CopilotPage() {
  await requireModuleForUser('observability');

  // Best-effort "at a glance" anomaly signal for the header — the copilot chat gathers full context
  // server-side per question. A finops failure just yields no anomalies (surface stays reachable).
  let anomalies: ReturnType<typeof deriveAnomalies> = [];
  try {
    anomalies = deriveAnomalies(await computeFinOps());
  } catch {
    anomalies = [];
  }

  const flagged = anomalies.flatMap((a) =>
    a.scan.anomalies.map((x) => ({ metric: a.metric, ...x })),
  );

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Sparkle className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Ops Copilot</h1>
          <p className="text-sm text-muted-foreground">
            Ask why a run failed, why cost is up, or what&apos;s drifting. The copilot reads your
            platform&apos;s own records and answers with citations — it cites real data or says it
            has none. It never guesses.
          </p>
        </div>
      </div>

      <CopilotConsole
        anomalies={flagged}
      />
    </div>
  );
}
