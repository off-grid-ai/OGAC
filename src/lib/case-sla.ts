// ─── How long a case may sit before someone is chased ────────────────────────────────────────────────
//
// A case waiting ten minutes and one waiting ten days differed only in a line of text. No due date, no
// escalation, nothing that ever forced the pile to move — which is how this tenant ended up with cases
// sitting ten days under "nobody has picked this up".
//
// Pure. Zero IO.

/** A per-app promise: decide within this many hours of the case arriving. */
export interface SlaRule {
  appId: string;
  /** Hours. 0 or absent means the app makes no promise, which is a real answer, not a default. */
  hours: number;
  /** Who gets told when it is breached. Empty = whoever can decide. */
  escalateTo?: string;
}

export type SlaState = 'no-promise' | 'on-time' | 'due-soon' | 'overdue';

export interface SlaStatus {
  state: SlaState;
  /** Hours remaining; negative once overdue. Null when the app makes no promise. */
  hoursLeft: number | null;
  /** What the row says. Never a bare timestamp. */
  label: string;
  /** True when this case should be chased. */
  breached: boolean;
}

/** Inside this fraction of the window remaining, a case is "due soon" rather than merely on time. */
const SOON_FRACTION = 0.25;

/**
 * Where a case stands against its app's promise.
 *
 * "No promise" is deliberately its own state rather than being folded into "on time". An app nobody has
 * set a target for is not meeting a target — saying it is on time would be inventing a commitment the
 * organisation never made, and it hides that the target is missing.
 */
export function slaStatus(
  waitingSinceIso: string,
  rule: SlaRule | undefined,
  now: Date,
): SlaStatus {
  const hours = rule?.hours ?? 0;
  if (!Number.isFinite(hours) || hours <= 0) {
    return {
      state: 'no-promise',
      hoursLeft: null,
      label: 'No target set for this process',
      breached: false,
    };
  }

  const started = Date.parse(waitingSinceIso);
  if (!Number.isFinite(started)) {
    // An unreadable arrival time cannot be judged. Saying so beats presenting it as on time.
    return {
      state: 'no-promise',
      hoursLeft: null,
      label: 'Arrival time not recorded, so it cannot be timed',
      breached: false,
    };
  }

  const elapsedH = (now.getTime() - started) / 3_600_000;
  const left = hours - elapsedH;

  if (left < 0) {
    const over = Math.abs(left);
    return {
      state: 'overdue',
      hoursLeft: left,
      label:
        over >= 48
          ? `Overdue by ${Math.round(over / 24)} days`
          : `Overdue by ${Math.max(1, Math.round(over))} hours`,
      breached: true,
    };
  }
  if (left <= hours * SOON_FRACTION) {
    return {
      state: 'due-soon',
      hoursLeft: left,
      label: left < 1 ? 'Due within the hour' : `Due in ${Math.round(left)} hours`,
      breached: false,
    };
  }
  return {
    state: 'on-time',
    hoursLeft: left,
    label: left >= 48 ? `Due in ${Math.round(left / 24)} days` : `Due in ${Math.round(left)} hours`,
    breached: false,
  };
}

/** Ordering weight — overdue first, then due soon, then everything else. */
export function slaWeight(s: SlaState): number {
  if (s === 'overdue') return 0;
  if (s === 'due-soon') return 1;
  if (s === 'on-time') return 2;
  return 3;
}

export interface BreachSummary {
  overdue: number;
  dueSoon: number;
  /** Apps with waiting work and NO target set — the reason a pile can grow unnoticed. */
  untargeted: string[];
  /** One sentence, or null when there is nothing worth saying. */
  message: string | null;
}

/**
 * What to tell the person looking at the queue.
 *
 * Returns null when nothing is overdue and nothing is missing a target. A banner that always says
 * something gets skipped, and then the one that matters is skipped with it.
 */
export function summariseBreaches(
  statuses: readonly { appTitle: string; status: SlaStatus }[],
): BreachSummary {
  const overdue = statuses.filter((s) => s.status.state === 'overdue').length;
  const dueSoon = statuses.filter((s) => s.status.state === 'due-soon').length;
  const untargeted = [
    ...new Set(
      statuses.filter((s) => s.status.state === 'no-promise').map((s) => s.appTitle),
    ),
  ];

  const parts: string[] = [];
  if (overdue > 0) {
    parts.push(
      `${overdue} case${overdue === 1 ? ' is' : 's are'} past the time this organisation promised to decide ${overdue === 1 ? 'it' : 'them'}.`,
    );
  }
  if (overdue === 0 && dueSoon > 0) {
    parts.push(`${dueSoon} case${dueSoon === 1 ? ' is' : 's are'} due soon.`);
  }
  if (untargeted.length > 0) {
    parts.push(
      `No decision target is set for ${untargeted.length === 1 ? untargeted[0] : `${untargeted.length} processes`}, so nothing will ever flag as late.`,
    );
  }

  return {
    overdue,
    dueSoon,
    untargeted,
    message: parts.length > 0 ? parts.join(' ') : null,
  };
}
