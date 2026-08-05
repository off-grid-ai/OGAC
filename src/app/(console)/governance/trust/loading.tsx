import { SkeletonPageHeader, SkeletonStatBand } from '@/components/PageSkeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { PageFrame } from '@/components/PageFrame';

// Streamed fallback for the Trust family (regulatory posture, DPIA pack, control coverage) — control tables and coverage bands.
//
// WHY THIS FILE EXISTS: this sub-module adds a `layout.tsx`, and a layout with no sibling
// `loading.tsx` makes the interim state a BLANK VOID rather than a skeleton — a header over empty
// space. On a slow read (these surfaces aggregate several stores) the page photographs as unbuilt,
// which is exactly what a review pass caught here: five governance sub-modules rendering as white.
export default function TrustLoading() {
  return (
    <PageFrame>
      <div className="w-full space-y-6" aria-busy="true" aria-live="polite">
        <SkeletonPageHeader />
        <SkeletonStatBand count={4} />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-28 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </PageFrame>
  );
}
