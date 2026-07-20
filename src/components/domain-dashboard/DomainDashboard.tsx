import { ArrowRight } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DomainDashboardModel } from '@/lib/domain-dashboard';
import { cn } from '@/lib/utils';

const FACT_STATE_CLASS = {
  neutral: 'border-border',
  good: 'border-primary/40',
  attention: 'border-destructive/50',
} as const;

export function DomainDashboard({ model }: Readonly<{ model: DomainDashboardModel }>) {
  return (
    <section aria-labelledby={`${model.id}-dashboard-title`} className="w-full space-y-6">
      <div className="border-b border-border pb-5">
        <div className="max-w-4xl">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {model.title} overview
          </p>
          <h1
            id={`${model.id}-dashboard-title`}
            className="mt-2 text-2xl font-normal text-foreground"
          >
            {model.headline}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{model.summary}</p>
        </div>
      </div>

      <div aria-labelledby={`${model.id}-posture-title`}>
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 id={`${model.id}-posture-title`} className="text-sm font-normal text-foreground">
            Current posture and attention
          </h2>
          <p className="text-xs text-muted-foreground">Current console records</p>
        </div>
        {model.facts.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {model.facts.map((fact) => {
              const content = (
                <Card
                  className={cn(
                    'h-full shadow-none',
                    FACT_STATE_CLASS[fact.state ?? 'neutral'],
                    fact.href && 'transition-colors hover:border-primary/50',
                  )}
                >
                  <CardHeader className="pb-2">
                    <CardDescription className="text-xs uppercase tracking-wide">
                      {fact.label}
                    </CardDescription>
                    <CardTitle className="text-xl font-normal">{fact.value}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    {fact.description}
                  </CardContent>
                </Card>
              );
              return fact.href ? (
                <Link
                  key={fact.label}
                  href={fact.href}
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {content}
                </Link>
              ) : (
                <div key={fact.label}>{content}</div>
              );
            })}
          </div>
        ) : (
          <Card className="shadow-none">
            <CardContent className="py-5 text-sm text-muted-foreground">
              No stable live summary is available for this domain yet. Open a module below to
              inspect its current records.
            </CardContent>
          </Card>
        )}
      </div>

      <div aria-labelledby={`${model.id}-actions-title`}>
        <h2 id={`${model.id}-actions-title`} className="mb-3 text-sm font-normal text-foreground">
          Next best actions
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={model.primaryAction.href}>{model.primaryAction.label}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={model.secondaryAction.href}>{model.secondaryAction.label}</Link>
          </Button>
        </div>
      </div>

      {model.activities.length ? (
        <div aria-labelledby={`${model.id}-activity-title`}>
          <h2
            id={`${model.id}-activity-title`}
            className="mb-3 text-sm font-normal text-foreground"
          >
            Recent activity
          </h2>
          <Card className="shadow-none">
            <CardContent className="divide-y divide-border p-0">
              {model.activities.map((activity) => (
                <Link
                  key={activity.id}
                  href={activity.href}
                  className="flex min-h-14 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-foreground">{activity.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {activity.detail}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {activity.timestamp ? <time>{activity.timestamp}</time> : null}
                    <ArrowRight aria-hidden className="size-4" />
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div aria-labelledby={`${model.id}-modules-title`}>
        <div className="mb-3">
          <h2 id={`${model.id}-modules-title`} className="text-sm font-normal text-foreground">
            Inside {model.title.toLowerCase()}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{model.purpose}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {model.modules.map((module) => (
            <Link
              key={module.id}
              href={module.href}
              className="group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="h-full shadow-none transition-colors group-hover:border-primary/50">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-3 text-sm font-normal">
                    {module.label}
                    <ArrowRight
                      aria-hidden
                      className="size-4 text-muted-foreground group-hover:text-primary"
                    />
                  </CardTitle>
                  <CardDescription className="leading-relaxed">
                    {module.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
