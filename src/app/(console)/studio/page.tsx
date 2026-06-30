import { StudioCanvas } from '@/components/studio/StudioCanvas';
import { requireModule } from '@/lib/modules';
import { introspect } from '@/lib/studio';

export const dynamic = 'force-dynamic';

export default async function StudioPage() {
  requireModule('studio');
  const catalog = await introspect();
  const order: (keyof typeof catalog.counts)[] = ['Connector', 'Data', 'Tool', 'Guardrail', 'Model', 'Agent'];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Studio</h1>
        <p className="text-sm text-muted-foreground">
          Describe what you want in plain language. The platform introspects your connectors, data
          sources, tools, guardrails, and agents — and wires the workflow.
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {order
            .filter((g) => catalog.counts[g])
            .map((g) => `${catalog.counts[g]} ${g.toLowerCase()}${catalog.counts[g] > 1 ? 's' : ''}`)
            .join(' · ')}{' '}
          available
        </p>
      </div>
      <StudioCanvas catalog={catalog} />
    </div>
  );
}
