import { Suspense } from 'react';
import { TraceDetail } from '@/components/operations/TraceDetail';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// One trace's full span waterfall — a real, deep-linkable detail route. Preserves the incoming
// search filters in the back link so Back returns to the same search.
export default async function TraceDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ traceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  await requireModuleForUser('platform-health');
  const { traceId } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val) qs.set(k, val);
  }
  const backHref = `/operations/health/traces${qs.toString() ? `?${qs}` : ''}`;
  return (
    <Suspense fallback={null}>
      <TraceDetail traceId={traceId} backHref={backHref} />
    </Suspense>
  );
}
