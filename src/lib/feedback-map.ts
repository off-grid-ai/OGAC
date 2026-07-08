// PURE feedback → golden-case mapper — ZERO imports, ZERO I/O, unit-testable in isolation (mirrors
// evals-golden.ts). M1 "close the loop", the LEARN half: turn real user feedback into labeled
// eval/golden data so the NEXT eval run is measured against what users actually corrected/rated.
//
// Two feedback sources, one output shape (GoldenCaseDraft — the same the golden store persists):
//   1. HITL correction — a human reviewer at an app-run `human` step who EDITED the output (or
//      rejected with a note). The corrected output is the ground-truth "expected" for that input.
//   2. Chat thumbs — a 👍/👎 on an assistant answer. 👍 makes the answer itself the expected
//      (a positive golden: "this was right"); 👎 with a correction note makes the correction the
//      expected. A 👎 with NO correction is NOT a usable golden (we have the query but no known-good
//      answer) — we say so honestly rather than inventing an expected.
//
// Every draft is stamped source='feedback' (via suite) so a feedback-derived case is distinguishable
// from a hand-authored one on the Quality tab. The write path (feedback-store) attaches pipeline_id.

// The golden-case draft shape (kept identical to evals-golden.ts GoldenCaseDraft so the store's
// addGoldenCase consumes it directly — DRY, no second shape). Re-declared locally to keep this file
// import-free / pure.
export interface FeedbackGoldenDraft {
  name: string;
  query: string;
  expected: string;
  suite: string;
}

/** The suite tag every feedback-derived golden case carries, so the surface can filter/label them. */
export const FEEDBACK_SUITE = 'feedback';

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

// ─── 1. HITL correction → golden case ───────────────────────────────────────────────────────────────
export interface HitlCorrection {
  /** The input/question that ran (the step or run input, stringified). */
  input?: unknown;
  /** The reviewer's corrected/edited output — the ground-truth expected answer. */
  correctedOutput?: unknown;
  /** The reviewer's free-text note (used as the expected when no explicit corrected output). */
  note?: unknown;
  /** approve | reject — a reject with a correction still yields a "this is what it should be" golden. */
  decision?: unknown;
}

export type FeedbackMapResult =
  | { ok: true; value: FeedbackGoldenDraft }
  | { ok: false; reason: string };

/**
 * Map a HITL review correction into a golden case. PURE. Usable ONLY when we have both an input
 * (the query) AND a ground-truth expected (the corrected output, or a correction note). An approve
 * with no edit carries no new label ("it was already right" — not a correction to learn from);
 * a decision with neither a corrected output nor a note gives us no expected → reason'd out honestly.
 */
export function hitlCorrectionToGolden(c: HitlCorrection): FeedbackMapResult {
  const query = trimStr(c.input);
  if (!query) return { ok: false, reason: 'no input to label as a golden query' };

  const corrected = trimStr(c.correctedOutput);
  const note = trimStr(c.note);
  const expected = corrected || note;
  if (!expected) {
    return { ok: false, reason: 'no corrected output or note — no ground-truth expected to capture' };
  }

  return {
    ok: true,
    value: {
      name: `HITL: ${truncate(query, 56)}`,
      query,
      expected,
      suite: FEEDBACK_SUITE,
    },
  };
}

// ─── 2. Chat thumb → golden case ─────────────────────────────────────────────────────────────────────
export interface ChatThumbFeedback {
  /** The user's question / prompt that produced the rated answer. */
  query?: unknown;
  /** The assistant's answer that was rated. */
  answer?: unknown;
  /** 'up' | 'down' — 👍 keeps the answer as expected; 👎 needs a correction to be usable. */
  rating?: unknown;
  /** On a 👎, the user's correction (what the answer SHOULD have said) — becomes the expected. */
  correction?: unknown;
}

/**
 * Map a chat thumb into a golden case. PURE.
 *  - 👍 (up): the answer WAS right → capture it as the expected (a positive golden).
 *  - 👎 (down) WITH a correction: the correction is the expected (learn the right answer).
 *  - 👎 (down) WITHOUT a correction: we have the query but no known-good answer → not usable,
 *    reason'd out honestly (never invent an expected from a thumbs-down alone).
 */
export function chatThumbToGolden(f: ChatThumbFeedback): FeedbackMapResult {
  const query = trimStr(f.query);
  if (!query) return { ok: false, reason: 'no query to label as a golden' };

  const rating = trimStr(f.rating).toLowerCase();
  const answer = trimStr(f.answer);
  const correction = trimStr(f.correction);

  if (rating === 'up') {
    if (!answer) return { ok: false, reason: 'thumbs-up with no answer — nothing to capture' };
    return {
      ok: true,
      value: {
        name: `👍 ${truncate(query, 56)}`,
        query,
        expected: answer,
        suite: FEEDBACK_SUITE,
      },
    };
  }

  if (rating === 'down') {
    if (!correction) {
      return {
        ok: false,
        reason: 'thumbs-down with no correction — no known-good answer to capture',
      };
    }
    return {
      ok: true,
      value: {
        name: `👎→fix ${truncate(query, 52)}`,
        query,
        expected: correction,
        suite: FEEDBACK_SUITE,
      },
    };
  }

  return { ok: false, reason: `unknown rating: ${rating || '(none)'}` };
}
