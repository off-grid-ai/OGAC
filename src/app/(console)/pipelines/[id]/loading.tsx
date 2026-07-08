import { SkeletonDetailBody, SkeletonPageHeader, SkeletonStatBand } from '@/components/PageSkeleton';

// Streamed fallback for a pipeline detail — a heavy route that fetches the pipeline plus its
// gateway, policy, guardrails, quality and cost snapshots. Paints a header + KPI band + detail-body
// shimmer immediately so drilling into a pipeline feels instant while the data streams in.
export default function PipelineDetailLoading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-live="polite">
      <SkeletonPageHeader />
      <SkeletonStatBand count={4} />
      <SkeletonDetailBody />
    </div>
  );
}
