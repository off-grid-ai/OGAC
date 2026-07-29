// ─── Keep the qualifier the description already gave a data phrase — pure ─────────────────────────
//
// B3.1. Compiling "When an employee submits an EXPENSE CLAIM, read the claim, check that employee's
// remaining reimbursement quota, …" produced a step bound to the org's INSURANCE `claims` table
// instead of `expense claims`. Both domains are declared and real; the step's extracted phrase was
// the bare word "claim", which is a near-exact match for the domain labelled "claims", so the
// resolver bound it outright and correctly — it was never given the qualifier.
//
// That is worse than a visible failure: the app compiles, validates and runs, and silently reads the
// wrong table. It breaks "it inherits your data" quietly, which is exactly the class of defect a
// non-technical author cannot be expected to notice.
//
// The description already contains the answer. "expense claim" appears in it, one clause earlier. So
// before resolving a bare phrase, look for that phrase in the description preceded by an adjacent
// qualifier and resolve the LONGER form first. Nothing is invented: a qualifier is only used if the
// author actually wrote it, immediately before the phrase.

/** Words that are never a meaningful qualifier — articles, prepositions and sentence glue. */
const STOP_QUALIFIERS = new Set([
  'a', 'an', 'the', 'this', 'that', 'those', 'these', 'their', 'its', 'his', 'her', 'our', 'your',
  'my', 'each', 'every', 'any', 'some', 'and', 'or', 'but', 'if', 'when', 'then', 'read', 'check',
  'get', 'fetch', 'load', 'look', 'up', 'from', 'in', 'on', 'of', 'for', 'to', 'with', 'by', 'at',
  'submits', 'submit', 'submitted', 'new', 'incoming', 'first', 'next', 'same', 'given', 'one',
]);

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Candidate phrasings for a data phrase, most specific first.
 *
 * Always ends with the original phrase, so this can only ADD attempts — a caller that finds no
 * qualified match behaves exactly as before. Returns at most a couple of extra candidates: one and
 * two qualifier words, which covers "expense claim" and "employee expense claim" without turning
 * into a combinatorial search over the sentence.
 */
export function qualifiedPhrases(phrase: string, description: string): string[] {
  const clean = (phrase ?? '').trim();
  if (!clean) return [];
  const target = clean.toLowerCase();
  const words = (description ?? '').split(/\s+/).filter(Boolean);
  const normalized = words.map(normalizeWord);
  const targetWords = target.split(/\s+/).map(normalizeWord).filter(Boolean);
  if (targetWords.length === 0) return [clean];

  const candidates: string[] = [];
  // Find every place the author wrote this phrase, and look at what sits immediately before it.
  for (let i = 0; i + targetWords.length <= normalized.length; i++) {
    const matches = targetWords.every((w, k) => normalized[i + k] === w);
    if (!matches) continue;
    for (const span of [1, 2]) {
      const start = i - span;
      if (start < 0) continue;
      const qualifiers = normalized.slice(start, i);
      // Every word in the span must be a real qualifier — one stop word disqualifies the span, so
      // "the claim" and "submits an expense claim" never become phrases.
      if (qualifiers.some((q) => !q || STOP_QUALIFIERS.has(q))) continue;
      candidates.push([...qualifiers, ...targetWords].join(' '));
    }
  }

  // Longest first (most specific), de-duplicated, with the bare phrase last as the fallback.
  const ordered = [...new Set(candidates)].sort((a, b) => b.length - a.length);
  return [...ordered, clean];
}

/**
 * Resolve a data phrase against declared domains, preferring the qualified reading.
 *
 * `resolve` is the caller's real resolution rule (`resolveDomain`), passed in so this module stays
 * pure and the no-guess semantics stay in one place: each candidate is resolved by the SAME rule, and
 * the first confident hit wins. A phrase the author never qualified resolves exactly as it always did.
 */
export function resolveQualifiedPhrase<T>(
  phrase: string,
  description: string,
  resolve: (candidate: string) => T | null,
): { resolved: T | null; matchedPhrase: string } {
  const candidates = qualifiedPhrases(phrase, description);
  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (resolved) return { resolved, matchedPhrase: candidate };
  }
  return { resolved: null, matchedPhrase: (phrase ?? '').trim() };
}
