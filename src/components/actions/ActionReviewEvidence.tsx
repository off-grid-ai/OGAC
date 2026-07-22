import { ActionExecutionReceipt } from '@/components/actions/ActionExecutionReceipt';
import { ActionImpactSummary } from '@/components/actions/ActionImpactSummary';
import type { ActionImpact, ActionReceipt } from '@/lib/action-contract';

export function ActionReviewEvidence({
  impact,
  receipt,
  canApprove,
  boundaryReady,
}: Readonly<{
  impact: ActionImpact | null;
  receipt: ActionReceipt | null;
  canApprove: boolean;
  boundaryReady: boolean | null;
}>) {
  if (receipt) return <ActionExecutionReceipt receipt={receipt} />;
  if (!impact) return null;

  const approver =
    boundaryReady === false
      ? 'Approval is blocked until the connection is fixed'
      : canApprove
        ? 'You can approve this change'
        : 'A reviewer with the required authority';

  return (
    <ActionImpactSummary
      impact={impact}
      approver={approver}
      evidence={['Approval decision', 'Changed CRM record', 'Signed execution receipt']}
    />
  );
}
