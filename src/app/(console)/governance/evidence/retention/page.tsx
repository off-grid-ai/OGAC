import { PageFrame } from '@/components/PageFrame';
import { RetentionPanel } from '@/components/data/RetentionPanel';
import { requireModuleForUser } from '@/lib/module-access';
import { listRetentionRules, listRetentionRuns } from '@/lib/retention-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Retention, under EVIDENCE — proof that data was deleted when we said it would be is exactly what an
// auditor asks for. It was only reachable from Data → Catalog → Governance, below a stat band and a
// freshness table, which is not where anyone answering that question would look.
export default async function RetentionEvidencePage() {
  await requireModuleForUser('audit');
  const org = await currentOrgId();
  const [rules, sweeps] = await Promise.all([
    listRetentionRules(org).catch(() => []),
    listRetentionRuns(org).catch(() => []),
  ]);
  return (
    <PageFrame>
      <div className="w-full space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Retention</h2>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            How long each kind of record is kept, and the proof it was actually deleted. A limit is
            only a setting until a sweep runs — every sweep here re-counts what is left afterwards, so
            the record proves the deletion rather than asserting it.
          </p>
        </div>
        <RetentionPanel
          rules={rules}
          runs={sweeps.map((r) => ({ ...r, ranAt: r.ranAt.toISOString() }))}
        />
      </div>
    </PageFrame>
  );
}
