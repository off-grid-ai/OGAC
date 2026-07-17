import { SecretsMountTable, SecretsStatusBanner } from '@/components/secrets/SecretsStatusViews';
import { requireModuleForUser } from '@/lib/module-access';
import { readSecretsView } from '@/lib/secrets-view';

export const dynamic = 'force-dynamic';

export default async function SecretMountsPage() {
  await requireModuleForUser('secrets');
  const { data: view, error } = await readSecretsView();

  return (
    <div className="w-full space-y-6">
      <SecretsStatusBanner view={view} error={error} />
      <SecretsMountTable view={view} />
    </div>
  );
}
