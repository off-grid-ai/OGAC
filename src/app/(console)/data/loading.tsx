import { PageSkeleton } from '@/components/PageSkeleton';
import { PageFrame } from '@/components/PageFrame';

// Streamed fallback for the Data family (integrations / data / retrieval / lineage / tool-catalog /
// data-domains) — connector/collection cards. The global sidebar remains visible while this
// fills the body with a header + card-grid shimmer while the per-request data streams in.
export default function DataLoading() {
  return (
    <PageFrame>
      <PageSkeleton stats={0} cards={9} />
    </PageFrame>
  );
}
