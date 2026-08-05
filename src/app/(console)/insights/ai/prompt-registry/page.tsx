import Link from 'next/link';
import { LangfuseRegistryPanel } from '@/components/observability/LangfuseRegistryPanel';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { safeLangfuseRegistry } from '@/lib/langfuse';
import { resolveRegistryTab } from '@/lib/langfuse-registry';
import { ownedRunIdsForOrg } from '@/lib/langfuse-session-scope';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function PromptRegistryPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  await requireModuleForUser('observability');
  const params = await searchParams;
  const rawTab = Array.isArray(params.lfReg) ? params.lfReg[0] : params.lfReg;
  // This page displayed another tenant's system prompt to the insurer's read-only demo account. The org
  // now comes from the request's own tenant binding and scopes every list on it.
  const orgId = await currentOrgId();
  const ownedRuns = await ownedRunIdsForOrg(orgId);
  const [registry, tab] = await Promise.all([
    safeLangfuseRegistry(orgId, ownedRuns, 100),
    Promise.resolve(resolveRegistryTab(rawTab)),
  ]);

  return (
    <div className="w-full space-y-6">
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-sm">Observation and ownership stay separate</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              This leaf reads versions recorded by the tracing store. Create and edit prompt
              templates in Workspace.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/work/prompts">Manage prompts</Link>
          </Button>
        </CardHeader>
      </Card>
      <LangfuseRegistryPanel
        configured={registry.configured}
        prompts={registry.prompts}
        datasets={registry.datasets}
        sessions={registry.sessions}
        error={registry.error}
        tab={tab}
      />
    </div>
  );
}
