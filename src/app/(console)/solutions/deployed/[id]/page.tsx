import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DeploymentForm } from '@/components/solutions/DeploymentForm';
import { getApp } from '@/lib/apps-store';
import { getSolutionBlueprint, getSolutionDeployment } from '@/lib/solution-blueprints-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function DeploymentDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const orgId = await currentOrgId(); const { id } = await params;
  const deployment = await getSolutionDeployment(id, orgId); if (!deployment) notFound();
  const [blueprint, app] = await Promise.all([getSolutionBlueprint(deployment.blueprintId, orgId), getApp(deployment.appId, orgId)]);
  if (!blueprint || !app) notFound();
  return <div className="space-y-6"><header><Link href="/solutions/deployed" className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft /> Deployed solutions</Link><p className="mt-4 text-[10px] uppercase tracking-widest text-primary">{deployment.status}</p><h1 className="mt-1 text-2xl font-semibold">{blueprint.title}</h1><p className="mt-2 text-sm text-muted-foreground">Bound to the canonical App <Link className="text-primary" href={`/solutions/apps/${app.id}`}>{app.title}</Link>.</p></header>
    <div className="grid gap-4 lg:grid-cols-3"><Link href={`/solutions/library/${blueprint.id}`} className="rounded-lg border bg-card p-5"><p className="text-xs text-muted-foreground">Proof contract</p><p className="mt-2 font-medium">Blueprint v{blueprint.proof.version}</p></Link><Link href={`/solutions/apps/${app.id}/runs`} className="rounded-lg border bg-card p-5"><p className="text-xs text-muted-foreground">Execution evidence</p><p className="mt-2 font-medium">Open App runs →</p></Link><Link href={`/solutions/apps/${app.id}/reports`} className="rounded-lg border bg-card p-5"><p className="text-xs text-muted-foreground">Measured evidence</p><p className="mt-2 font-medium">Open App reports →</p></Link></div>
    <DeploymentForm deployment={deployment} />
  </div>;
}
