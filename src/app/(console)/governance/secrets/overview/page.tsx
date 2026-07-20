import { SealControl } from '@/components/secrets/SealControl';
import { SecretsStatusBanner, SecretsSummary } from '@/components/secrets/SecretsStatusViews';
import { requireModuleForUser } from '@/lib/module-access';
import { readSecretsView } from '@/lib/secrets-view';

export const dynamic = 'force-dynamic';

export default async function SecretsOverviewPage() {
  await requireModuleForUser('secrets');
  const { data: view, error } = await readSecretsView();

  return (
    <div className="w-full space-y-6">
      <SecretsStatusBanner view={view} error={error} />
      <SecretsSummary view={view} />
      {view.configured && view.reachable ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <SealControl
            sealed={view.sealed}
            threshold={view.unsealThreshold}
            shares={view.unsealShares}
            progress={view.unsealProgress}
          />
        </div>
      ) : null}
    </div>
  );
}
