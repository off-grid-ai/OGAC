// ─── Scope a read to the case being worked on — pure ─────────────────────────────────────────────────
//
// A per-case app read its whole table: "Read the invoice" returned twenty unrelated invoices and "Check the
// employee's reimbursement quota" returned twenty unrelated employees. The agent was then asked to decide
// eligibility from two lists that had nothing to do with each other, and — correctly — said it could not.
// `ConnectorQuery.params` existed but was documented as "reserved for equality filters"; nothing applied it.
//
// So a step can now say WHICH record it wants, in terms of the case:
//
//   { kind: 'connector-query', domain: 'reimbursement quota', params: { employee_id: '{{case.employee_id}}' } }
//
// Two rules make this safe to hand to a generated spec:
//   • column names are validated as bare identifiers and the VALUES are always bound parameters, never
//     interpolated — a filter cannot become an injection surface;
//   • a placeholder the case cannot satisfy is an ERROR, never a dropped filter. Dropping it would widen
//     the read back to the whole table while still calling itself case-scoped, which is the failure this
//     module exists to end.

/** A column name we are willing to put in a WHERE clause: bare identifier, no qualifier, no quoting. */
const FILTER_COLUMN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** More than this many equality filters on one read is a spec bug, not a query. */
const MAX_FILTERS = 8;

const PLACEHOLDER = /^\s*\{\{\s*(case|input)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}\s*$/;

export type FilterValue = string | number | boolean;

export interface ResolvedParams {
  /** Column → literal value, ready to bind. */
  filters: Record<string, FilterValue>;
  /** Placeholders the case could not satisfy, e.g. ['employee_id ← case.employee_id']. */
  unresolved: string[];
  /** Columns dropped because the name or the value was not usable as an equality filter. */
  rejected: string[];
}

/** Whether a value can be compared for equality in a bound parameter. */
function isFilterValue(value: unknown): value is FilterValue {
  if (typeof value === 'string') return value.length > 0 && value.length <= 256;
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'boolean';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Parse a record that arrived as a JSON string (the case picker sends `case_record` that way). */
function parseRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return null;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

/**
 * Find the case record inside a run input.
 *
 * A run's input is an envelope, not the record: the trigger normalizer wraps a browser submission as
 * `{ input: <text>, body: { input: { case: {…} } } }`, a webhook may post the record at the top level, and
 * the case picker has historically sent it as a JSON string under `case_record`. All three carry the same
 * thing, so all three resolve — otherwise a case-scoped step works from one entry point and fails from
 * another, which is worse than not supporting it at all.
 */
export function caseRecordFrom(
  input: Record<string, unknown> | undefined,
  depth = 0,
): Record<string, unknown> {
  if (!input || depth > 3) return {};
  const explicit = asRecord(input.case) ?? parseRecord(input.case) ?? parseRecord(input.case_record) ?? asRecord(input.case_record);
  if (explicit) return explicit;
  const nested = asRecord(input.body) ?? asRecord(input.input);
  if (nested) {
    const found = caseRecordFrom(nested, depth + 1);
    if (Object.keys(found).length > 0) return found;
  }
  // No envelope: the input IS the record (a webhook that posts the row itself).
  return input;
}

/**
 * Fold a request's sibling case record into the run input.
 *
 * The picked record arrives as a SIBLING of `input` in the request body (`{ input, case }`), and a route
 * that only reads `body.input` drops it silently — which is exactly what happened: the run stored the
 * display string "Meera Malhotra · submitted · 41,346.44" and nothing downstream could filter on the
 * case, so both `{{case.employee_id}}` and the inferred scope read the table unfiltered.
 *
 * Lives here, next to caseRecordFrom, because this is the same question from the other side: that
 * function says what counts as a case record, this one makes sure it survives the request boundary. Two
 * senders exist — `case` (a record) and `case_record` (a JSON string) — and caseRecordFrom parses either,
 * so this only has to carry it through under a canonical key.
 */
export function runInputWithCase(body: {
  input?: unknown;
  case?: unknown;
  case_record?: unknown;
}): Record<string, unknown> {
  const base =
    body.input && typeof body.input === 'object' && !Array.isArray(body.input)
      ? (body.input as Record<string, unknown>)
      : {};
  const raw = body.case ?? body.case_record;
  if (raw === undefined || raw === null) return { ...base };
  return { ...base, case: raw };
}

/**
 * Resolve a step's declared params against the case record.
 *
 * A literal value passes through. A `{{case.field}}` / `{{input.field}}` placeholder is replaced with that
 * field of the case. A placeholder with no matching field is reported in `unresolved` — the caller must
 * treat that as a failure rather than reading without it.
 */
export function resolveStepParams(
  params: Record<string, unknown> | undefined,
  runInput: Record<string, unknown> | undefined,
): ResolvedParams {
  // The case record wins; the envelope's own top-level fields are the fallback, so an app that reads
  // `{{input.subject}}` from an email trigger still works.
  const record = caseRecordFrom(runInput);
  const input: Record<string, unknown> = { ...runInput, ...record };
  const filters: Record<string, FilterValue> = {};
  const unresolved: string[] = [];
  const rejected: string[] = [];

  for (const [rawColumn, rawValue] of Object.entries(params ?? {})) {
    const column = rawColumn.trim();
    if (!FILTER_COLUMN.test(column)) {
      rejected.push(rawColumn);
      continue;
    }
    if (Object.keys(filters).length >= MAX_FILTERS) {
      rejected.push(column);
      continue;
    }

    const placeholder = typeof rawValue === 'string' ? PLACEHOLDER.exec(rawValue) : null;
    if (placeholder) {
      const field = placeholder[2];
      const value = input?.[field];
      if (!isFilterValue(value)) {
        unresolved.push(`${column} ← ${placeholder[1]}.${field}`);
        continue;
      }
      filters[column] = value;
      continue;
    }

    if (isFilterValue(rawValue)) {
      filters[column] = rawValue;
      continue;
    }
    rejected.push(column);
  }

  return { filters, unresolved, rejected };
}

export interface EqualityFilter {
  /** The WHERE clause including the keyword, or '' when there is nothing to filter on. */
  where: string;
  /** Values in the same order as their placeholders. */
  values: FilterValue[];
  /** Columns actually filtered on, for the audit line. */
  applied: string[];
}

/**
 * Build a parameterised equality WHERE clause in the dialect's placeholder style.
 *
 * Values NEVER appear in the returned SQL — that is the whole point. Postgres numbers its placeholders,
 * MySQL uses `?`, MSSQL uses named `@p1` parameters bound by the caller.
 */
export function buildEqualityFilter(
  filters: Record<string, FilterValue>,
  dialect: 'postgres' | 'mysql' | 'mssql',
): EqualityFilter {
  const applied = Object.keys(filters).filter((column) => FILTER_COLUMN.test(column));
  if (applied.length === 0) return { where: '', values: [], applied: [] };

  const clauses = applied.map((column, index) => {
    const quoted = dialect === 'mysql' ? `\`${column}\`` : `"${column}"`;
    if (dialect === 'postgres') return `${quoted} = $${index + 1}`;
    if (dialect === 'mssql') return `${quoted} = @p${index + 1}`;
    return `${quoted} = ?`;
  });

  return {
    where: ` WHERE ${clauses.join(' AND ')}`,
    values: applied.map((column) => filters[column]),
    applied,
  };
}

/**
 * Apply the same equality filters to already-fetched rows (REST, and any source we cannot push a
 * predicate into). Compares as strings so `1` from a JSON body matches `"1"` from the case record —
 * a type mismatch between two representations of the same identifier is not a reason to drop a case.
 */
export function filterRows(
  rows: readonly Record<string, unknown>[],
  filters: Record<string, FilterValue>,
): Record<string, unknown>[] {
  const entries = Object.entries(filters);
  if (entries.length === 0) return rows.map((row) => row);
  return rows.filter((row) =>
    entries.every(([column, value]) => {
      const actual = row[column];
      if (actual === null || actual === undefined) return false;
      return String(actual) === String(value);
    }),
  );
}

/** The sentence a step shows when the case cannot satisfy a filter the app declared. */
export function unresolvedFilterMessage(label: string, unresolved: readonly string[]): string {
  return `Could not read ${label} — this case does not carry ${unresolved
    .map((u) => u.split(' ← ')[0])
    .join(', ')}, which this step filters on. Reading it unfiltered would return other people's records, so nothing was read.`;
}
