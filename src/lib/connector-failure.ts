// ─── Why a connector read failed — pure, so the reason can be rendered anywhere ──────────────────────
//
// A read that CANNOT run and a read that returns zero rows are completely different facts, and the console
// had been reporting them with the same sentence: "No rows returned from reimbursement quota
// (employee_quota)." The table held 500 rows. The read was failing on the connection and presenting as
// emptiness, so the agent downstream reasoned — correctly, from what it was given — that the employee had
// no quota, and declined the claim.
//
// That is the same defect class as the earlier "Result: (no output)": a failure wearing the costume of an
// empty answer. A governed run must never continue on one. So the failure now travels as a VALUE from the
// query seam, through the adapter's decision record, to the step result — and this module is the pure
// half: the taxonomy plus the sentence a person reads.

/** What went wrong, coarse enough to be stable and specific enough to act on. */
export type ConnectorFailureKind =
  /** The (type, endpoint) pair matches no live-query strategy. */
  | 'no-dialect'
  /** The resource name is not a safe SQL identifier, so it was never interpolated. */
  | 'unsafe-resource'
  /** The vaulted credential could not be resolved or injected. */
  | 'credential'
  /** The source was reached for but did not answer (auth refused, timeout, no such table, …). */
  | 'connection'
  /** A governed object/stream source needs bindings the caller did not supply. */
  | 'missing-binding'
  /** The object/stream source refused the read. */
  | 'source-refused';

export interface ConnectorFailure {
  kind: ConnectorFailureKind;
  /** The underlying error code or message, when there is one worth showing. */
  detail?: string;
}

const SENTENCE: Record<ConnectorFailureKind, string> = {
  'no-dialect': 'this connection type cannot be read live',
  'unsafe-resource': 'the resource name is not a valid table name',
  credential: 'the stored credential could not be used',
  connection: 'the source could not be read',
  'missing-binding': 'the read is missing the binding it needs',
  'source-refused': 'the source refused the read',
};

/**
 * One line naming the failure, for a step detail or an audit entry.
 *
 * Always names the kind first so the sentence is useful even when the underlying driver says nothing
 * intelligible — an empty `detail` must not degrade the message to punctuation.
 */
export function connectorFailureSentence(failure: ConnectorFailure): string {
  const base = SENTENCE[failure.kind] ?? SENTENCE.connection;
  const detail = failure.detail?.trim();
  return detail ? `${base} (${detail})` : base;
}

/**
 * The sentence a person reads on a step that could not read its data.
 *
 * Names the source, says plainly that it could not be read, and — critically — does NOT say "no rows".
 * Whoever sees this must not be able to mistake it for "there is nothing there".
 */
export function connectorFailureMessage(
  label: string,
  resource: string,
  failure: ConnectorFailure,
): string {
  return `Could not read ${label} (${resource}) — ${connectorFailureSentence(failure)}. No decision was made on unread data.`;
}

/**
 * Reduce a thrown driver error to a short, safe detail string.
 *
 * Prefers `cause.code` (ECONNREFUSED, ER_ACCESS_DENIED_ERROR, …) because that is the fact that tells an
 * operator what to fix; falls back to the message. Truncated, so a driver that dumps a query or a
 * connection string into its message cannot smuggle it into the UI or the audit log.
 */
export function describeThrown(error: unknown): string | undefined {
  const err = error as { code?: string; cause?: { code?: string }; message?: string } | null;
  const code = err?.code ?? err?.cause?.code;
  if (typeof code === 'string' && code.trim()) return code.trim().slice(0, 64);
  const message = typeof err?.message === 'string' ? err.message.trim() : '';
  return message ? message.slice(0, 120) : undefined;
}

/**
 * The sentence a PERSON reads on a completed data-read step.
 *
 * `describeDecision()` is documented as "a ready log line" for the AUDIT LEDGER, and it reads like one:
 *   data-domain "expense claims" [dom_7d17b157-0e6] → connector con_f5c959 :: expense_claims (read)
 *   → ok(1 rows via mysql) — scoped to the case by claim_no, employee_id
 * app-run put that string into `step.detail`, and AppRunStatus renders `step.detail` verbatim — so the
 * audit line was on a department user's screen. Verified on the live run detail page for
 * apprun_a60fcc2f: `data-domain`, `connector`, raw ids, and `mysql` all visible.
 *
 * The hero script's governing rule kills exactly those from a screen (any OSS/product name, our
 * internal nouns), and the app-as-product bar is that a non-technical person can use the surface
 * unaided. Both audiences are real, so they get different strings: the audit line stays EXACTLY as it
 * is and goes to the ledger, and this is what the screen shows.
 *
 * The scope is always stated, including its absence — an unscoped read returned other records too, and
 * that is precisely what a reviewer needs in order to judge the answer.
 */
export function connectorReadSentence(
  label: string,
  rows: number,
  scopeKeys: readonly string[],
): string {
  const what = `Read ${rows === 1 ? '1 record' : `${rows} records`} from ${label}`;
  if (scopeKeys.length === 0) return `${what} — not narrowed to this case, so other records are included.`;
  return `${what}, narrowed to this case by ${scopeKeys.join(' and ')}.`;
}
