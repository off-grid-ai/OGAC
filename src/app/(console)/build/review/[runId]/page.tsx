import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { ReviewDecision } from '@/components/build/ReviewDecision';
import { callerFromSession } from '@/lib/app-access-caller';
import { canReview } from '@/lib/app-runs-view';
import { getAppRunView } from '@/lib/app-runs-view-reader';
import { type AuthzSession } from '@/lib/authz';
import { requireModuleForUser } from '@/lib/module-access';
import { getReviewDetail } from '@/lib/review-inbox-reader';
import { currentOrgId } from '@/lib/tenancy';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// ─── REVIEW DETAIL (HITL — screen 4, one pending decision) ────────────────────────────────────────
// The full, plain-language decision surface for a non-technical reviewer: the question being asked,
// the amount, the draft the app recommends, WHY (citations + faithfulness + guardrail/PII notes), the
// input, and the policy context that routed this to a human — then Approve / Reject. Deep-linkable per
// run (/build/review/<runId>). Approval respects authority (surfaced gracefully, not a crash).
export default async function ReviewDetailPage({
  params,
}: Readonly<{
  params: Promise<{ runId: string }>;
}>) {
  await requireModuleForUser('studio');
  const { runId } = await params;
  const orgId = await currentOrgId();
  const session = (await auth()) as AuthzSession | null;
  const gate: AuthzSession = session ?? {
    user: { email: undefined, name: undefined, role: undefined },
  };
  const caller = await callerFromSession(gate, orgId);

  const [detail, run] = await Promise.all([
    getReviewDetail(runId, caller, orgId),
    getAppRunView(runId, orgId),
  ]);
  if (!detail || !run) notFound();

  const reviewable = canReview(run);

  return (
    <PageFrame>
      {
        <div className="w-full space-y-6">
          <div>
            <Link
              href="/solutions/reviews"
              className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" /> Review queue
            </Link>
          </div>

          <ReviewDecision detail={detail} reviewable={reviewable} runStatus={run.status} />
        </div>
      }
    </PageFrame>
  );
}
