// ─── Who owns this process ───────────────────────────────────────────────────────────────────────────
//
// CORRECTION to the second-pass report, which claimed there was no owner field. There is: apps.ownerId
// exists and is populated. Two things were true instead, and both are worse than a missing column:
//
//  1. It is never SHOWN on any app surface, so nobody can tell who maintains a process or who to ask.
//  2. Nothing checks whether the owner can actually act. Measured on this tenant: all three live apps
//     are owned by an account the access review flags as "full admin access and has never signed in".
//     An owner who has never logged in is an unowned process wearing a name.
//
// Pure. Zero IO.

export interface OwnerCheck {
  owner: string;
  /** Does the owner still have an account in this org? */
  known: boolean;
  /** Have they ever actually used the console? */
  active: boolean;
  /** Are they away today with no cover? */
  awayUncovered: boolean;
}

export type OwnershipState = 'ok' | 'unowned' | 'unknown-owner' | 'never-active' | 'away';

export interface OwnershipVerdict {
  state: OwnershipState;
  /** What the surface says. Null when ownership is fine and there is nothing to report. */
  warning: string | null;
}

/**
 * Whether this process actually has someone behind it.
 *
 * Each state is separate on purpose: "nobody is named", "the named person left", "the named person has
 * never signed in" and "they are away with no cover" have completely different fixes, and collapsing
 * them into one "ownership problem" would leave whoever reads it no better off.
 */
export function ownershipVerdict(check: OwnerCheck | null): OwnershipVerdict {
  if (!check || !check.owner.trim()) {
    return {
      state: 'unowned',
      warning: 'Nobody owns this process. When something breaks, there is no one to ask.',
    };
  }
  if (!check.known) {
    return {
      state: 'unknown-owner',
      warning: `${check.owner} owns this but no longer has an account here. It is effectively unowned.`,
    };
  }
  if (!check.active) {
    return {
      state: 'never-active',
      warning: `${check.owner} owns this and has never signed in. An owner who never logs in is a name, not an owner.`,
    };
  }
  if (check.awayUncovered) {
    return {
      state: 'away',
      warning: `${check.owner} owns this and is away with nobody covering.`,
    };
  }
  return { state: 'ok', warning: null };
}

/**
 * Who should be nudged about this app's waiting work.
 *
 * The owner, when they can actually act — that is the point of naming one, and it is far better than
 * mailing everyone with a role. It falls back to the wider list only when the owner cannot act, because
 * silence would be the worst option: the failure being fixed is a queue nobody is watching.
 */
export function nudgeTargets(
  check: OwnerCheck | null,
  coveringFor: Readonly<Record<string, string>>,
  everyoneWhoCanDecide: readonly string[],
): { to: string[]; why: string } {
  const verdict = ownershipVerdict(check);
  const owner = check?.owner.trim() ?? '';

  if (verdict.state === 'ok') return { to: [owner], why: 'the owner of this process' };

  if (verdict.state === 'away') {
    const standIn = coveringFor[owner.toLowerCase()];
    if (standIn) return { to: [standIn], why: `covering for ${owner}` };
  }
  return {
    to: everyoneWhoCanDecide.filter((e) => e.toLowerCase() !== owner.toLowerCase()),
    why:
      verdict.state === 'unowned'
        ? 'nobody owns this process'
        : `the owner (${owner}) cannot act on it`,
  };
}
