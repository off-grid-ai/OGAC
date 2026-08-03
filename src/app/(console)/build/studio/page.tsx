import { Lightning, Sparkle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { PageFrame } from '@/components/PageFrame';
import { AppsList } from '@/components/build/AppsList';
import type { PipelineChipData } from '@/components/pipelines/PipelineChip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listAppRunsView } from '@/lib/app-runs-view-reader';
import { listApps } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { resolveConsumerChips } from '@/lib/pipeline-chip';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Studio — the ONE build front door (Builder Epic #118) ────────────────────────────────────────
// The founder's brief: "agent and studio should become one." Studio was a separate visual-canvas
// surface and Apps/Agents was another; they are now ONE roster. Studio lists every app you've built
// (an agent = a one-step app, badged as such) with a single "New app" that opens the guided builder.
// Opening an app goes to ITS OWN surface (/apps/<id>) with the five lifecycle tabs. Runtime-agent
// definitions do not render here: an authored agent IS a one-step AppSpec, not a parallel entity.
export default async function StudioPage() {
  await requireModuleForUser('studio');
  const orgId = await currentOrgId();
  const apps = await listApps(orgId).catch(() => []);

  // Resolve each app's "Runs on: <pipeline>" chip in ONE batch (org governance + name map read once).
  const appChipList = await resolveConsumerChips(
    apps.map((a) => a.pipelineId ?? null),
    orgId,
  );
  const appChips: Record<string, PipelineChipData> = {};
  apps.forEach((a, i) => {
    appChips[a.id] = appChipList[i];
  });

  // Cases paused for a person, per app — counted in ONE read for the whole grid rather than per card.
  // Best-effort: a failed count leaves the cards without the badge, which is honest, rather than
  // showing zero waiting and telling a person nothing needs them.
  const runs = await listAppRunsView(undefined, orgId, 300).catch(() => []);
  const waiting: Record<string, number> = {};
  for (const r of runs) {
    if (String(r.status) === 'awaiting_human') waiting[r.appId] = (waiting[r.appId] ?? 0) + 1;
  }


  return (
    <PageFrame>
      <div className="w-full space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Sparkle className="size-5 text-primary" />
              Apps
            </h1>
            {/* WAS SIX PLATFORM TERMS IN ONE SENTENCE — "policy gate, guardrails, model routing,
                retrieval grounding, and tamper-evident provenance" — at the top of the surface for
                people who explicitly do not want to know the platform. What they need to know is what
                an app is and that the rules are already applied; not which components apply them. */}
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              An app does a piece of your work — describe it in plain language and it gets built.
              Your company&apos;s rules about data, safety and who approves what are already applied
              to every one, so you do not set any of that up. Open an app to run it, see what is
              waiting, and check how it is doing.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Templates are contextual to Apps (a template IS an app, published for another team to
              clone), so they are deliberately not a sidebar row. This is the way in — without it the
              surface would be orphaned. */}
            <Button asChild variant="outline">
              <Link href="/solutions/templates">Start from a template</Link>
            </Button>
            <Button asChild>
              <Link href="/solutions/apps/new?mode=chat">
                <Lightning weight="fill" className="size-4" />
                New app
              </Link>
            </Button>
          </div>
        </div>

        {/* Stat band */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {/* The count an owner actually acts on leads. The band opened with taxonomy counts
              (single-step vs multi-step) which tell them nothing about their day. */}
          <Stat
            label="Waiting for a person"
            value={Object.values(waiting).reduce((n, v) => n + v, 0)}
          />
          <Stat label="Apps" value={apps.length} />
          {/* Taxonomy an owner cannot act on ("single-step agents" / "multi-step workflows") replaced
              by the two states they can: is it live, and is it a draft. */}
          <Stat label="Live" value={apps.filter((app) => app.published).length} />
          <Stat label="Drafts" value={apps.filter((app) => !app.published).length} />

        </div>

        {/* Apps — the unified builder's output. A single-step app IS an agent; a multi-step app is a
          workflow. One "New app" front door opens the guided builder for both. */}
        <div>
          <h2 className="mb-2 text-sm font-medium text-foreground">Your apps</h2>
          <AppsList apps={apps} chips={appChips} waiting={waiting} />
        </div>
      </div>
    </PageFrame>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: number | string }>) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-3xl font-semibold text-foreground">{value}</CardContent>
    </Card>
  );
}
