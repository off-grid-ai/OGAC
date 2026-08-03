// ─── Cover: who handles the queue when someone is away ───────────────────────────────────────────────
//
// There is no delegation, no out-of-office and no reassignment, so one person on leave means their queue
// silently stalls. That is not hypothetical on this tenant — it is what the ten-day-old cases under
// "nobody has picked this up" actually are.
//
// This is the pure half. Zero IO.

export interface CoverWindow {
  /** Who is away. */
  away: string;
  /** Who picks their work up. Empty means "anyone who can decide" — see resolveCover. */
  coveredBy: string;
  /** ISO date, inclusive. */
  from: string;
  /** ISO date, inclusive — an open-ended absence is not a thing anyone plans, so this is required. */
  until: string;
  /** Optional note shown to whoever picks the work up. */
  note?: string;
}

export interface CoverValidation {
  ok: boolean
  errors: string[];
}

/** Midnight-anchored day comparison, so "until today" includes all of today. */
function dayOf(iso: string): number | null {
  const t = Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isFinite(t) ? Math.floor(t / 86_400_000) : null;
}

/**
 * Validate a cover window.
 *
 * The rules exist because each one, left out, produces a queue nobody is watching:
 *  - an absence with no end date never ends, and the cover silently becomes permanent;
 *  - covering yourself is a no-op that reads as cover;
 *  - a window that ended in the past is not cover, it is history, and accepting it as active would
 *    tell an operator their queue is covered when it is not.
 */
export function validateCover(w: CoverWindow, today: string): CoverValidation {
  const errors: string[] = [];
  const from = dayOf(w.from);
  const until = dayOf(w.until);
  const now = dayOf(today);

  if (!w.away.trim()) errors.push('Say who is away.');
  if (from === null) errors.push('Give a start date for the absence.');
  if (until === null) errors.push('Give an end date — cover with no end date never ends.');
  if (from !== null && until !== null && until < from) {
    errors.push('The absence ends before it starts.');
  }
  if (until !== null && now !== null && until < now) {
    errors.push('That window has already passed, so it would not cover anything.');
  }
  if (
    w.coveredBy.trim() &&
    w.away.trim().toLowerCase() === w.coveredBy.trim().toLowerCase()
  ) {
    errors.push('Someone cannot cover for themselves.');
  }
  return { ok: errors.length === 0, errors };
}

/** Whether a window is in force on a given day. */
export function isActive(w: CoverWindow, today: string): boolean {
  const from = dayOf(w.from);
  const until = dayOf(w.until);
  const now = dayOf(today);
  if (from === null || until === null || now === null) return false;
  return now >= from && now <= until;
}

export interface CoverDecision {
  /** Who should be told about this person's work today. */
  notify: string[];
  /** One sentence for the surface, or null when there is nothing to say. */
  note: string | null;
}

/**
 * Who to tell about a person's waiting work today.
 *
 * An ACTIVE cover window redirects the nudge to the person covering, and deliberately keeps the person
 * who is away OFF the list: emailing someone on leave about work they cannot do is how a team learns to
 * ignore these messages entirely.
 *
 * A window with no named cover falls back to everyone who can decide. That is worse than a named
 * person, and much better than silence — the failure being fixed is a queue nobody is watching.
 */
export function resolveCover(
  person: string,
  windows: readonly CoverWindow[],
  everyoneWhoCanDecide: readonly string[],
  today: string,
): CoverDecision {
  const active = windows.find(
    (w) => w.away.trim().toLowerCase() === person.trim().toLowerCase() && isActive(w, today),
  );
  if (!active) return { notify: [person], note: null };

  const named = active.coveredBy.trim();
  if (named) {
    return {
      notify: [named],
      note: `${person} is away until ${active.until}. ${named} is covering${active.note ? ` — ${active.note}` : ''}.`,
    };
  }
  const others = everyoneWhoCanDecide.filter(
    (e) => e.trim().toLowerCase() !== person.trim().toLowerCase(),
  );
  return {
    notify: others,
    note: `${person} is away until ${active.until} with nobody named to cover, so their work goes to everyone who can decide.`,
  };
}

/**
 * The warning a queue surface should show.
 *
 * Returns null when nothing is wrong. A banner that always says something gets skipped, and the state
 * worth interrupting someone about is narrow: work is piling up on a person who is away.
 */
export function stalledByAbsence(
  windows: readonly CoverWindow[],
  waitingByPerson: Readonly<Record<string, number>>,
  today: string,
): string | null {
  const stalled = Object.entries(waitingByPerson)
    .filter(([person, count]) => {
      if (count <= 0) return false;
      const w = windows.find(
        (x) => x.away.trim().toLowerCase() === person.trim().toLowerCase() && isActive(x, today),
      );
      return Boolean(w && !w.coveredBy.trim());
    })
    .map(([person, count]) => `${person} (${count})`);
  if (stalled.length === 0) return null;
  return `Work is waiting on someone who is away with no cover named: ${stalled.join(', ')}. Name someone to cover, or it will sit there.`;
}
