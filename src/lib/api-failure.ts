// ─── What to TELL a user when a write is refused — pure ────────────────────────────────────────────
//
// LIVE FINDING. Clicking "Add to my prompts" on the read-only demo account produced the toast
// "Could not add starter". What the server actually returned was:
//
//   403 {"error":"forbidden","reason":"read-only demo: this account can view everything but cannot
//        make changes"}
//
// A precise, already-written, user-appropriate explanation — discarded by
// `if (!res.ok) throw new Error('failed')`. The user was told the product is broken when in fact
// they simply are not permitted, which are opposite facts: one means "report a bug / try again", the
// other means "ask for access". This is the dropped-field-at-a-boundary defect on the ERROR path,
// and `grep -rn "if (!res.ok) throw" src/` finds 194 call sites doing it.
//
// A REFUSAL IS NOT A FAILURE. That distinction is the whole point of this module: a 401/403 is the
// system working correctly and must never be phrased as breakage, while a 500 genuinely is breakage
// and must not be softened into something the user might think they caused.

/** The error envelope our routes return. Every field optional — this parses what arrived, not what we hoped. */
export interface ApiErrorBody {
  error?: unknown;
  reason?: unknown;
  message?: unknown;
  detail?: unknown;
}

export type FailureKind = 'refused' | 'invalid' | 'missing' | 'conflict' | 'rate-limited' | 'broken';

export interface Failure {
  kind: FailureKind;
  /** What to show the user. Never empty. */
  message: string;
  /** True when the system behaved correctly and the user simply may not do this. */
  refusal: boolean;
}

/** The server's own words, if it gave any. Checked in order of specificity. */
function serverReason(body: ApiErrorBody | null | undefined): string {
  for (const v of [body?.reason, body?.message, body?.detail, body?.error]) {
    if (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'forbidden') return v.trim();
  }
  return '';
}

function kindFor(status: number): FailureKind {
  if (status === 401 || status === 403) return 'refused';
  if (status === 404) return 'missing';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate-limited';
  if (status >= 400 && status < 500) return 'invalid';
  return 'broken';
}

/**
 * Turn a failed response into something worth showing a person.
 *
 * `fallback` describes the ATTEMPT ("add this starter"), so a generic case still reads as a sentence
 * about what the user was doing rather than a bare "Failed".
 */
export function describeFailure(
  status: number,
  body: ApiErrorBody | null | undefined,
  fallback = 'complete that',
): Failure {
  const kind = kindFor(status);
  const reason = serverReason(body);
  const refusal = kind === 'refused';
  // The server's reason WINS whenever it gave one — it knows why, and this module does not.
  if (reason) return { kind, message: reason, refusal };
  const generic: Record<FailureKind, string> = {
    // No reason supplied, so say what is true without inventing a cause.
    refused: `You do not have permission to ${fallback}.`,
    invalid: `Could not ${fallback} — the request was rejected.`,
    missing: 'That item no longer exists.',
    conflict: `Could not ${fallback} — it was changed elsewhere. Reload and try again.`,
    'rate-limited': 'Too many requests just now. Try again in a moment.',
    broken: `Could not ${fallback} — something went wrong on our side.`,
  };
  return { kind, message: generic[kind], refusal };
}

/**
 * Read a failed `Response` and describe it. The only I/O here is consuming the body, which is why
 * the decision itself lives in `describeFailure` and is unit-testable without a server.
 */
export async function explainResponse(res: Response, fallback?: string): Promise<Failure> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    body = null; // a non-JSON body is not a reason to lose the status
  }
  return describeFailure(res.status, body, fallback);
}
