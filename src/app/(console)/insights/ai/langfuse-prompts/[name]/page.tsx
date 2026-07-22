import Link from 'next/link';
import { LangfusePromptDetail } from '@/components/observability/LangfusePromptDetail';
import { Button } from '@/components/ui/button';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Deep-linkable per-prompt detail: versions, labels, body, and the lifecycle actions (cut a version,
// move a label, delete). The selected version lives in the URL (?version=) so it's Back-coherent.
export default async function LangfusePromptDetailPage({
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
            Insights · AI · Langfuse · Prompt
          </p>
          <h1 className="font-mono text-lg font-semibold">{decoded}</h1>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/insights/ai/langfuse-prompts">← All prompts</Link>
        </Button>
      </div>
      <LangfusePromptDetail name={decoded} />
    </div>
  );
}
