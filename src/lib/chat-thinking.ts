// Pure logic for the inline "Thinking" block — zero IO, zero React, unit-testable.
//
// Extended-thinking tokens arrive on the assistant message as `reasoning`, streamed separately from
// the final answer `content` (the stream route relays `reasoning_content` deltas as `reasoning`).
// The transcript renders reasoning ABOVE the answer as a distinct, collapsible block — never mixed
// into the answer body. This module owns the one decision that governs that block's presentation:
// its lifecycle state as tokens arrive.
//
//   - hidden:    no reasoning at all → render nothing.
//   - streaming: reasoning is arriving and the answer hasn't started → expanded, live, animated.
//   - done:      the answer has started (or generation finished) → collapse by default; the reader
//                can re-open it. This is the "collapse once the answer starts" rule from the task.

export type ThinkingPhase = 'hidden' | 'streaming' | 'done';

export interface ThinkingState {
  phase: ThinkingPhase;
  hasReasoning: boolean;
  // Whether the block should be open by default for this phase. The component may still let the
  // user override via a manual toggle; this is only the default.
  defaultOpen: boolean;
}

// Derive the thinking block's presentation from the raw message fields. Pure — same inputs always
// yield the same state, so it's trivially testable and the component stays dumb.
//   reasoning — accumulated reasoning tokens so far (may be null/empty).
//   content   — accumulated answer tokens so far (empty until the answer starts).
//   streaming — whether this message is still being generated.
export function thinkingState(
  reasoning: string | null | undefined,
  content: string | null | undefined,
  streaming: boolean,
): ThinkingState {
  const hasReasoning = Boolean(reasoning && reasoning.trim());
  if (!hasReasoning) return { phase: 'hidden', hasReasoning: false, defaultOpen: false };
  const answerStarted = Boolean(content && content.length > 0);
  // Still thinking: answer not begun and generation ongoing → keep it open and live.
  if (streaming && !answerStarted) {
    return { phase: 'streaming', hasReasoning: true, defaultOpen: true };
  }
  // Answer has started (or we're done) → the reasoning is settled; collapse by default.
  return { phase: 'done', hasReasoning: true, defaultOpen: false };
}

// A short, human label for the block header, reflecting phase. Kept here (not in the component) so
// the wording is covered by tests and consistent across renders.
export function thinkingLabel(phase: ThinkingPhase): string {
  return phase === 'streaming' ? 'Thinking…' : 'Thinking';
}
