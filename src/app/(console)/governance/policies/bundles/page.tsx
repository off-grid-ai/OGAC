import { Suspense } from 'react';
import { PolicyAuditBundles } from '@/components/governance/PolicyAuditBundles';
import { readBundleView } from '@/lib/adapters/opa-audit';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Policy BUNDLES + activation surface — read straight from the deployed policy engine: configured
// remote bundles, per-bundle activation revision (when the status plugin is enabled), and the Rego
// modules actually loaded (the honest "active policy set"). Read-only where activation is
// deploy-owned; the compile-and-push action stays on the Modules tab.
export default async function PolicyBundlesPage() {
  await requireModuleForUser('policy');
  const view = await readBundleView();
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading policy bundles…</p>}>
      <PolicyAuditBundles view={view} />
    </Suspense>
  );
}
