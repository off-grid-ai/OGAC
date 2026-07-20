import { HardDrive } from '@phosphor-icons/react/dist/ssr';
import { PageFrame } from '@/components/PageFrame';
import { StorageBrowser } from '@/components/storage/StorageBrowser';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

export default async function StoragePage() {
  await requireModuleForUser('storage');
  return (
    <PageFrame className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <HardDrive className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Storage</h1>
          <p className="text-sm text-muted-foreground">
            Upload, browse, and share files — stored on-prem, never leaves your infrastructure.
          </p>
        </div>
      </div>
      <StorageBrowser />
    </PageFrame>
  );
}
