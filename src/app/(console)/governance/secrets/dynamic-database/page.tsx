import { DynamicDbPanel } from '@/components/secrets/DynamicDbPanel';
import { SecretsStatusBanner } from '@/components/secrets/SecretsStatusViews';
import { requireModuleForUser } from '@/lib/module-access';
import { readSecretsView } from '@/lib/secrets-view';

export const dynamic = 'force-dynamic';

export default async function DynamicDatabaseSecretsPage() {
  await requireModuleForUser('secrets');
  const { data: view, error } = await readSecretsView();

  return (
    <div className="w-full space-y-6">
      <SecretsStatusBanner view={view} error={error} />
      {view.configured && view.reachable ? <DynamicDbPanel sealed={view.sealed === true} /> : null}
    </div>
  );
}
