import { PageFrame } from '@/components/PageFrame';
import { RetentionPanel } from '@/components/data/RetentionPanel';
import { StoreRetentionPosture } from '@/components/governance/StoreRetentionPosture';
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
        {/* No second "Retention" heading. The console layout already titles this page and describes
            it; repeating the word directly underneath reads as two sections rather than one. What is
            kept is the sentence the short layout description does not carry: why a limit alone proves
            nothing. */}
        <p className="max-w-3xl text-xs text-muted-foreground">
          A limit is only a setting until a sweep runs. Every sweep below re-counts what is left
          afterwards, so the record proves the deletion rather than asserting it.
        </p>
        <RetentionPanel
          rules={rules}
          runs={sweeps.map((r) => ({ ...r, ranAt: r.ranAt.toISOString() }))}
        />
        {/* The sweep above covers database records. The metric and log stores set retention as a deploy
            flag, so no sweep touches them — and a retention claim that silently excludes the audit log
            store is not the claim anyone thinks it is. */}
        <StoreRetentionPosture />
      </div>
    </PageFrame>
  );
}
