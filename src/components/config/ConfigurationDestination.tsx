import { WorkspacePipelineBinding } from '@/components/admin/WorkspacePipelineBinding';
import { AdaptersDestination } from '@/components/config/AdaptersDestination';
import { ConfigManager } from '@/components/config/ConfigManager';
import { FlagManager } from '@/components/config/FlagManager';
import { MessagingManager } from '@/components/messaging/MessagingManager';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ConfigurationDestinationId } from '@/lib/operations-destinations';
import { listPipelines } from '@/lib/pipelines';
import { flagsForcedOpen, getChatBindingGovernance } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export async function ConfigurationDestination({
  destination,
}: Readonly<{ destination: ConfigurationDestinationId }>) {
  if (destination === 'feature-flags') return <FlagManager forcedOpen={flagsForcedOpen()} />;
  if (destination === 'adapters') return <AdaptersDestination />;
  if (destination === 'messaging') return <MessagingManager />;

  const orgId = await currentOrgId();
  const [chatBinding, pipelines] = await Promise.all([
    getChatBindingGovernance(orgId),
    listPipelines(orgId).catch(() => []),
  ]);
  return (
    <div className="space-y-6">
      <ConfigManager />
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Workspace pipeline binding</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Set the governed pipeline Chat and Projects use by default, and which pipelines a
            project may select.
          </p>
        </CardHeader>
        <CardContent>
          <WorkspacePipelineBinding
            initial={{
              defaultChatPipelineId: chatBinding.defaultChatPipelineId,
              allowlist: chatBinding.allowlist,
            }}
            pipelines={pipelines.map((pipeline) => ({
              id: pipeline.id,
              name: pipeline.name,
              status: pipeline.status,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
