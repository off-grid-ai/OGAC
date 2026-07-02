import { StudioCanvas } from '@/components/studio/StudioCanvas';
import { requireModuleForUser } from '@/lib/module-access';
import { auth } from '@/auth';
import { introspect } from '@/lib/studio';

export const dynamic = 'force-dynamic';

export default async function StudioPage() {
  await requireModuleForUser('studio');
  const session = await auth();
  const catalog = await introspect();
  const order: (keyof typeof catalog.counts)[] = ['Connector', 'Data', 'Tool', 'Guardrail', 'Model', 'Agent'];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Studio</h1>
        <p className="text-sm text-muted-foreground">
          Describe what you want in plain language. No technical knowledge needed.
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {order
            .filter((g) => catalog.counts[g])
            .map((g) => `${catalog.counts[g]} ${g.toLowerCase()}${catalog.counts[g] > 1 ? 's' : ''}`)
            .join(' · ')}{' '}
          available
        </p>
      </div>
      <StudioCanvas catalog={catalog} userId={session?.user?.email ?? undefined} />
    </div>
  );
}
