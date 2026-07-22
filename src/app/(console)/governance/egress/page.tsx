import { CloudEgressPanel } from '@/components/guardrails/CloudEgressPanel';
import { PageFrame } from '@/components/PageFrame';
import { getEgressPolicy, listEgressDecisions } from '@/lib/egress-policy-store';
import { readGuardrailsView } from '@/lib/guardrails-view';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Governance → Cloud egress protection. The management surface for the MANDATORY egress-DLP leash:
// toggle protection, choose mask-vs-block, see the detector's honest reachability, and review recent
// egress decisions. Reachable by its own URL (URL-driven nav); gated by the guardrails module.
export default async function CloudEgressPage() {
  await requireModuleForUser('guardrails');
  const orgId = await currentOrgId();
  const [policy, view, decisions] = await Promise.all([
    getEgressPolicy(orgId),
    readGuardrailsView().catch(() => null),
    listEgressDecisions(orgId, 25),
  ]);

  return (
    <PageFrame>
      <section aria-labelledby="egress-heading" className="w-full space-y-6">
        <header className="space-y-1.5 border-b border-border/80 pb-4">
          <h1 id="egress-heading" className="text-base font-medium">
            Cloud egress protection
          </h1>
          <p className="max-w-3xl text-xs text-muted-foreground">
            Use the best outside models on your data, safely — sensitive data is stripped before any
            request leaves your network to a cloud provider, enforced by default and fully governed.
          </p>
        </header>
        <CloudEgressPanel
          enabled={policy.enabled}
          strictness={policy.strictness}
          updatedBy={policy.updatedBy}
          updatedAt={policy.updatedAt}
          engine={
            view
              ? { name: view.engine, configured: view.configured, reachable: view.reachable }
              : { name: 'unknown', configured: false, reachable: false }
          }
          decisions={decisions}
        />
      </section>
    </PageFrame>
  );
}
