// ─── Who certified this access list, and when ──────────────────────────────────────────────────────
//
// Every access framework asks the same question: who last confirmed that each of these people should
// still have this access, and when. The console could list users and change roles, but there was no
// record that anyone had ever REVIEWED the list — no artefact, no date, no reviewer. An auditor asking
// "show me your last access review" got nothing.
//
// This is the pure half: what needs a reviewer's attention, and whether a review is overdue. Zero IO.

/** A person on the list, as far as the review cares. */
export interface ReviewSubject {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  /** Last time they actually used the console; null = never seen. */
  lastActiveAt?: Date | null;
}

export type ReviewDecision = 'keep' | 'revoke' | 'change-role';

export interface SubjectDecision {
  userId: string;
  email: string;
  decision: ReviewDecision;
  /** Required for revoke and change-role — a decision with no reason is not reviewable. */
  reason?: string;
  /** The role to move them to, when the decision is change-role. */
  newRole?: string;
}

/** Days without a sign-in after which an account is worth questioning. */
export const DORMANT_DAYS = 60;

export interface AttentionFlag {
  userId: string;
  /** Short reason, in the reviewer's language. */
  why: string;
  severity: 'high' | 'medium';
}

/**
 * What a reviewer should look at first. A review where every row looks identical gets rubber-stamped,
 * which is the failure mode these artefacts are famous for — so the rows that carry actual risk are
 * called out and ordered.
 */
export function attentionFlags(
  subjects: readonly ReviewSubject[],
  now: Date,
): AttentionFlag[] {
  const flags: AttentionFlag[] = [];
  for (const s of subjects) {
    const dormantFor = s.lastActiveAt
      ? Math.floor((now.getTime() - s.lastActiveAt.getTime()) / 86_400_000)
      : null;

    if (s.role === 'admin' && dormantFor === null) {
      flags.push({
        userId: s.id,
        why: 'Full admin access and has never signed in',
        severity: 'high',
      });
    } else if (s.role === 'admin' && dormantFor !== null && dormantFor >= DORMANT_DAYS) {
      flags.push({
        userId: s.id,
        why: `Full admin access, not used for ${dormantFor} days`,
        severity: 'high',
      });
    } else if (dormantFor === null) {
      flags.push({ userId: s.id, why: 'Has never signed in', severity: 'medium' });
    } else if (dormantFor >= DORMANT_DAYS) {
      flags.push({ userId: s.id, why: `Not used for ${dormantFor} days`, severity: 'medium' });
    } else if (s.role === 'admin') {
      flags.push({ userId: s.id, why: 'Full admin access', severity: 'medium' });
    }
  }
  return flags.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * A review is only an artefact if it is COMPLETE and REASONED: every person on the list has a
 * decision, any decision that takes access away says why, and — the part that decides whether this is
 * evidence or theatre — KEEPING someone the review itself flagged as high risk also says why.
 *
 * Without that last rule the artefact's worst line is silent. Exercising this control for real on the
 * demo tenant produced exactly that: "full admin access and has never signed in" → kept, no reason
 * recorded. An auditor reading it learns that the risk was seen and waved through, and cannot tell
 * whether anybody thought about it. A rubber stamp on the one row that matters is the failure mode
 * these reviews are famous for, and attentionFlags already knows which row it is.
 *
 * `now` is passed so the flags are computed against the same instant the caller judged — never
 * defaulted to a fresh clock inside a validator.
 */
export function validateReview(
  subjects: readonly ReviewSubject[],
  decisions: readonly SubjectDecision[],
  now: Date = new Date(),
  /**
   * Whether last-activity is actually KNOWN for these subjects.
   *
   * When the activity ledger is unreachable every subject arrives with lastActiveAt null, which
   * attentionFlags correctly reads as "has never signed in" — but that finding would be fabricated by
   * the outage, not observed. Demanding a written justification on the strength of it would block a
   * legitimate review with an invented reason, so the flagged-keep rule stands down and the rest of the
   * validation still applies.
   */
  { activityKnown = true }: { activityKnown?: boolean } = {},
): ValidationResult {
  const errors: string[] = [];
  const byUser = new Map(decisions.map((d) => [d.userId, d]));
  const highRisk = new Map(
    activityKnown
      ? attentionFlags(subjects, now)
          .filter((f) => f.severity === 'high')
          .map((f) => [f.userId, f.why] as const)
      : [],
  );

  const undecided = subjects.filter((s) => !byUser.has(s.id));
  if (undecided.length) {
    errors.push(
      `${undecided.length} ${undecided.length === 1 ? 'person has' : 'people have'} no decision yet: ${undecided
        .slice(0, 5)
        .map((s) => s.email)
        .join(', ')}${undecided.length > 5 ? '…' : ''}`,
    );
  }

  for (const d of decisions) {
    if ((d.decision === 'revoke' || d.decision === 'change-role') && !d.reason?.trim()) {
      errors.push(`${d.email}: say why access is being ${d.decision === 'revoke' ? 'removed' : 'changed'}`);
    }
    if (d.decision === 'change-role' && !d.newRole?.trim()) {
      errors.push(`${d.email}: pick the role to move them to`);
    }
    // Keeping a high-risk account is a legitimate decision — it just has to be a decision, not a blank.
    if (d.decision === 'keep' && highRisk.has(d.userId) && !d.reason?.trim()) {
      errors.push(
        `${d.email}: ${highRisk.get(d.userId)?.toLowerCase()} — say why this access is being kept`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/** One line an auditor can read off the record. */
export function summariseReview(decisions: readonly SubjectDecision[]): string {
  const n = (d: ReviewDecision) => decisions.filter((x) => x.decision === d).length;
  const parts = [`${n('keep')} confirmed`];
  if (n('revoke')) parts.push(`${n('revoke')} removed`);
  if (n('change-role')) parts.push(`${n('change-role')} moved to a different role`);
  return `${decisions.length} ${decisions.length === 1 ? 'person' : 'people'} reviewed — ${parts.join(', ')}`;
}

/** Standard recertification cadence. Quarterly is what most frameworks expect. */
export const REVIEW_CADENCE_DAYS = 90;

export interface ReviewDueness {
  due: boolean;
  /** Days until due, negative when overdue; null when no review has ever been recorded. */
  daysUntilDue: number | null;
  message: string;
}

/**
 * Whether the org owes a review. The never-reviewed case is deliberately NOT reported as "due in 90
 * days" — an org that has never certified its access list is already out of compliance, and saying
 * otherwise would hide it.
 */
export function reviewDueness(
  lastCompletedAt: Date | null,
  now: Date,
  cadenceDays = REVIEW_CADENCE_DAYS,
): ReviewDueness {
  if (!lastCompletedAt) {
    return {
      due: true,
      daysUntilDue: null,
      message: 'Nobody has ever certified this access list',
    };
  }
  const elapsed = Math.floor((now.getTime() - lastCompletedAt.getTime()) / 86_400_000);
  const daysUntilDue = cadenceDays - elapsed;
  if (daysUntilDue < 0) {
    return {
      due: true,
      daysUntilDue,
      message: `Last certified ${elapsed} days ago — ${Math.abs(daysUntilDue)} days overdue`,
    };
  }
  return {
    due: false,
    daysUntilDue,
    message: `Certified ${elapsed} day${elapsed === 1 ? '' : 's'} ago · next due in ${daysUntilDue} days`,
  };
}
