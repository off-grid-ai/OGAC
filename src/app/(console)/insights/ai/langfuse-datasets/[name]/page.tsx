import Link from 'next/link';
import { LangfuseDatasetDetail } from '@/components/observability/LangfuseDatasetDetail';
import { Button } from '@/components/ui/button';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Deep-linkable per-dataset detail: items (add/edit/delete) + experiment runs. The active tab lives
// in the URL (?tab=) so Back is coherent between items and runs.
export default async function LangfuseDatasetDetailPage({
  params,
}: Readonly<{ params: Promise<{ name: string }> }>) {
  await requireModuleForUser('observability');
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Insights · AI · Langfuse · Dataset
          </p>
          <h1 className="font-mono text-lg font-semibold">{decoded}</h1>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/insights/ai/langfuse-datasets">← All datasets</Link>
        </Button>
      </div>
      <LangfuseDatasetDetail name={decoded} />
    </div>
  );
}
