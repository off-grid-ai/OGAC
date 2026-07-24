import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { GuardrailCatalog } from '@/components/guardrails/GuardrailCatalog';
import { GuardrailRules } from '@/components/guardrails/GuardrailRules';
import { PresidioAnonymizers } from '@/components/guardrails/PresidioAnonymizers';
import { PresidioRecognizers } from '@/components/guardrails/PresidioRecognizers';
import { PresidioThresholds } from '@/components/guardrails/PresidioThresholds';
import { PageFrame } from '@/components/PageFrame';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { getPii } from '@/lib/adapters/registry';
import { resolvePresidioImageRedactorConfig } from '@/lib/adapters/presidio-image-redaction';
import { guardrailsDestination, type GuardrailsDestination } from '@/lib/guardrails-destinations';
import { listGuardrailRules } from '@/lib/guardrails-rules';
import { readGuardrailsView, type GuardrailsView } from '@/lib/guardrails-view';
import { requireModuleForUser } from '@/lib/module-access';
import { listPipelines } from '@/lib/pipelines';
import { getAnonymizerPolicy } from '@/lib/presidio-anonymizer-policy-store';
import { DEFAULT_ANONYMIZER_POLICY } from '@/lib/presidio-anonymizers';
import { getThresholds, listRecognizers } from '@/lib/presidio-recognizers';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function GuardrailsDestinationPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ destination: string }>;
  searchParams: Promise<SearchParams>;
}>) {
  await requireModuleForUser('guardrails');
  const { destination: rawDestination } = await params;
  const destination = guardrailsDestination(rawDestination);
  if (!destination) notFound();

  const content = await destinationContent(destination, await searchParams);
  return <DestinationFrame destination={destination}>{content}</DestinationFrame>;
}

async function destinationContent(
  destination: GuardrailsDestination,
  searchParams: SearchParams,
): Promise<ReactNode> {
  if (destination.id === 'overview') {
    return <OverviewContent view={await readGuardrailsView()} />;
  }

  if (destination.id === 'test') {
    const rawProbe = searchParams.q;
    const probe = typeof rawProbe === 'string' ? rawProbe : '';
    const view = probe
      ? await readGuardrailsView(await getPii().scan(probe), probe)
      : await readGuardrailsView();
    return <TestContent probe={probe} view={view} />;
  }

  const orgId = await currentOrgId();
  if (destination.id === 'masking') {
    const [rules, anonymizerPolicy] = await Promise.all([
      listGuardrailRules(orgId).catch(() => []),
      getAnonymizerPolicy(orgId).catch(() => DEFAULT_ANONYMIZER_POLICY),
    ]);
    // Real availability: the image-redactor is usable when its URL + token are configured (the same
    // config the adapter resolves), not a hardcoded flag.
    const imgCfg = resolvePresidioImageRedactorConfig();
    const imageRedactionAvailable = Boolean(imgCfg.url && imgCfg.token);
    return (
      <div className="space-y-6">
        <ManagementCard title="Masking rules">
          <GuardrailRules rules={rules} />
        </ManagementCard>
        <ManagementCard title="Anonymizer operators — how each entity is masked">
          <PresidioAnonymizers
            policy={anonymizerPolicy}
            imageRedactionAvailable={imageRedactionAvailable}
          />
        </ManagementCard>
      </div>
    );
  }

  if (destination.id === 'recognizers') {
    const recognizers = await listRecognizers(orgId).catch(() => []);
    return (
      <ManagementCard title="Data-movement recognizers & deny lists">
        <PresidioRecognizers recognizers={recognizers} />
      </ManagementCard>
    );
  }

  if (destination.id === 'thresholds') {
    const thresholds = await getThresholds(orgId).catch(() => ({ global: 0, perEntity: {} }));
    return (
      <ManagementCard title="Confidence thresholds">
        <PresidioThresholds thresholds={thresholds} />
      </ManagementCard>
    );
  }

  const [view, rules, pipelines] = await Promise.all([
    readGuardrailsView(),
    listGuardrailRules(orgId).catch(() => []),
    listPipelines(orgId).catch(() => []),
  ]);
  const llmGuardReady = view.engine === 'llm-guard' && view.configured && view.reachable;
  return (
    <ManagementCard title="Standard protections">
      <GuardrailCatalog
        engineStatus={{ guardrailsAiReady: false, llmGuardReady }}
        enabledRules={rules.map((rule) => ({ matcher: rule.matcher, pattern: rule.pattern }))}
        pipelines={pipelines.map((pipeline) => ({
          id: pipeline.id,
          name: pipeline.name,
          guardrailOverlay: pipeline.guardrailOverlay,
        }))}
      />
    </ManagementCard>
  );
}

function DestinationFrame({
  destination,
  children,
}: Readonly<{ destination: GuardrailsDestination; children: ReactNode }>) {
  return (
    <PageFrame>
      <section
        aria-labelledby={`guardrails-heading-${destination.id}`}
        className="w-full space-y-6"
      >
        <header className="space-y-1.5 border-b border-border/80 pb-4">
          <h2 id={`guardrails-heading-${destination.id}`} className="text-base font-medium">
            {destination.label}
          </h2>
          <p className="max-w-3xl text-xs text-muted-foreground">{destination.description}</p>
        </header>
        <div data-og-context-content>{children}</div>
      </section>
    </PageFrame>
  );
}

function ManagementCard({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function OverviewContent({ view }: Readonly<{ view: GuardrailsView }>) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            PII detection
            <Badge variant={view.reachable ? 'default' : 'destructive'}>
              {view.reachable ? 'reachable' : 'unreachable'}
            </Badge>
            {view.engine === 'presidio' && !view.configured ? (
              <Badge variant="secondary">not configured</Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>
            Detection:{' '}
            <span className="text-foreground">
              {view.engine === 'presidio'
                ? 'Entity-grade PII detection'
                : 'Built-in pattern detection'}
            </span>
          </p>
          {view.engine === 'presidio' ? (
            <p className="text-xs">
              Falls back to the always-on pattern detector when the detection service is down.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Supported entity types</CardTitle>
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            {view.entityTypes.length}
          </Badge>
        </CardHeader>
        <CardContent>
          {view.entityTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No entity types reported yet — the always-on baseline pattern protection still
              applies.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {view.entityTypes.map((entityType) => (
                <Badge
                  key={entityType}
                  variant="outline"
                  className="font-mono text-xs text-muted-foreground"
                >
                  {entityType}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TestContent({ probe, view }: Readonly<{ probe: string; view: GuardrailsView }>) {
  return (
    <ManagementCard title="Test a string">
      <div className="space-y-3 text-sm">
        <form method="GET" className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="text"
            name="q"
            defaultValue={probe}
            placeholder="e.g. email me at jane@acme.com or call +1 202 555 0143"
            className="flex-1 font-mono"
          />
          <Button type="submit">Scan</Button>
        </form>
        <p className="text-xs text-muted-foreground">
          Runs the live active engine. Custom recognizers, deny lists, and thresholds apply exactly
          as they do to a real request. Nothing is stored.
        </p>
        {view.demo ? (
          <div className="space-y-1 rounded-md border border-border p-3">
            <p>
              Result:{' '}
              <Badge variant={view.demo.hits ? 'destructive' : 'default'}>
                {view.demo.hits ? 'PII detected' : 'no PII'}
              </Badge>{' '}
              <span className="text-muted-foreground">
                via{' '}
                {view.demo.engine === 'presidio' ? 'entity-grade detection' : 'pattern detector'}
              </span>
            </p>
            {view.demo.entities.length ? (
              <p className="font-mono text-xs text-foreground">{view.demo.entities.join(', ')}</p>
            ) : null}
            {view.demo.redacted ? (
              <p className="font-mono text-xs text-muted-foreground">{view.demo.redacted}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </ManagementCard>
  );
}
