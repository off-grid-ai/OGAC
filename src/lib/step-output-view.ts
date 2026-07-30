// ─── Make a data-read step's evidence readable — pure ──────────────────────────────────────────────
//
// Flow 6 in `docs/roadmap-real.md` is "Review and approve", and its second step is: *the reviewer
// understands the action and evidence.* Today they are shown this:
//
//   reimbursement quota (employee_quota): 6 row(s).
//   [{"id":7,"employee_id":2,"employee_name":"Meera Malhotra","category":"Travel","annual_quota":"150000.00",…}]
//
// A person approving a ₹41,346 claim cannot check a decision against that, which makes the approval a
// rubber stamp — the exact failure the governance story is supposed to prevent. `docs/APP_AS_PRODUCT.md`
// sets the bar as "a non-technical person in a department can use the surface unaided".
//
// The STORED output stays exactly as it is: it is the model's evidence and part of the audit record, and
// rewriting it would change what the run says it read. This module only parses it back into rows so the
// UI can render a table. Pure and total — anything it cannot parse confidently returns null and the
// caller falls back to showing the raw text, which is never worse than today.

export interface RowsView {
  /** The sentence before the payload: `reimbursement quota (employee_quota): 6 row(s).` */
  head: string;
  /** Column names in first-seen order, so the source's own field order survives. */
  columns: string[];
  /** Parsed rows, values left as strings for display — no coercion, no rounding, no invented symbols. */
  rows: Record<string, unknown>[];
  /** Present when the read was clipped, e.g. `Showing 20 of 21.` */
  coverage?: string;
}

/** The columnar form `summarizeRows` used to emit, still present on runs recorded before it changed. */
interface Columnar {
  columns: unknown;
  rows: unknown;
}

function isColumnar(v: unknown): v is Columnar {
  return !!v && typeof v === 'object' && 'columns' in v && 'rows' in v;
}

/** Column names across all rows, first-seen order — a later row may carry a field the first one lacks. */
function columnsOf(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const k of Object.keys(row)) seen.add(k);
  return [...seen];
}

/**
 * Parse a connector-read step's output into rows for display.
 *
 * Handles both shapes a run can carry: labelled row objects (current) and the older columnar
 * `{columns, rows:[[…]]}` form, so a run recorded before that changed still renders as a table rather
 * than degrading to raw JSON in the UI.
 *
 * Returns null for anything else — a failure message, a prose outcome, an empty read. Those are already
 * legible sentences and must be shown as written.
 */
export function parseRowsOutput(output: string | undefined | null): RowsView | null {
  if (!output) return null;
  const brace = output.search(/[[{]/);
  if (brace < 0) return null;

  const head = output.slice(0, brace).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.slice(brace));
  } catch {
    return null;
  }

  // `Showing 20 of 21.` is part of the head sentence; keep it as its own field so the UI can place it.
  const coverageMatch = head.match(/Showing\s+\d+\s+of\s+\d+\./i);
  const view = (rows: Record<string, unknown>[], columns: string[]): RowsView | null =>
    rows.length === 0
      ? null
      : {
          head: coverageMatch ? head.replace(coverageMatch[0], '').trim() : head,
          columns,
          rows,
          coverage: coverageMatch?.[0],
        };

  if (Array.isArray(parsed)) {
    const rows = parsed.filter(
      (r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r),
    );
    // A partially-object array is not something to guess at.
    if (rows.length !== parsed.length) return null;
    return view(rows, columnsOf(rows));
  }

  if (isColumnar(parsed)) {
    const columns = Array.isArray(parsed.columns) ? parsed.columns.map((c) => String(c)) : null;
    const tuples = Array.isArray(parsed.rows) ? parsed.rows : null;
    if (!columns || !tuples) return null;
    const rows: Record<string, unknown>[] = [];
    for (const t of tuples) {
      if (!Array.isArray(t)) return null;
      const row: Record<string, unknown> = {};
      columns.forEach((c, i) => {
        row[c] = t[i] ?? null;
      });
      rows.push(row);
    }
    return view(rows, columns);
  }

  return null;
}

/**
 * A column name as a person reads it: `annual_quota` → `Annual quota`.
 *
 * Kept mechanical on purpose. A hand-written label map would drift from whatever the customer's own
 * columns are actually called, and their column names are THEIR vocabulary — the one thing on this
 * screen we should not be rewriting.
 */
export function humanizeColumn(column: string): string {
  const words = column.trim().replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  if (!words) return column;
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** Display form for a cell. Null/undefined reads as an em dash; everything else is shown as written. */
export function displayCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
