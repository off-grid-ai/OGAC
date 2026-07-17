import { notFound } from 'next/navigation';
import { ServiceDetail } from '@/components/services/ServiceDetail';
import { requireModuleForUser } from '@/lib/module-access';
import { findService, getServices, serviceControl } from '@/lib/services-directory';

export const dynamic = 'force-dynamic';

// Services drill-through (Task C3): the deep-linkable detail for one service. Live health with a
// session history, the honest management note (why it can't be restarted from the console), and a
// jump to its logs — the real management surface, not a flat status tile.
export default async function ServiceDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('services');
  const { id } = await params;
  const service = findService(getServices(), id);
  if (!service) notFound();

  const control = serviceControl(service);
  // Where an operator jumps to see this service's logs/telemetry. OpenSearch/Langfuse power the
  // SIEM + observability views; everything else points at the SIEM search.
  // Platform health owns service telemetry in the canonical IA. Keep this jump canonical even when
  // the detail implementation is also mounted by the legacy redirect-compatible route.
  const logsHref = '/operations/health';

  return <ServiceDetail service={service} control={control} logsHref={logsHref} />;
}
