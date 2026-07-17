import { PageSkeleton } from '@/components/PageSkeleton';

// Streamed fallback for the Workspace family (projects / prompts / artifacts) — card-collection
// surfaces. The global sidebar remains available while this fills the body with a
// header + card-grid shimmer so navigation feels immediate while the per-request data streams in.
export default function WorkspaceLoading() {
  return <PageSkeleton stats={0} cards={9} />;
}
