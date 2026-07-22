import { notFound } from 'next/navigation';
import { PageFrame } from '@/components/PageFrame';
import { SourceObjectBrowser } from '@/components/data/SourceObjectBrowser';
import { getConnector } from '@/lib/connector-detail';
import { listDomains } from '@/lib/data-domains-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function SourceObjectDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string; key: string[] }> }>) {
  await requireModuleForUser('data');
  const { id, key } = await params;
  const orgId = await currentOrgId();
  const source = await getConnector(id, orgId);
  if (!source || source.type !== 's3' || key.length === 0) notFound();
  const domains = (await listDomains(orgId))
    .filter((domain) => domain.connectorId === source.id)
    .map((domain) => ({ id: domain.id, label: domain.label, resource: domain.resource }));

  return (
    <PageFrame>
      <div className="w-full space-y-6">
        <SourceObjectBrowser
          source={{ id: source.id, name: source.name, endpoint: source.endpoint }}
          domains={domains}
          objectKey={key.join('/')}
        />
      </div>
    </PageFrame>
  );
}
