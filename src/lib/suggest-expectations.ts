// ─── AUTO-GENERATE DATA-QUALITY EXPECTATIONS from a schema — PURE, ZERO-IO ────────────────────────
//
// M5. Given a dataset/table schema descriptor, propose Great-Expectations-style data-quality checks
// so an operator doesn't hand-write them. Purely a function of the schema (column names + types +
// optional observed stats/samples) — no DB, no clock, no network. Unit-testable.
//
// The expectation vocabulary mirrors Great Expectations' well-known checks (we name the GE
// expectation type in `expectationType` so the output maps cleanly onto a GE suite or our own
// checker), but nothing here imports or calls GE — it's a rule-based proposal.
//
// Inference rules (all conservative — a proposal an operator confirms, never auto-enforced):
//   • not-null   → columns that look like a key / id / required field.
//   • unique     → columns that look like a primary key / id / email.
//   • type       → expect_column_values_to_be_of_type from the declared type.
//   • range      → numeric columns get a min/max bound when observed stats are present; else a
//                  non-negative floor for amounts/counts by name.
//   • allowed    → low-cardinality / enum-looking columns (status, type, category, currency, gender)
//                  get expect_column_values_to_be_in_set from observed distinct samples if given.
//   • regex      → email / phone / PAN-ish named columns get a format expectation.

export type ColumnType = 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'timestamp' | 'unknown';

/** One column of the input schema. Observed stats are OPTIONAL and sharpen the proposal. */
export interface ColumnDescriptor {
  name: string;
  type?: ColumnType | string;
  /** Observed null count in a profiled sample (optional). */
  nullCount?: number;
  /** Observed distinct count (optional) — drives unique + enum inference. */
  distinctCount?: number;
  /** Rows profiled (optional) — needed to reason about null/distinct ratios. */
  rowCount?: number;
  /** Observed min/max for a numeric column (optional). */
  min?: number;
  max?: number;
  /** A handful of observed distinct sample values (optional) — drives allowed-value sets. */
  sampleValues?: (string | number | boolean)[];
}

export interface TableSchemaDescriptor {
  table: string;
  columns: ColumnDescriptor[];
  /** Total rows profiled, if known (column-level rowCount wins when present). */
  rowCount?: number;
}

export type ExpectationKind = 'not_null' | 'unique' | 'type' | 'range' | 'allowed_values' | 'regex';

export interface Expectation {
  /** The Great-Expectations expectation type this maps to. */
  expectationType: string;
  kind: ExpectationKind;
  column: string;
  /** Structured kwargs for the check (mirrors GE kwargs). */
  kwargs: Record<string, unknown>;
  /** Plain-language explanation of why this was proposed. */
  reason: string;
  /** 'observed' = backed by profiled stats; 'inferred' = from name/type heuristics only. */
  basis: 'observed' | 'inferred';
}

export interface ExpectationSuite {
  table: string;
  expectations: Expectation[];
}

const ID_RE = /(^|_)(id|uuid|guid|key|pk)$/i;
const EMAIL_RE = /email|e_mail/i;
const PHONE_RE = /phone|mobile|contact_no|msisdn/i;
const PAN_RE = /(^|_)pan(_|$)|pan_no|pan_number/i;
const AMOUNT_RE = /amount|amt|balance|price|cost|salary|value|total|fee|charge|limit/i;
const COUNT_RE = /count|qty|quantity|num_|_num|age|score|tenure/i;
const ENUM_RE = /status|state|type|category|kind|currency|gender|tier|grade|flag|code/i;

function normType(t: string | undefined): ColumnType {
  const s = (t ?? '').toLowerCase();
  if (!s) return 'unknown';
  if (/int|serial|bigint|smallint/.test(s)) return 'integer';
  if (/float|double|decimal|numeric|real|money/.test(s)) return 'number';
  if (/bool/.test(s)) return 'boolean';
  if (/timestamp|datetime/.test(s)) return 'timestamp';
  if (/date/.test(s)) return 'date';
  if (/char|text|string|varchar|uuid/.test(s)) return 'string';
  if (['string', 'integer', 'number', 'boolean', 'date', 'timestamp'].includes(s)) return s as ColumnType;
  return 'unknown';
}

const GE_TYPE: Record<ColumnType, string | null> = {
  string: 'STRING',
  integer: 'INTEGER',
  number: 'FLOAT',
  boolean: 'BOOLEAN',
  date: 'DATE',
  timestamp: 'TIMESTAMP',
  unknown: null,
};

function isNumeric(t: ColumnType): boolean {
  return t === 'integer' || t === 'number';
}

/**
 * Generate a data-quality expectation suite from a table schema. Pure. Observed stats (nullCount,
 * distinctCount, min/max, sampleValues) sharpen the proposal to `basis:'observed'`; otherwise checks
 * are name/type `inferred`. Stable order: expectations grouped by column, in schema order.
 */
export function generateExpectations(schema: TableSchemaDescriptor): ExpectationSuite {
  const expectations: Expectation[] = [];
  const tableRows = schema.rowCount;

  for (const col of schema.columns) {
    const name = col.name;
    const type = normType(col.type);
    const rows = col.rowCount ?? tableRows;
    const looksId = ID_RE.test(name);

    // ── not-null ─────────────────────────────────────────────────────────────────────────────
    if (typeof col.nullCount === 'number' && col.nullCount === 0 && (rows ?? 0) > 0) {
      expectations.push({
        expectationType: 'expect_column_values_to_not_be_null',
        kind: 'not_null',
        column: name,
        kwargs: { column: name },
        reason: `no nulls observed in ${rows} profiled rows`,
        basis: 'observed',
      });
    } else if (looksId || /required|mandatory/.test(name)) {
      expectations.push({
        expectationType: 'expect_column_values_to_not_be_null',
        kind: 'not_null',
        column: name,
        kwargs: { column: name },
        reason: 'column looks like a key / required field',
        basis: 'inferred',
      });
    }

    // ── unique ───────────────────────────────────────────────────────────────────────────────
    if (
      typeof col.distinctCount === 'number' &&
      typeof rows === 'number' &&
      rows > 0 &&
      col.distinctCount === rows
    ) {
      expectations.push({
        expectationType: 'expect_column_values_to_be_unique',
        kind: 'unique',
        column: name,
        kwargs: { column: name },
        reason: `every value distinct across ${rows} profiled rows`,
        basis: 'observed',
      });
    } else if (looksId || EMAIL_RE.test(name)) {
      expectations.push({
        expectationType: 'expect_column_values_to_be_unique',
        kind: 'unique',
        column: name,
        kwargs: { column: name },
        reason: EMAIL_RE.test(name) ? 'email columns are usually unique per record' : 'column looks like a primary key',
        basis: 'inferred',
      });
    }

    // ── type ─────────────────────────────────────────────────────────────────────────────────
    const geType = GE_TYPE[type];
    if (geType) {
      expectations.push({
        expectationType: 'expect_column_values_to_be_of_type',
        kind: 'type',
        column: name,
        kwargs: { column: name, type_: geType },
        reason: `declared type is ${type}`,
        basis: 'inferred',
      });
    }

    // ── range ────────────────────────────────────────────────────────────────────────────────
    if (isNumeric(type)) {
      if (typeof col.min === 'number' && typeof col.max === 'number') {
        expectations.push({
          expectationType: 'expect_column_values_to_be_between',
          kind: 'range',
          column: name,
          kwargs: { column: name, min_value: col.min, max_value: col.max },
          reason: `observed values fall in [${col.min}, ${col.max}]`,
          basis: 'observed',
        });
      } else if (AMOUNT_RE.test(name) || COUNT_RE.test(name)) {
        expectations.push({
          expectationType: 'expect_column_values_to_be_between',
          kind: 'range',
          column: name,
          kwargs: { column: name, min_value: 0, max_value: null },
          reason: 'amounts / counts should not be negative',
          basis: 'inferred',
        });
      }
    }

    // ── allowed values (enum) ──────────────────────────────────────────────────────────────────
    const sample = col.sampleValues?.filter((v) => v !== null && v !== undefined) ?? [];
    const looksEnum = ENUM_RE.test(name) || type === 'boolean';
    const lowCard =
      typeof col.distinctCount === 'number' &&
      col.distinctCount > 0 &&
      col.distinctCount <= 20 &&
      (typeof rows !== 'number' || col.distinctCount < rows);
    if (sample.length > 0 && sample.length <= 20 && (looksEnum || lowCard)) {
      const set = [...new Set(sample)];
      expectations.push({
        expectationType: 'expect_column_values_to_be_in_set',
        kind: 'allowed_values',
        column: name,
        kwargs: { column: name, value_set: set },
        reason: 'low-cardinality / enum-like column — restrict to observed values',
        basis: 'observed',
      });
    } else if (type === 'boolean') {
      expectations.push({
        expectationType: 'expect_column_values_to_be_in_set',
        kind: 'allowed_values',
        column: name,
        kwargs: { column: name, value_set: [true, false] },
        reason: 'boolean column',
        basis: 'inferred',
      });
    }

    // ── regex / format ─────────────────────────────────────────────────────────────────────────
    if (EMAIL_RE.test(name)) {
      expectations.push({
        expectationType: 'expect_column_values_to_match_regex',
        kind: 'regex',
        column: name,
        kwargs: { column: name, regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
        reason: 'column looks like an email address',
        basis: 'inferred',
      });
    } else if (PHONE_RE.test(name)) {
      expectations.push({
        expectationType: 'expect_column_values_to_match_regex',
        kind: 'regex',
        column: name,
        kwargs: { column: name, regex: '^[+0-9][0-9\\-\\s]{6,}$' },
        reason: 'column looks like a phone number',
        basis: 'inferred',
      });
    } else if (PAN_RE.test(name)) {
      expectations.push({
        expectationType: 'expect_column_values_to_match_regex',
        kind: 'regex',
        column: name,
        kwargs: { column: name, regex: '^[A-Z]{5}[0-9]{4}[A-Z]$' },
        reason: 'column looks like an Indian PAN',
        basis: 'inferred',
      });
    }
  }

  return { table: schema.table, expectations };
}
