// ─── SolutionsFlow — the Solutions hub, which now explains itself ────────────────────────────────────
//
// Replaces a generic three-stat dashboard that showed Apps / Blueprints / Active deployments as
// unrelated numbers. The counts were accurate and told an operator nothing: not what a blueprint is,
// not why "Deployed" was zero, not what to do next. This renders the same three things AS A CHAIN, in
// order, each stating what it is, and — when a stage cannot proceed — the precondition it is waiting on.
//
// All decisions come from the pure buildSolutionsFlow rule; this file only lays them out.

import { ArrowRight, Info, Warning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { SolutionStage, SolutionsFlow as Flow } from '@/lib/solutions-flow';
import { cn } from '@/lib/utils';

function StageCard({ stage, index }: Readonly<{ stage: SolutionStage; index: number }>) {
  const isBlocked = stage.state === 'blocked';
  return (
    <Card
      className={cn(
        'flex h-full min-w-0 flex-col shadow-none',
        isBlocked ? 'border-border' : 'border-primary/30',
      )}
    >
      <CardContent className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
            {String(index + 1).padStart(2, '0')} · {stage.title}
          </p>
          <span
            className={cn(
              'font-mono text-2xl font-semibold tabular-nums',
              stage.count === 0 ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {stage.count}
          </span>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">{stage.whatItIs}</p>

        {stage.blockedReason ? (
          <p className="flex gap-2 rounded border border-border bg-muted/40 p-3 text-xs leading-relaxed text-foreground">
            {isBlocked ? (
              <Warning className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span>{stage.blockedReason}</span>
          </p>
        ) : null}

        <div className="mt-auto pt-2">
          <Button asChild variant={isBlocked ? 'outline' : 'default'} size="sm">
            <Link href={stage.action.href}>
              {stage.action.label}
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function SolutionsFlow({ flow }: Readonly<{ flow: Flow }>) {
  return (
    <div className="w-full space-y-6">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
          Blueprint · App · Deployment
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Solutions</h1>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted-foreground">
          A <span className="text-foreground">blueprint</span> is the contract — the outcome promised
          and what it requires. An <span className="text-foreground">app</span> is the workflow that
          actually runs it. Binding the two is a{' '}
          <span className="text-foreground">deployment</span>, which is what turns a promised outcome
          into measured evidence.
        </p>
        <p className="mt-3 text-sm text-foreground">{flow.headline}</p>
      </header>

      {/* The chain. Arrows only render from md up, where the cards sit side by side. */}
      <div className="grid items-stretch gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        {flow.stages.map((stage, i) => (
          <div key={stage.id} className="contents">
            <StageCard stage={stage} index={i} />
            {i < flow.stages.length - 1 ? (
              <div className="hidden items-center justify-center md:flex" aria-hidden>
                <ArrowRight className="size-5 text-muted-foreground" />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/* Templates are deliberately OUTSIDE the chain: they are a shortcut for creating an app, not a
        step towards a deployment. Listing them as a fourth sibling is what made the section
        ambiguous in the first place. */}
      <Card className="shadow-none">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Shortcut
            </p>
            <p className="mt-1 text-sm text-foreground">
              {flow.templateCount > 0
                ? `${flow.templateCount} ${flow.templateCount === 1 ? 'app is' : 'apps are'} published as templates`
                : 'No apps are published as templates yet'}
            </p>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              A template is an app one team published so another can clone it as a starting point. It
              carries no outcome contract, so it is a faster way to create an app, not a step towards
              a deployment.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/solutions/templates">
              Templates
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
