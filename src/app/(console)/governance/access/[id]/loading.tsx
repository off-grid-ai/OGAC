import {
  SkeletonDetailBody,
  SkeletonPageHeader,
  SkeletonStatBand,
} from '@/components/PageSkeleton';
import { PageFrame } from '@/components/PageFrame';

// Streamed fallback for an access/identity detail — a heavy route that reads the principal plus its
// roles, grants and recent decisions. Paints a header + KPI band + detail-body shimmer immediately
// so opening a principal feels instant while the data streams in.
export default function AccessDetailLoading() {
  return (
    <PageFrame>
      <div className="w-full space-y-6" aria-busy="true" aria-live="polite">
        <SkeletonPageHeader />
        <SkeletonStatBand count={4} />
        <SkeletonDetailBody />
      </div>
    </PageFrame>
  );
}
