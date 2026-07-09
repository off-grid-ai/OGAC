import { notFound } from 'next/navigation';
import { AppAccessEditor } from '@/components/build/AppAccessEditor';
import { AppShareManager } from '@/components/build/AppShareManager';
import { getApp } from '@/lib/apps-store';
import { resolveAppAccessPolicy } from '@/lib/app-access';
import { listAppGrants } from '@/lib/app-sharing';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app ACCESS tab — the consumer's governed access policy + SHARING ──────────────────────────
// Every app is an access-controlled entity. This surface binds:
//   • RBAC/ABAC access policy — who may run/trigger/approve by role/department + attribute constraints
//     + HITL approval authority (AppAccessEditor → /api/v1/admin/apps/[id]/access).
//   • SHARING — Google-Doc-style per-user grants over existing Keycloak users, plus the owner's
//     upward management chain which auto-inherits (AppShareManager → /api/v1/admin/apps/[id]/shares).
// Effective access is the UNION of the two, resolved in the enforcement seam (enforceAppAccessWithSharing).
export default async function AppAccessTab({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) notFound();
  const [policy, grants] = await Promise.all([
    resolveAppAccessPolicy(id, orgId, app.ownerId),
    listAppGrants(id, orgId),
  ]);
  const isDefault = !app.pipelineId && Object.keys(policy.actions).length === 0 && !policy.approval;

  return (
    <div className="w-full space-y-6">
      <AppShareManager appId={id} ownerId={app.ownerId} initialGrants={grants} />
      <AppAccessEditor appId={id} ownerId={app.ownerId} initialPolicy={policy} isDefault={isDefault} />
    </div>
  );
}
