// ─── Which language the PII detector can actually work in ─────────────────────────────────────────────
//
// The capability map records this as an under-leveraged capability: "the adapter has a language parameter
// but every production call defaults to en. Add supported-language discovery, validation, and an org or
// pipeline setting."
//
// Half of that is right and half of it would break the tenant's PII protection. Measured against the
// deployed analyzer on 2026-08-04:
//
//   /supportedentities?language=en  → 200
//   /supportedentities?language=hi  → 500 {"error":"No matching recognizers were found to serve the request."}
//   ta, mr, es → 500 likewise
//
// So English is the ONLY language this deployment serves. A language setting offering Hindi today would
// send `hi`, the analyzer would 500, and the caller — which is fail-closed by design — would refuse every
// governed call. Adding the setting without the validation converts a working control into an outage.
//
// The second measurement is the one that matters for an Indian tenant, and it is reassuring:
//
//   analyze("ग्राहक का पैन ABCDE1234F और आधार 2345 6789 0123 है", language: "en")
//     → IN_PAN (0.6), PERSON (0.85)
//
// The Indian identifier recognizers are PATTERN-based, so they match in any script. Detection of Indian
// PII does not depend on a Hindi model; only name/place recognition in non-Latin script does, and that is
// worth saying out loud rather than implying full multilingual cover we do not have.
//
// Pure. Zero IO.

/** What the adapter falls back to, and the only language the audited deployment serves. */
export const DEFAULT_PII_LANGUAGE = 'en';

export interface LanguageResolution {
  /** The language to actually send to the analyzer. Never one it cannot serve. */
  language: string;
  /** True when the caller asked for something else and we substituted. */
  substituted: boolean;
  /**
   * Why, in operator language. Null when the request was served as asked.
   *
   * Stated rather than silent: a scan that quietly ran in the wrong language is a scan whose misses
   * nobody can account for.
   */
  note: string | null;
}

/**
 * Decide the language to scan in.
 *
 * `supported` is what the live analyzer reported. An EMPTY list means discovery failed — and then we send
 * the default rather than the request, because a 500 from an unsupported language is the difference
 * between "scanned in English" and "not scanned at all".
 */
export function resolveAnalyzerLanguage(
  requested: string | null | undefined,
  supported: readonly string[],
  fallback = DEFAULT_PII_LANGUAGE,
): LanguageResolution {
  const want = (requested ?? '').trim().toLowerCase();
  if (!want || want === fallback) return { language: fallback, substituted: false, note: null };

  const ok = supported.map((s) => s.toLowerCase());
  if (ok.includes(want)) return { language: want, substituted: false, note: null };

  if (ok.length === 0) {
    return {
      language: fallback,
      substituted: true,
      note: `Could not confirm which languages the detector serves, so it ran in ${fallback}. Requesting an unsupported language makes the detector fail, which would leave content unscanned.`,
    };
  }
  return {
    language: fallback,
    substituted: true,
    note: `This detector does not serve “${want}” — it serves ${ok.join(', ')}. It ran in ${fallback} instead. Identifiers matched by pattern (PAN, Aadhaar, voter ID, card and account numbers, email) are found in any script; names and places written in another script are matched less reliably.`,
  };
}

/**
 * What to tell an operator about the detector's language reach.
 *
 * Deliberately does NOT say "multilingual" when one language is served, and does not say "English only"
 * without the pattern-based caveat either — both would mislead an Indian tenant in opposite directions.
 */
export function describeLanguageReach(supported: readonly string[]): string {
  if (supported.length === 0) {
    return 'The detector did not report which languages it serves, so assume English only.';
  }
  if (supported.length === 1) {
    return `Detection runs in ${supported[0]}. Indian identifiers — PAN, Aadhaar, voter ID, card and account numbers, email — are matched by pattern and are found whatever script the surrounding text is in. Names and places written in another script are matched less reliably.`;
  }
  return `Detection can run in ${supported.length} languages: ${[...supported].sort().join(', ')}.`;
}
