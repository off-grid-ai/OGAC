import { SkeletonPageHeader, SkeletonStatBand, SkeletonTable } from '@/components/PageSkeleton';

// Streamed fallback for the Governance family (control / policy / access / guardrails / secrets /
// regulatory / provenance). These surfaces lean on status bands + list tables (rules, grants,
// secrets, decisions). The global sidebar remains available while this fills the body
// with a header + a compliance status band + a table shimmer while the per-request data streams in.
export default function GovernanceLoading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-live="polite">
      <SkeletonPageHeader />
      <SkeletonStatBand count={4} />
      <SkeletonTable rows={8} cols={5} />
    </div>
  );
}
