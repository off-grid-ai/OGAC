import { Sliders } from '@phosphor-icons/react/dist/ssr';
import { ConfigManager } from '@/components/config/ConfigManager';
import { FlagManager } from '@/components/config/FlagManager';
import { requireModuleForUser } from '@/lib/module-access';
import { flagsForcedOpen } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default async function ConfigPage() {
  await requireModuleForUser('config');
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Sliders className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Configuration</h1>
          <p className="text-sm text-muted-foreground">
            Every environment setting for this deployment, in one place. Secrets are masked.
          </p>
        </div>
      </div>
      <ConfigManager />
      <FlagManager forcedOpen={flagsForcedOpen()} />
    </div>
  );
}
