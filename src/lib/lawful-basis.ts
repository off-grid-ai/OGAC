// ─── On what basis are we allowed to process this? ─────────────────────────────────────────────────
//
// A DPO's first question about any processing is not "is it secure" but "are we allowed to do it at
// all" — the lawful basis — and the second is "is this the purpose we said we'd use it for". The
// platform recorded neither. There was nothing in the schema about consent or lawful basis.
//
// This is the pure half: the vocabulary, and the rules for resolving what a RUN relied on from the
// domains it read. Zero IO.
//
// Basis is recorded on the DATA DOMAIN, not per app, for the same reason classification is: the
// domain is what an app binds to, so a grade on the domain reaches every run through it. A basis
// recorded per app would have to be re-declared on every new app and would drift immediately.

/** DPDP 2023 lawful bases, plus the honest absence. Wording is the operator's, not the statute's. */
export const LAWFUL_BASES = [
  {
    id: 'consent',
    label: 'Consent',
    detail: 'The person agreed to this specific use and can withdraw.',
  },
  {
    id: 'contract',
    label: 'Performing a contract',
    detail: 'Needed to deliver something the person asked for — a policy, a loan, a claim.',
  },
  {
    id: 'legal-obligation',
    label: 'Required by law',
    detail: 'A regulator or statute requires us to hold or process this.',
  },
  {
    id: 'legitimate-use',
    label: 'Legitimate use',
    detail: 'Fraud prevention, security, or another use the law permits without consent.',
  },
  {
    id: 'employment',
    label: 'Employment',
    detail: 'Processing about our own staff for employment purposes.',
  },
  {
    // NOT a lawful basis — the honest answer when the question does not apply.
    //
    // Measured 2026-08-04: 14 data domains carried no basis, and most are business records — a pricing
    // rate card, a vendor list, the general ledger, branch data, competitor intel. DPDP lawful basis
    // governs PERSONAL data; there is no basis to record for a source that holds none. With only the five
    // real bases available, closing that gap meant either leaving them permanently flagged or stamping
    // something like "legitimate use" on a rate card — recording a fiction to make a governance surface
    // look complete, which is the worst option on the list.
    //
    // Kept LAST and labelled as a declaration rather than a basis, so a reader cannot mistake it for one.
    // `requiresBasis` below is what decides whether a source still owes a DPO decision.
    id: 'not-personal-data',
    label: 'No personal data (basis not applicable)',
    detail:
      'This source holds no personal data, so no lawful basis applies. A deliberate declaration, not an unanswered question — and it is wrong for anything that identifies a person, directly or in combination.',
  },
] as const;

/**
 * Does this source still owe a lawful-basis decision?
 *
 * `not-personal-data` is answered, so it does not. An empty basis does. Kept separate from
 * `isLawfulBasis` because "is this a valid value" and "is this source still a gap" are different
 * questions, and conflating them is how a declaration gets counted as a basis.
 */
export function requiresBasis(basis: string | null | undefined): boolean {
  const b = (basis ?? '').trim();
  return b === '' || b === 'unknown';
}

/** True when the recorded value is a real processing basis, not the not-applicable declaration. */
export function isProcessingBasis(basis: string | null | undefined): boolean {
  const b = (basis ?? '').trim();
  return b !== '' && b !== 'not-personal-data';
}

export type LawfulBasisId = (typeof LAWFUL_BASES)[number]['id'];

export function basisLabel(id: string | null | undefined): string {
  return LAWFUL_BASES.find((b) => b.id === id)?.label ?? 'No basis recorded';
}

export function isLawfulBasis(id: string): id is LawfulBasisId {
  return LAWFUL_BASES.some((b) => b.id === id);
}

/** A domain as far as this rule cares: what it reaches, why we may hold it, what it may be used for. */
export interface BasisBearingDomain {
  id: string;
  label: string;
  lawfulBasis?: string | null;
  /** The purpose this data may be used for, in the operator's words. Free text on purpose. */
  purpose?: string | null;
}

export interface RunBasis {
  /** Distinct bases the run relied on, in the order the domains were read. */
  bases: string[];
  /** Domains the run read that have NO basis recorded. A run with any of these is not defensible. */
  ungrounded: { id: string; label: string }[];
  /** The one-line answer to "on what basis did this run process personal data?" */
  summary: string;
}

/**
 * What a run relied on, from the domains its steps bound.
 *
 * The important behaviour is the failure case: a domain with no recorded basis is reported as
 * UNGROUNDED, never defaulted to consent or to "legitimate use". Quietly assuming a basis is exactly
 * the defect that makes a compliance record worthless.
 */
export function resolveRunBasis(domains: readonly BasisBearingDomain[]): RunBasis {
  const bases: string[] = [];
  const ungrounded: { id: string; label: string }[] = [];
  for (const d of domains) {
    const b = d.lawfulBasis?.trim();
    if (b && isLawfulBasis(b)) {
      if (!bases.includes(b)) bases.push(b);
    } else {
      ungrounded.push({ id: d.id, label: d.label });
    }
  }

  let summary: string;
  if (!domains.length) {
    summary = 'No personal data source was read';
  } else if (ungrounded.length && !bases.length) {
    summary = `No lawful basis recorded for ${ungrounded.length === 1 ? ungrounded[0].label : `${ungrounded.length} data sources`}`;
  } else if (ungrounded.length) {
    summary = `${bases.map(basisLabel).join(' + ')} — but ${ungrounded.length} source${ungrounded.length === 1 ? '' : 's'} has no basis recorded`;
  } else {
    summary = bases.map(basisLabel).join(' + ');
  }
  return { bases, ungrounded, summary };
}

/** True when the run is fully accounted for: every source it read has a recorded basis. */
export function basisComplete(basis: RunBasis): boolean {
  return basis.ungrounded.length === 0 && basis.bases.length > 0;
}

export interface PurposeConcern {
  domain: string;
  /** What the domain says its data may be used for. */
  permitted: string;
  detail: string;
}

/**
 * Purpose limitation. Data collected for one purpose may not be quietly repurposed, so an app that
 * reads a domain must be doing something the domain's stated purpose covers.
 *
 * This is deliberately a FLAG, not a block: matching purposes by text cannot be authoritative, and a
 * governance feature that silently blocks work on a fuzzy string match would be turned off within a
 * week. It raises the pairs a human should look at, and says why.
 */
export function purposeConcerns(
  appPurpose: string,
  domains: readonly BasisBearingDomain[],
): PurposeConcern[] {
  const app = appPurpose.trim().toLowerCase();
  const concerns: PurposeConcern[] = [];
  for (const d of domains) {
    const permitted = d.purpose?.trim();
    if (!permitted) {
      concerns.push({
        domain: d.label,
        permitted: 'not stated',
        detail: 'No purpose is recorded for this source, so nobody can say whether this use is one of them.',
      });
      continue;
    }
    if (!app) {
      concerns.push({
        domain: d.label,
        permitted,
        detail: 'This app does not state what it is for, so its use cannot be checked against the permitted purpose.',
      });
      continue;
    }
    // Shared significant words are weak evidence of the same purpose — enough to STOP flagging, not
    // enough to assert compliance. Anything with no overlap at all is worth a human's attention.
    const words = (s: string) => new Set(s.split(/[^a-z0-9]+/).filter((w) => w.length > 4));
    const permittedWords = words(permitted.toLowerCase());
    const overlap = [...words(app)].some((w) => permittedWords.has(w));
    if (!overlap) {
      concerns.push({
        domain: d.label,
        permitted,
        detail: `This app is for "${appPurpose.trim()}", which does not obviously fall under what this source was collected for. Confirm it does before relying on it.`,
      });
    }
  }
  return concerns;
}
