import { SkeletonDetailBody, SkeletonPageHeader, SkeletonStatBand } from '@/components/PageSkeleton';

// Streamed fallback for a gateway detail — a heavy route that probes the gateway's live health and
// lists its attached pipelines/models. Paints a header + KPI band + detail-body shimmer immediately
// so opening a gateway feels instant while the live probe + data stream in.
export default function GatewayDetailLoading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-live="polite">
      <SkeletonPageHeader />
      <SkeletonStatBand count={4} />
      <SkeletonDetailBody />
    </div>
  );
}
