import { SkeletonDetailBody, SkeletonPageHeader, SkeletonStatBand } from '@/components/PageSkeleton';

// Streamed fallback for an app detail — the lifecycle shell (Build / Input / Runs / Review /
// Reports) whose server render loads the app plus its runs and reports. Paints a header + KPI band
// + detail-body shimmer immediately so opening an app feels instant while the data streams in.
export default function AppDetailLoading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-live="polite">
      <SkeletonPageHeader />
      <SkeletonStatBand count={4} />
      <SkeletonDetailBody />
    </div>
  );
}
