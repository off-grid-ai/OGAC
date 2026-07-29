// ─── Candidate cases — the records an app could work on, from the org's own data ─────────────────────
//
// GAP 0 (docs/APP_AS_PRODUCT.md). Starting a case was a free-text box, so a clerk re-typed
// "Training course reimbursement — Vikram Desai, ₹16,107" — data the organisation already holds, which the
// agent then had to parse back out of prose. The founder's question was the right one: *"why is this free
// text? all of the data is already in the organization right?"*
//
// An app's `connector-query` steps declare the data domain they read. That domain resolves to a connector
// and a resource. So the records the app works on can be LISTED, and a case started by picking one.
//
// This module is the PURE half: which domain an app reads, and how to turn a raw row into a row a person
// can recognise. The I/O (resolving the connector, running the query) stays in the route.

/** A record the app could work on, reduced to what a person needs to choose between them. */
export interface CaseCandidate {
  /** Stable identity of the record, passed as the run input when chosen. */
  id: string;
  /** The line a person reads. */
  label: string;
  /** Secondary detail — amounts, dates, status. */
  detail?: string;
  /** The full row, so the run receives the real record rather than a re-typed description. */
  record: Record<string, unknown>;
}

/** Field names likely to identify a record, in preference order. */
const ID_KEYS = ['id', 'claim_id', 'invoice_id', 'application_id', 'policy_number', 'reference', 'ref'];
// Widened after testing against the real `invoices` domain, which keys the party as `vendor` — so every
// row labelled itself "1", "2", "3" (its id) and the picker was unreadable. The label is the ONLY thing a
// person chooses by, so this list has to cover how real sources actually name the party.
const NAME_KEYS = [
  'customer_name',
  'employee_name',
  'applicant_name',
  'policyholder_name',
  'claimant_name',
  'vendor',
  'supplier',
  'merchant',
  'party',
  'counterparty',
  'name',
];
const AMOUNT_KEYS = ['amount', 'claim_amount', 'invoice_amount', 'loan_amount', 'sum_assured', 'premium'];
const DATE_KEYS = [
  'created_at',
  'received_at',
  'submitted_at',
  'booked',
  'booked_at',
  'invoice_date',
  'txn_date',
  'date',
  'raised_at',
];

/** Words that tell a person whether a record still needs work. */
const STATUS_KEYS = ['status', 'state', 'stage'];

/**
 * Statuses meaning the record is FINISHED, so it is not work.
 *
 * A paid invoice is not a reimbursement decision waiting to be made. Offering settled records alongside open
 * ones invites someone to "approve" something already done — and it is exactly the kind of thing that falls
 * apart under the first real question in a demo.
 */
const SETTLED = /^(paid|settled|closed|done|complete[d]?|approved|rejected|cancelled|canceled|void)$/i;

/** Whether a record still needs a decision. Unknown or absent status counts as actionable — we do not */
/** hide work on a guess; only an explicitly finished status is filtered out. */
export function isActionableRecord(row: Record<string, unknown>): boolean {
  const status = firstStringIn(row, STATUS_KEYS);
  return !status || !SETTLED.test(status.trim());
}

function firstStringIn(row: Record<string, unknown>, keys: readonly string[]): string | null {
  return firstString(row, keys);
}

function firstString(row: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** Group a whole number so an amount reads as money. Deterministic — never toLocaleString. */
function group(value: number): string {
  const [whole, fraction] = Math.abs(value).toString().split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value < 0 ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Turn a raw source row into something a person can choose between.
 *
 * Falls back to the row's own identity rather than inventing a description: a record we cannot summarise is
 * still selectable, because the RUN gets the whole row regardless — the label is for the human, not the
 * agent. That is the key difference from the free-text box, where the typed prose WAS the input.
 */
export function toCaseCandidate(row: Record<string, unknown>, index: number): CaseCandidate {
  const id = firstString(row, ID_KEYS) ?? `row-${index + 1}`;
  const name = firstString(row, NAME_KEYS);
  const amountKey = AMOUNT_KEYS.find((k) => Number.isFinite(Number(row[k])));
  const amount = amountKey ? Number(row[amountKey]) : null;
  const when = firstString(row, DATE_KEYS);

  const label = name ?? firstString(row, ID_KEYS) ?? `Record ${index + 1}`;
  // Status first: whether a record is open is the thing that decides if it is worth picking.
  const status = firstString(row, STATUS_KEYS);
  const detail = [status, amount !== null ? group(amount) : null, when ? when.slice(0, 10) : null]
    .filter(Boolean)
    .join(' · ');

  return { id, label, detail: detail || undefined, record: row };
}

/**
 * The data domain an app reads, or null when it reads none.
 *
 * The FIRST connector-query step wins: that is the step that fetches the thing being worked on, and later
 * reads are supporting context (a reimbursement app reads the invoice, then the employee's quota).
 */
export function primaryDomainLabel(
  steps: readonly { kind?: string; domain?: string }[] | undefined,
): string | null {
  const step = (steps ?? []).find((s) => s.kind === 'connector-query' && s.domain?.trim());
  return step?.domain?.trim() ?? null;
}
