import { notFound } from 'next/navigation';
import { AppAccessEditor } from '@/components/build/AppAccessEditor';
import { getApp } from '@/lib/apps-store';
import { resolveAppAccessPolicy } from '@/lib/app-access';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app ACCESS tab — the consumer's governed access policy ──────────────────────────────────
// Every app is an access-controlled entity: this surface binds who may run/trigger/approve it (RBAC
// by role/department + ABAC attribute constraints + HITL approval authority). The effective policy
// (stored, or the least-privilege default: owner + admins only) is resolved server-side and handed to
// the client editor, which PUTs changes to /api/v1/admin/apps/[id]/access.
export default async function AppAccessTab({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) notFound();
  const policy = await resolveAppAccessPolicy(id, orgId, app.ownerId);
  const isDefault = !app.pipelineId && Object.keys(policy.actions).length === 0 && !policy.approval;

  return (
    <AppAccessEditor
      appId={id}
      ownerId={app.ownerId}
      initialPolicy={policy}
      isDefault={isDefault}
    />
  );
}
