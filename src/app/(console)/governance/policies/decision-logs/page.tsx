import { Suspense } from 'react';
import { PolicyAuditDecisionLog } from '@/components/governance/PolicyAuditDecisionLog';
import { requireModuleForUser } from '@/lib/module-access';
import { validateDecisionQuery } from '@/lib/opa-audit';
import { aggregateForOrg, listDecisions } from '@/lib/opa-decision-log-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Decision-log LEDGER surface — the tamper-evident, org-scoped record of every governed authz
// decision OPA (or the fallback engine) has streamed to the console sink. URL-driven filters
// (?decision / ?path / ?since) + list→detail (?open=<decisionId>). The pure query layer validates
// the params; the store reads the durable table.
export default async function DecisionLogsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ decision?: string; path?: string; since?: string; open?: string }>;
}>) {
  await requireModuleForUser('policy');
  const sp = await searchParams;
  const org = await currentOrgId();
  const query = validateDecisionQuery({ decision: sp.decision, path: sp.path, since: sp.since });
  const [decisions, aggregate] = await Promise.all([
    listDecisions(query, org),
    aggregateForOrg(org),
  ]);
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading decision log…</p>}>
      <PolicyAuditDecisionLog decisions={decisions} aggregate={aggregate} query={query} />
    </Suspense>
  );
}
