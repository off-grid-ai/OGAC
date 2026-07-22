import { Suspense } from 'react';
import { TraceSearch } from '@/components/operations/TraceSearch';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Distributed-trace search — the third observability pillar (logs · metrics · traces). URL-driven,
// full-width, list → detail. Guarded by the platform-health module.
export default async function TraceSearchPage() {
  await requireModuleForUser('platform-health');
  return (
    <Suspense fallback={null}>
      <TraceSearch />
    </Suspense>
  );
}
