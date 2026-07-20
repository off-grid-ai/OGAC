/** Pure delivery evidence for one lineage event. Network I/O stays in the lineage adapter. */
export type LineageDeliveryStatus =
  | 'implicit'
  | 'not-configured'
  | 'accepted'
  | 'rejected'
  | 'unreachable';

export interface LineageDeliveryReceipt {
  adapterId: string;
  job: string;
  runId: string;
  status: LineageDeliveryStatus;
  httpStatus: number | null;
  attemptedAt: string;
  detail: string;
}

export function lineageDeliveryReceipt(input: LineageDeliveryReceipt): LineageDeliveryReceipt {
  return { ...input };
}

export function lineageDeliverySummary(receipt: LineageDeliveryReceipt): string {
  const http = receipt.httpStatus === null ? '' : ` http=${receipt.httpStatus}`;
  return `lineage=${receipt.adapterId}:${receipt.status}${http} run=${receipt.runId}`;
}
