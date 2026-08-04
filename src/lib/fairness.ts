// ─── Does this app decide differently for different groups? ───────────────────────────────────────────
//
// `WHATS_MISSING_2.md` #5: **zero fairness or bias checks exist** — on a tenant whose live apps underwrite
// personal loans and assess death claims. Three quality checks per pipeline cover grounding, relevance and
// PII; none asks whether outcomes skew by any attribute. For credit decisions this is the exposure a
// regulator opens with.
//
// The measurement standard here is the one lending regulators actually use: compare each group's SELECTION
// RATE (share approved) against the best-performing group. A ratio below 0.8 — the four-fifths rule — is
// the long-established threshold for adverse impact worth investigating. It is a screen, not a verdict:
// a ratio below 0.8 means "explain this", not "you discriminated".
//
// ── WHAT THIS REFUSES TO DO, AND WHY IT MATTERS MORE THAN WHAT IT DOES ──
// A fairness number computed from a handful of cases is worse than no fairness number, because it will be
// quoted. Measured on this tenant: the loan app has THREE decided cases. Any "approval rate by city" from
// three cases is noise that reads as evidence, and a regulator shown it would be right to dismiss
// everything around it. So:
//   · a group under MIN_PER_GROUP is reported as untestable, never scored;
//   · a protected attribute that is not in the data is reported as ABSENT, never imputed — inferring
//     someone's gender or religion from their name to audit fairness would create the very profiling the
//     audit exists to prevent;
//   · an attribute with near-unique values (a name, an id) is not a group and is refused outright.
//
// Pure. Zero IO.

export interface DecidedCase {
  /** Case/run id, so a finding can be traced to real records. */
  id: string;
  /** True when the decision went the applicant's way (approved/accepted). */
  approved: boolean;
  /** Group attributes for this case: attribute name → value. Missing attributes simply absent. */
  attributes: Readonly<Record<string, string>>;
}

/**
 * Below this many decided cases in a group, no rate is reported for it.
 *
 * 20 is deliberately modest — it is the point at which a proportion stops swinging wildly on one case,
 * not a claim of statistical power. The number is stated on the surface so a reader knows what they are
 * waiting for rather than seeing an empty panel.
 */
export const MIN_PER_GROUP = 20;

/** The four-fifths rule: below this ratio, adverse impact is worth investigating. */
export const ADVERSE_IMPACT_RATIO = 0.8;

/** An attribute whose values are this unique is an identifier, not a group. */
const MAX_DISTINCT_SHARE = 0.5;

export interface GroupRate {
  value: string;
  decided: number;
  approved: number;
  /** Share approved, 0..1. Null when the group is under MIN_PER_GROUP. */
  rate: number | null;
}

export type FairnessVerdict =
  | 'not-enough-data'
  | 'not-a-group'
  | 'within-threshold'
  | 'investigate';

export interface FairnessFinding {
  attribute: string;
  groups: GroupRate[];
  /** Testable groups only — those at or above MIN_PER_GROUP. */
  testable: number;
  /** Lowest rate ÷ highest rate across testable groups. Null when fewer than two are testable. */
  ratio: number | null;
  verdict: FairnessVerdict;
  /** One sentence for a DPO. Never states a conclusion the data cannot support. */
  sentence: string;
}

/**
 * Test one attribute for adverse impact.
 *
 * Returns a finding in every case, including the ones where nothing can be concluded — a fairness surface
 * that simply omits untestable attributes lets a reader believe they were tested and passed.
 */
export function testAttribute(
  cases: readonly DecidedCase[],
  attribute: string,
  minPerGroup = MIN_PER_GROUP,
): FairnessFinding {
  const withValue = cases.filter((c) => (c.attributes[attribute] ?? '').trim() !== '');
  const buckets = new Map<string, { decided: number; approved: number }>();
  for (const c of withValue) {
    const v = c.attributes[attribute].trim();
    const b = buckets.get(v) ?? { decided: 0, approved: 0 };
    b.decided++;
    if (c.approved) b.approved++;
    buckets.set(v, b);
  }

  // An identifier masquerading as a group. Refused before any arithmetic, because "approval rate by
  // customer name" is one case per group and would report every applicant as their own disparity.
  if (withValue.length > 0 && buckets.size / withValue.length > MAX_DISTINCT_SHARE && buckets.size > 2) {
    return {
      attribute,
      groups: [],
      testable: 0,
      ratio: null,
      verdict: 'not-a-group',
      sentence: `“${attribute}” is close to unique per case, so it identifies people rather than grouping them. It cannot be tested for fairness.`,
    };
  }

  const groups: GroupRate[] = [...buckets.entries()]
    .map(([value, b]) => ({
      value,
      decided: b.decided,
      approved: b.approved,
      rate: b.decided >= minPerGroup ? b.approved / b.decided : null,
    }))
    .sort((a, b) => b.decided - a.decided);

  const rated = groups.filter((g): g is GroupRate & { rate: number } => g.rate !== null);
  if (rated.length < 2) {
    const short = groups.length - rated.length;
    return {
      attribute,
      groups,
      testable: rated.length,
      ratio: null,
      verdict: 'not-enough-data',
      sentence:
        withValue.length === 0
          ? `No decided case records “${attribute}”, so this app cannot be tested on it.`
          : `Not enough decided cases yet to test “${attribute}” — ${short} of ${groups.length} ${groups.length === 1 ? 'group has' : 'groups have'} fewer than ${minPerGroup}. A rate from fewer than that would move on a single case.`,
    };
  }

  const best = Math.max(...rated.map((g) => g.rate));
  const worst = Math.min(...rated.map((g) => g.rate));
  // A best rate of zero means nobody in any group was approved — a ratio would be 0/0. Not a disparity.
  const ratio = best === 0 ? 1 : worst / best;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const lowest = rated.find((g) => g.rate === worst)!;
  const highest = rated.find((g) => g.rate === best)!;

  if (ratio < ADVERSE_IMPACT_RATIO) {
    return {
      attribute,
      groups,
      testable: rated.length,
      ratio,
      verdict: 'investigate',
      // "Worth investigating", not "is biased". The screen identifies a gap to explain; a legitimate
      // business reason may explain it, and asserting discrimination from a ratio would be wrong.
      sentence: `Approval differs by “${attribute}”: ${pct(worst)} for ${lowest.value} against ${pct(best)} for ${highest.value} (ratio ${ratio.toFixed(2)}, below the ${ADVERSE_IMPACT_RATIO} threshold). This is worth explaining — there may be a legitimate reason, but it should be on record.`,
    };
  }
  return {
    attribute,
    groups,
    testable: rated.length,
    ratio,
    verdict: 'within-threshold',
    sentence: `Approval is broadly even across “${attribute}” — the lowest group is ${pct(worst)} against ${pct(best)} for the highest (ratio ${ratio.toFixed(2)}, at or above the ${ADVERSE_IMPACT_RATIO} threshold).`,
  };
}

export interface AttributeCoverage {
  attribute: string;
  /** How many decided cases actually record this attribute. */
  recorded: number;
  /** Out of how many decided cases. */
  of: number;
}

export interface FairnessReport {
  decided: number;
  findings: FairnessFinding[];
  /** Protected attributes we looked for and did NOT find in the decision records. */
  absent: string[];
  /**
   * How completely each attribute is recorded across decided cases.
   *
   * The actionable half. "Not enough cases" tells a DPO to wait; "only 1 of 10 decided cases records the
   * expense category" tells them the records themselves are the problem, which they can fix.
   */
  coverage: AttributeCoverage[];
  /** What to do to make the untestable attributes testable. Empty when nothing is missing. */
  remedy: string | null;
  /** Headline for the surface. */
  sentence: string;
}

/**
 * The attributes a lending or insurance regulator would ask about.
 *
 * Listed so their ABSENCE is reported. An app that cannot be tested on any of them is not a fair app; it
 * is an untested one, and those are different claims.
 */
export const PROTECTED_ATTRIBUTES = ['gender', 'age_band', 'city', 'state', 'religion', 'caste'] as const;

/**
 * Test every attribute present on the decided cases, and report which protected ones are missing.
 *
 * `absent` is the part a DPO needs most: "we tested city and state, and the records do not carry gender or
 * age, so those are untested" is a defensible position. Silence about them is not.
 */
export function fairnessReport(
  cases: readonly DecidedCase[],
  minPerGroup = MIN_PER_GROUP,
): FairnessReport {
  const present = new Set<string>();
  for (const c of cases) for (const k of Object.keys(c.attributes)) present.add(k);

  const findings = [...present]
    .sort()
    .map((a) => testAttribute(cases, a, minPerGroup))
    .filter((f) => f.verdict !== 'not-a-group');

  const absent = PROTECTED_ATTRIBUTES.filter((p) => !present.has(p));
  const coverage: AttributeCoverage[] = [...present]
    .sort()
    .map((a) => ({
      attribute: a,
      recorded: cases.filter((c) => (c.attributes[a] ?? '').trim() !== '').length,
      of: cases.length,
    }))
    .sort((x, y) => y.recorded - x.recorded);
  // Named as a recording gap, because that is what it is and it is fixable. Silence here leaves a DPO
  // believing the platform cannot do fairness, when in fact the decisions simply do not carry the fields.
  const remedy =
    absent.length > 0
      ? `To test for adverse impact on ${absent.join(', ')}, the decision record has to carry ${absent.length === 1 ? 'it' : 'them'}. None of these reach the app's case records today, so those attributes are untested rather than clear.`
      : null;
  const flagged = findings.filter((f) => f.verdict === 'investigate');
  const tested = findings.filter((f) => f.verdict !== 'not-enough-data');

  let sentence: string;
  if (cases.length === 0) {
    sentence = 'This app has not decided any cases yet, so there is nothing to test for fairness.';
  } else if (flagged.length > 0) {
    sentence = `${flagged.length} of ${findings.length} attributes show an approval gap worth explaining, across ${cases.length} decided cases.`;
  } else if (tested.length === 0) {
    // The honest majority case early on, and it must not read as a pass.
    sentence = `${cases.length} decided ${cases.length === 1 ? 'case' : 'cases'} so far — not yet enough to test any attribute for fairness, so this app is UNTESTED rather than clear.`;
  } else {
    sentence = `No approval gaps beyond the ${ADVERSE_IMPACT_RATIO} threshold across ${tested.length} tested ${tested.length === 1 ? 'attribute' : 'attributes'}, over ${cases.length} decided cases.`;
  }
  return { decided: cases.length, findings, absent, coverage, remedy, sentence };
}
