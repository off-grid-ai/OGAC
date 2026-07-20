import { AddDomainButton } from '@/components/data-domains/AddDomainButton';
import { DomainCard } from '@/components/data-domains/DomainCard';
import { SuggestStartersButton } from '@/components/data-domains/SuggestStartersButton';
import { TestResolveBox } from '@/components/data-domains/TestResolveBox';
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { proposeStarterDomains } from '@/lib/data-domains-seed';
import { listDomains } from '@/lib/data-domains-store';
import { requireModuleForUser } from '@/lib/module-access';
import { listConnectors } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// Connector rule engine — the org DECLARES where its data lives ("customer data → Salesforce",
// "transactions → Postgres"). Each rule = a semantic label + aliases bound to a connector +
// resource. The NL builder and the retrieval router then route a phrase to the right system BY
// RULE (deterministic, no-guess). This surface is the full CRUD over those rules, plus a
// "test resolve" box so the operator can confirm a phrase binds where they expect.
export default async function DataDomainsPage() {
  await requireModuleForUser('data-domains');
  const org = await currentOrgId();
  const [domains, connectors] = await Promise.all([listDomains(org), listConnectors(org)]);

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
        {domains.map((d) => (
          <DomainCard
            key={d.id}
            domain={{
              id: d.id,
              label: d.label,
              aliases: d.aliases,
              connectorId: d.connectorId,
              connectorName: connectorName(d.connectorId),
              resource: d.resource,
            }}
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
