import { MetricsExplorer } from '@/components/operations/MetricsExplorer';
import { requireModuleForUser } from '@/lib/module-access';
import { normalizeRange, type RangeWindow } from '@/lib/victoriametrics-query';

export const dynamic = 'force-dynamic';

// Metric explorer — a full PromQL workbench over VictoriaMetrics: query input + metric-name picker +
// range selector (all URL-driven via ?q / ?range so the view is deep-linkable and Back-coherent),
// rendered as a time-series chart + latest-value readout, alongside the saved-query CRUD panel.
export default async function MetricsExplorerPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  await requireModuleForUser('platform-health');
  const sp = await searchParams;
  const q = (typeof sp.q === 'string' ? sp.q : sp.q?.at(0)) ?? '';
  const range: RangeWindow = normalizeRange(typeof sp.range === 'string' ? sp.range : sp.range?.at(0));
  return <MetricsExplorer initialQuery={q} initialRange={range} />;
}
