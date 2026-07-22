import { ArrowLeft, HardDrive } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageFrame } from '@/components/PageFrame';
import { SourceObjectBrowser } from '@/components/data/SourceObjectBrowser';
import { Badge } from '@/components/ui/badge';
import { getConnector } from '@/lib/connector-detail';
import { listDomains } from '@/lib/data-domains-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function SourceObjectsPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('data');
  const { id } = await params;
  const orgId = await currentOrgId();
  const source = await getConnector(id, orgId);
  if (!source || source.type !== 's3') notFound();
  const domains = (await listDomains(orgId))
    .filter((domain) => domain.connectorId === source.id)
    .map((domain) => ({ id: domain.id, label: domain.label, resource: domain.resource }));

  return (
    <PageFrame>
      <div className="w-full space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href={`/data/connectors/${encodeURIComponent(source.id)}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-3" /> Source details
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <HardDrive className="size-5 text-primary" />
              <h1 className="text-xl font-semibold text-foreground">{source.name} objects</h1>
              <Badge variant="outline">S3 compatible</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Browse and manage only the buckets and folders approved through this source’s data domains.
            </p>
          </div>
        </div>
        <SourceObjectBrowser source={{ id: source.id, name: source.name, endpoint: source.endpoint }} domains={domains} />
      </div>
    </PageFrame>
  );
}
