// ─── Business references the masker must not eat — PURE ────────────────────────────────────────────
//
// LIVE FINDING (2026-08-01), on the review screen a BFSI approver actually uses:
//
//   "claim_no":"EXP-[PHONE]"          ← the claim number EXP-2025-00001
//   "used":"76658.39[REDACTED_IP_ADDRESS_109]73341.61"   ← two decimals read as an IP address
//
// The PII engine matched a claim reference as a phone number and a run of decimals as an IP. So the
// reviewer could not see WHICH claim they were approving, and — worse — the model was handed the same
// mangled text, which is how a run ends up unable to decide. This is the "masking breaks entity
// identity" class again: when governance appears to break utility, the representation is usually at
// fault before the policy is.
//
// THE FIX IS NOT TO WEAKEN MASKING. It is to hand the engine text where a business reference cannot be
// mistaken for PII: each reference is swapped for an opaque token before the scan and put back after.
// The engine still sees — and still masks — every name, email, card and number around it.
//
// SAFETY. Only tightly anchored, unmistakably non-personal formats are protected, each requiring a
// literal prefix or a document-style shape. A phone number, an Aadhaar, a PAN or an account number can
// never match these patterns, so nothing that IS personal is smuggled past the engine. Round-tripping
// is exact: the same token maps back to the same original, and unmatched tokens are left alone.

/** Anchored formats that identify a RECORD, never a person. */
const PROTECTED_PATTERNS: { name: string; re: RegExp }[] = [
  // Claim / expense / invoice / policy / case references: 2–5 uppercase letters, a dash, then
  // dash-separated digit groups. e.g. EXP-2025-00001, CLM-2026-14, POL-2025-000913, INV-2024-77.
  { name: 'REFERENCE', re: /\b[A-Z]{2,5}-\d{2,4}(?:-\d{1,8})+\b/g },
  // A year-prefixed serial used by several Indian insurers: 2025/MOT/00042.
  { name: 'REFERENCE', re: /\b(?:19|20)\d{2}\/[A-Z]{2,6}\/\d{2,8}\b/g },
  // A FISCAL YEAR — "2025-2026", "2025-26". Live, this came through as "Fy [PHONE]": eight digits with
  // a dash is a plausible phone number to a generic recognizer, and a financial year is the least
  // personal value in a BFSI record.
  { name: 'FISCAL_YEAR', re: /\b(?:19|20)\d{2}-(?:(?:19|20)\d{2}|\d{2})\b/g },
];

export interface ProtectedText {
  /** The text with each protected reference replaced by an opaque token. */
  text: string;
  /** token → original. Empty when nothing was protected. */
  restore: Map<string, string>;
}

// A token shape no scanner recognises as anything: no digits in a phone-like run, no dots, no @.
const token = (i: number) => `OGREFZZ${i}ZZ`;

/** Swap protected references out. Same input ⇒ same tokens, so this is deterministic and testable. */
export function protectReferences(text: string): ProtectedText {
  if (!text) return { text, restore: new Map() };
  const restore = new Map<string, string>();
  const seen = new Map<string, string>();
  let out = text;
  for (const { re } of PROTECTED_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags), (match) => {
      const existing = seen.get(match);
      if (existing) return existing;
      const t = token(seen.size);
      seen.set(match, t);
      restore.set(t, match);
      return t;
    });
  }
  return { text: out, restore };
}

/**
 * Put the references back. Applied to whatever the engine returned — including its redacted text — so
 * the reviewer reads the real claim number next to the correctly masked name beside it.
 */
export function restoreReferences(text: string | null | undefined, restore: Map<string, string>): string {
  if (!text) return text ?? '';
  if (!restore.size) return text;
  let out = text;
  for (const [t, original] of restore) out = out.split(t).join(original);
  return out;
}

/** True when the text carries at least one reference worth protecting. Cheap pre-check for callers. */
export function hasProtectedReference(text: string): boolean {
  return PROTECTED_PATTERNS.some(({ re }) => new RegExp(re.source).test(text));
}
