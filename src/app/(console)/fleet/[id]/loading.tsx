import { SkeletonDetailBody, SkeletonPageHeader, SkeletonStatBand } from '@/components/PageSkeleton';

// Streamed fallback for a fleet node detail — a heavy route that probes the node's live health and
// the models it serves. Paints a header + KPI band + detail-body shimmer immediately so opening a
// node feels instant while the live probe + data stream in.
export default function FleetNodeDetailLoading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-live="polite">
      <SkeletonPageHeader />
      <SkeletonStatBand count={4} />
      <SkeletonDetailBody />
    </div>
  );
}
