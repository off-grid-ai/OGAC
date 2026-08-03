import Link from 'next/link';
import { AddDomainButton } from '@/components/data-domains/AddDomainButton';
import { DomainCard } from '@/components/data-domains/DomainCard';
import { SuggestStartersButton } from '@/components/data-domains/SuggestStartersButton';
import { TestResolveBox } from '@/components/data-domains/TestResolveBox';
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { listApps } from '@/lib/apps-store';
import { domainUsage } from '@/lib/data-domain-usage';
import { proposeStarterDomains } from '@/lib/data-domains-seed';
import { listDomains } from '@/lib/data-domains-store';
import { requireModuleForUser } from '@/lib/module-access';
import { listPipelines } from '@/lib/pipelines';
import { allowlistReferencesTokens, domainMatchTokens } from '@/lib/pipelines-policy';
import { listConnectors } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// Connector rule engine — the org DECLARES where its data lives ("customer data → Salesforce",
// "transactions → Postgres"). Each rule = a semantic label + aliases bound to a connector +
// resource. The NL builder and the retrieval router then route a phrase to the right system BY
// RULE (deterministic, no-guess). This surface is the full CRUD over those rules, plus a
// "test resolve" box so the operator can confirm a phrase binds where they expect.
export default async function DataDomainsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ basis?: string; grade?: string }> }>) {
  await requireModuleForUser('data-domains');
  const org = await currentOrgId();
  // URL-DRIVEN FILTERS. The governance overview says "8 of 23 sources record no lawful basis" — that
  // number was a dead end, because finding the 8 among 23 near-identical cards meant reading every
  // one. ?basis=missing / ?grade=unclassified is the way in, and it is a route so it is shareable.
  const { basis, grade } = await searchParams;
  // Apps + pipelines are read ONCE for the whole grid (not per card) and the reverse edge is computed
  // in pure code — the page shows which rules the org actually runs on, which is the only way to tell
  // two similar-looking rules apart, and what a Delete would break.
  const [domains, connectors, apps, pipelines] = await Promise.all([
    listDomains(org),
    listConnectors(org),
    listApps(org).catch(() => []),
    listPipelines(org).catch(() => []),
  ]);
  const usageFor = (d: { id: string; label: string; aliases: string[] }) => {
    const tokens = domainMatchTokens(d);
    return domainUsage(
      d,
      apps.map((a) => ({ id: a.id, title: a.title, steps: a.steps })),
      pipelines
        .filter((p) => allowlistReferencesTokens(p.dataAllowlist, tokens))
        .map((p) => ({ id: p.id, name: p.name })),
    );
  };

  const shown = domains.filter((d) => {
    if (basis === 'missing' && d.lawfulBasis) return false;
    if (grade === 'unclassified' && d.classification) return false;
    return true;
  });
  const filtered = shown.length !== domains.length;

  const connectorOptions = connectors.map((c) => ({ id: c.id, name: c.name, type: c.type }));
  const connectorName = (id: string) => connectors.find((c) => c.id === id)?.name ?? id;
  const proposals = proposeStarterDomains(
    connectorOptions,
    domains.map((d) => d.label),
  );

  let domainsBody: ReactNode;
  if (connectors.length === 0) {
    domainsBody = (
      <Card className="shadow-sm">
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No connectors yet. Add a connector under Integrations first — a data domain must bind to
            a real connector.
          </p>
        </CardContent>
      </Card>
    );
  } else if (shown.length === 0 && filtered) {
    domainsBody = (
      <Card className="shadow-sm">
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nothing matches that filter — every rule here records what this view was looking for.
          </p>
        </CardContent>
      </Card>
    );
  } else if (domains.length === 0) {
    domainsBody = (
      <Card className="shadow-sm">
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No data domains declared yet. Add a rule, or use <b>Suggest starter rules</b> to seed
            the common ones from your connectors.
          </p>
        </CardContent>
      </Card>
    );
  } else {
    domainsBody = (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((d) => (
          <DomainCard
            key={d.id}
            domain={{
              id: d.id,
              label: d.label,
              aliases: d.aliases,
              connectorId: d.connectorId,
              connectorName: connectorName(d.connectorId),
              resource: d.resource,
              classification: d.classification ?? null,
              lawfulBasis: d.lawfulBasis ?? null,
              purpose: d.purpose ?? null,
            }}
            usage={usageFor(d)}
            connectors={connectorOptions}
          />
        ))}
      </div>
    );
  }

  return (
    <PageFrame>
      {
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Data domains</h2>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                Declare where each kind of data lives — &quot;customer data → Salesforce&quot;,
                &quot;transactions → Postgres&quot;. Each rule binds a semantic label (plus aliases)
                to a connector and a resource. The builder and retrieval router route a phrase to
                the right system <b>by rule</b> — deterministic, never a guess.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {proposals.length > 0 ? <SuggestStartersButton proposals={proposals} /> : null}
              <AddDomainButton connectors={connectorOptions} />
            </div>
          </div>

          {/* WHAT THIS VIEW IS SHOWING. A silently-filtered list that looks like the whole list is how
              an operator concludes they have 8 data sources instead of 23. */}
          {filtered ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Showing the <b>{shown.length}</b> of {domains.length} rule
                {domains.length === 1 ? '' : 's'} that{' '}
                {basis === 'missing'
                  ? 'do not record why we are permitted to process them'
                  : 'nobody has classified'}
                .
              </p>
              <Link
                href="/data/domains"
                className="text-xs font-medium text-foreground underline hover:text-primary"
              >
                Show all {domains.length}
              </Link>
            </div>
          ) : null}

          <TestResolveBox
            domains={domains.map((d) => ({
              id: d.id,
              label: d.label,
              aliases: d.aliases,
              connectorId: d.connectorId,
              resource: d.resource,
              orgId: d.orgId,
            }))}
            connectorName={Object.fromEntries(connectors.map((c) => [c.id, c.name]))}
          />

          {domainsBody}
        </div>
      }
    </PageFrame>
  );
}
