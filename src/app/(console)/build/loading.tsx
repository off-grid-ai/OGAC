import { PageSkeleton } from '@/components/PageSkeleton';

// Streamed fallback for the Build family (agents / studio / agent-runs / apps / tools) — mostly
// entity-card collections. The group layout paints the BuildNav instantly; this fills the body with
// a header + card-grid shimmer so navigation feels immediate while per-request data streams in.
export default function BuildLoading() {
  return <PageSkeleton stats={0} cards={9} />;
}
