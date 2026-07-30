// ─── Value-stable pseudonyms — pure (GAP M1) ───────────────────────────────────────────────────────
//
// Masking currently destroys entity identity, which stops a governed agent doing real work. Live on run
// `apprun_a60fcc2f`: the app read exactly the right data — Meera Malhotra's claim (₹41,346.44) and her
// six quota rows, Training carrying ₹137,454.12 remaining, so the claim was comfortably within quota —
// and the agent still refused, correctly, because it was shown:
//
//   "The claim submitted by [REDACTED_PERSON_23] does not appear in the provided data. The only claim
//    listed in expense_claims is for [REDACTED_PERSON_12][REDACTED_PERSON_13], not [REDACTED_PERSON_23]."
//
// One person, three tokens. The masker's counter is PER SCAN and a run scans in several places
// independently, so the same value becomes a different token in each channel. A faithful reasoner then
// concludes the records describe different people — and a governed agent that cannot join two records
// about one customer cannot do the work at all.
//
// THE FIX IS NOT LESS MASKING. It is a token derived from the VALUE rather than from the scan:
//
//   [REDACTED_PERSON_23]  ─┐
//   [REDACTED_PERSON_12]  ─┼─→  [PERSON_1f4a9c33]     (same person, same token, every scan)
//   [REDACTED_PERSON_7]   ─┘
//
// Referential integrity is what makes masked data usable, and it is the stronger claim: the AI does the
// work without ever seeing the name.
//
// WHY THIS WORKS WITHOUT ENTITY SPANS. The PII port returns already-redacted text and a list of entity
// TYPES — no offsets (see PiiResult) — and the masker has by then discarded the original values. But the
// caller still holds BOTH strings, and they are identical except at the replaced spans. So the spans are
// recoverable by aligning original against redacted, which also makes this engine-agnostic: it works for
// any masker that hands back redacted text, with no new service and no second detector.
//
// SAFETY INVARIANT, above everything else in this file: if the alignment is not perfectly consistent,
// return the REDACTED text unchanged. A raw value must never be emitted because a re-keying heuristic
// got confused. Every failure path here returns redacted text, never `original`.
//
// PRIVACY. The token is a salted hash of the value, so it is a pseudonym, not a reversible reference —
// and salting with the ORG means the same person in two tenants gets different tokens, so nothing
// correlates across orgs. A short digest is brute-forceable against a known candidate list; that is the
// standard pseudonymisation trade-off and is what buys the join. No real value is ever in the output.

/**
 * Placeholder shapes we re-key. Covers the masker's numbered form (`[REDACTED_PERSON_23]`,
 * `[REDACTED_EMAIL_ADDRESS_3]`) and the bare `[REDACTED]`.
 *
 * The type is captured so the pseudonym stays readable — a reviewer should still be able to tell that a
 * token stands for a person rather than an account number.
 */
const TOKEN = /\[REDACTED(?:_([A-Z][A-Z0-9_]*?))?(?:_(\d+))?\]/g;

/** FNV-1a, 32-bit. Deterministic, dependency-free, and stable across processes and node versions. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply by the FNV prime (16777619) in 32-bit space via shifts, avoiding float precision loss.
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Normalise a value so trivially different spellings of one entity agree.
 *
 * Case and whitespace are collapsed on purpose: "Meera Malhotra", "meera malhotra" and "Meera  Malhotra"
 * must land on ONE token, because that is exactly the join the agent needs to make.
 */
export function normalizeEntityValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The stable pseudonym for a value: `[PERSON_1f4a9c33]`.
 *
 * Salted with the org so the same person never carries the same token across tenants. Two 32-bit halves
 * are combined for an 8-hex-character digest — enough that an accidental collision (which would merge
 * two entities, visibly, rather than leak anything) is not a practical concern at run scale.
 */
export function stablePseudonym(entityType: string, value: string, salt: string): string {
  const type = (entityType || 'ENTITY').toUpperCase();
  const key = `${salt}|${type}|${normalizeEntityValue(value)}`;
  const digest = `${fnv1a(key).toString(16).padStart(8, '0')}${fnv1a(`${key}|2`).toString(16).padStart(8, '0')}`;
  return `[${type}_${digest.slice(0, 8)}]`;
}

export interface TokenRun {
  /** Entity type of the run's first token, used for the pseudonym's readable prefix. */
  type: string;
  /** Index in the redacted text where the run starts. */
  start: number;
  /** Index in the redacted text just past the run. */
  end: number;
}

/**
 * Consecutive placeholders with no literal text between them, grouped into one run.
 *
 * ADJACENT TOKENS ARE WHY THIS EXISTS. The live output contained
 * `[REDACTED_PERSON_12][REDACTED_PERSON_13]` — one name split across two placeholders. There is no way
 * to know where the first value ended and the second began, so the run is treated as ONE entity and gets
 * ONE pseudonym. That is not a compromise: a person's full name becoming a single stable token is
 * exactly the desired outcome, and it repairs the split that made the join even harder.
 */
export function tokenRuns(redacted: string): TokenRun[] {
  const runs: TokenRun[] = [];
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(redacted)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const type = match[1] ?? 'ENTITY';
    const last = runs[runs.length - 1];
    if (last && last.end === start) {
      last.end = end; // adjacent — extend the run, keeping the FIRST token's type
      continue;
    }
    runs.push({ type, start, end });
  }
  return runs;
}

/**
 * Rewrite every placeholder in `redacted` as a value-stable pseudonym.
 *
 * Aligns the two strings left to right: the literal text between placeholders must appear in `original`
 * in the same order, and whatever sits between two literals in `original` is the value that was replaced.
 *
 * Returns `redacted` UNCHANGED whenever the alignment does not hold exactly — a mismatch means we cannot
 * be sure which original substring a token stands for, and guessing risks emitting a raw value. That
 * fail-closed default is the invariant of this module.
 */
export function stabilizePseudonyms(original: string, redacted: string, salt: string): string {
  const runs = tokenRuns(redacted);
  if (runs.length === 0) return redacted;

  const out: string[] = [];
  let oi = 0; // cursor in `original`
  let ri = 0; // cursor in `redacted`

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    // The literal immediately before this run must sit exactly at the original cursor: everything
    // earlier has already been consumed, so anything else means the two strings have diverged.
    const before = redacted.slice(ri, run.start);
    if (original.slice(oi, oi + before.length) !== before) return redacted;
    oi += before.length;
    out.push(before);

    // The value ends where the NEXT literal begins in `original`. The next literal runs from the end of
    // this token run to the start of the following run (or to the end of the text).
    const nextStart = i + 1 < runs.length ? runs[i + 1].start : redacted.length;
    const after = redacted.slice(run.end, nextStart);

    let value: string;
    if (after.length === 0) {
      // Nothing follows — the replaced value runs to the end of the original.
      value = original.slice(oi);
      oi = original.length;
    } else {
      // First occurrence at or after the cursor. Deterministic; can land early only when the value
      // itself contains the following literal, which would then fail the next iteration's exact-match
      // check and fall back to the redacted text rather than emit anything raw.
      const found = original.indexOf(after, oi);
      if (found < 0) return redacted;
      value = original.slice(oi, found);
      oi = found;
    }
    if (value.length === 0) return redacted; // a placeholder standing for nothing means we mis-aligned

    out.push(stablePseudonym(run.type, value, salt));
    ri = run.end;
  }

  // Whatever trails the last placeholder must match exactly, or the alignment was wrong all along.
  const tail = redacted.slice(ri);
  if (original.slice(oi) !== tail) return redacted;
  out.push(tail);

  return out.join('');
}
