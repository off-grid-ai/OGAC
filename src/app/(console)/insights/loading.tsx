import { SkeletonPageHeader, SkeletonStatBand } from '@/components/PageSkeleton';
import { Skeleton } from '@/components/ui/skeleton';

// Streamed fallback for the Insights family (observability / analytics / drift / finops / reports /
// security events / audit / accounting). These are metric + chart surfaces. The group layout paints
// the InsightsNav instantly; this fills the body with a header, a KPI band, and two large chart-
// panel placeholders while the per-request analytics streams in.
export default function InsightsLoading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-live="polite">
      <SkeletonPageHeader />
      <SkeletonStatBand count={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-52 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
