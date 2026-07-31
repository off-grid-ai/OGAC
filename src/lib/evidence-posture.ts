// ─── Evidence posture — pure ───────────────────────────────────────────────────────────────────────
//
// `/governance/evidence` promised "Evidence posture and coverage" and rendered four link cards with no
// numbers on them. Every other overview in the console leads with counts — Policy decisions shows
// "DECISIONS 1 · ALLOWED 0 · DENIED 1" — so this one read as a menu wearing an overview's title. On a
// compliance surface it is worse than plain: a reviewer cannot tell "nothing has been recorded" from
// "we didn't look".
//
// This module turns raw ledger counts into what each card should say. Pure so the arithmetic and the
// wording are testable without a database, and so the reader stays a thin query.

export interface EvidenceCounts {
  /** Total accountability events in the window. */
  audit: number;
  /** Events whose outcome was a refusal — blocked or denied. */
  refused: number;
  /** Runs carrying a verifiable signature. */
  signed: number;
  /** Configured export destinations. */
  exporters: number;
}

export interface EvidenceCard {
  key: 'audit' | 'security' | 'provenance' | 'export';
  /** The number to show, or null when it could not be read — never 0 as a stand-in. */
  value: number | null;
  /** What the number counts, in a reviewer's words. */
  unit: string;
  /** Shown when the count is genuinely zero, so "none" reads as a finding rather than a blank. */
  emptyNote: string;
}

/**
 * Describe each evidence card from the counts.
 *
 * A `null` count means the read FAILED and the card says so, distinct from a real zero. That distinction
 * is the whole reason this exists: on a compliance page, "0 blocked events" and "we could not query the
 * ledger" have opposite meanings and the same appearance if you are careless.
 */
export function evidenceCards(counts: Partial<EvidenceCounts> | null): EvidenceCard[] {
  const n = (v: number | undefined): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  return [
    {
      key: 'audit',
      value: n(counts?.audit),
      unit: 'events recorded',
      emptyNote: 'No accountability events yet — they appear as soon as anything runs.',
    },
    {
      key: 'security',
      value: n(counts?.refused),
      unit: 'refusals recorded',
      emptyNote: 'Nothing has been blocked or denied. That is a good posture, not a gap.',
    },
    {
      key: 'provenance',
      value: n(counts?.signed),
      unit: 'signed answers',
      emptyNote: 'No signed answers yet — runs are signed as they complete.',
    },
    {
      key: 'export',
      value: n(counts?.exporters),
      unit: 'destinations configured',
      emptyNote: 'No destinations yet. Evidence can still be downloaded directly.',
    },
  ];
}

/** True when every card failed to read — the page should say so rather than show four dashes. */
export function allUnreadable(cards: readonly EvidenceCard[]): boolean {
  return cards.length > 0 && cards.every((c) => c.value === null);
}
