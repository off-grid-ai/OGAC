import { PageSkeleton } from '@/components/PageSkeleton';
import { PageFrame } from '@/components/PageFrame';

// Streamed fallback for the Build family (agents / studio / agent-runs / apps / tools) — mostly
// entity-card collections. The global sidebar remains visible while this fills the body with
// a header + card-grid shimmer so navigation feels immediate while per-request data streams in.
export default function BuildLoading() {
  return (
    <PageFrame>
      <PageSkeleton stats={0} cards={9} />
    </PageFrame>
  );
}
