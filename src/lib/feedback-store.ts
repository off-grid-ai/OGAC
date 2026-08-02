// M1 "close the loop" — LEARN write path (I/O seam). Takes a HITL correction or a chat thumb, maps
// it to a golden-case draft via the PURE feedback-map, and appends it to golden_cases stamped with
// the bound pipeline_id + suite='feedback'. Thin: the mapping/verdict is pure; this only persists.
//
// The next eval run for that pipeline is then measured against the real correction/rating — usage
// improves the pipeline (the flywheel). Honest: a feedback item with no usable ground-truth (a
// thumbs-down with no correction, an approve with no edit) is NOT written — we return { captured:
// false, reason } so the caller can say so, never inventing a golden.
import { addGoldenCase } from '@/lib/evals';
import {
  chatThumbToGolden,
  hitlCorrectionToGolden,
  type ChatThumbFeedback,
  type FeedbackMapResult,
  type HitlCorrection,
} from '@/lib/feedback-map';

export interface CaptureResult {
  captured: boolean;
  goldenId?: string;
  reason?: string;
}

async function persist(
  mapped: FeedbackMapResult,
  pipelineId: string | null,
  orgId: string | null,
): Promise<CaptureResult> {
  if (!mapped.ok) return { captured: false, reason: mapped.reason };
  // ORG-STAMPED. Verified live 2026-08-02: a correction made on an org_bharat run was written with
  // org_id 'default', because this seam never took an org — so `listGoldenCases('org_bharat')` could
  // not see it and that tenant's next eval run was never measured against its own reviewer's
  // correction. The API answered { captured: true, goldenId } throughout, which is the worst version
  // of this bug: the learning loop reported success while the feedback went somewhere nobody reads.
  const gc = await addGoldenCase(mapped.value, { pipelineId, orgId: orgId ?? undefined });
  return { captured: true, goldenId: gc.id };
}

/** Capture a HITL app-run correction as a golden case for the run's bound pipeline. */
export async function captureHitlCorrection(
  correction: HitlCorrection,
  pipelineId: string | null,
  orgId: string | null = null,
): Promise<CaptureResult> {
  return persist(hitlCorrectionToGolden(correction), pipelineId, orgId);
}

/** Capture a chat thumb (👍/👎+correction) as a golden case for the conversation's bound pipeline. */
export async function captureChatThumb(
  feedback: ChatThumbFeedback,
  pipelineId: string | null,
  orgId: string | null = null,
): Promise<CaptureResult> {
  return persist(chatThumbToGolden(feedback), pipelineId, orgId);
}
