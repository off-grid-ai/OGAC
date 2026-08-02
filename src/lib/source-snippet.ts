// ─── Making a retrieved source row readable — PURE ─────────────────────────────────────────────────
//
// The review surface's "Where this came from" card printed the raw retrieval payload:
//
//   con_f5c959:expense_claims expense claims (expense_claims): 1 row(s). [{"id":1,"claim_no":"EXP-…",
//   "employee_id":2,"employee_name":"…","category":"Training","purpose":"Risk analytics certification",
//   "amount":"41346.44","status":"submitted","submitted_at":"2025-09-16T18:30:00.000Z",…}]
//
// on the one screen where a person decides whether to approve ₹41,346.44. The run trace already
// humanises the same rows into a table (StepEvidence); the citation card did not, so the same fact
// appeared twice in the product — once readable, once as a JSON dump.
//
// This turns the snippet into ordered field/value pairs when it contains a JSON row, and leaves plain
// prose alone. Zero I/O, so the formatting rule is testable without a run.

export interface SourceField {
  label: string;
  value: string;
}

/** `annual_quota` → `Annual quota`. Same rule the step-evidence table uses for column names. */
export function humaniseField(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** The first JSON object embedded in a snippet, if there is one. */
function firstRow(snippet: string): Record<string, unknown> | null {
  const start = snippet.indexOf('{');
  if (start < 0) return null;
  // Walk to the matching brace so a trailing "…" or a second row does not break the parse.
  let depth = 0;
  for (let i = start; i < snippet.length; i++) {
    if (snippet[i] === '{') depth++;
    else if (snippet[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(snippet.slice(start, i + 1));
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Field/value pairs for the first row in a snippet, in the row's own order, capped so a wide table does
 * not become the page. Returns an empty array when the snippet is prose — the caller then shows the text.
 */
export function snippetFields(snippet: string, limit = 8): SourceField[] {
  const row = firstRow(snippet);
  if (!row) return [];
  return Object.entries(row)
    .filter(([, v]) => v !== null && v !== '')
    .slice(0, limit)
    .map(([k, v]) => ({ label: humaniseField(k), value: formatValue(v) }));
}

/** The human part of a snippet before the JSON — "expense claims (expense_claims): 1 row(s)." */
export function snippetHeadline(snippet: string): string {
  const start = snippet.indexOf('[{');
  const head = (start > 0 ? snippet.slice(0, start) : snippet).trim();
  return head.length > 160 ? `${head.slice(0, 160)}…` : head;
}

/** How many rows the snippet says it read, when it says so. Null when unknown — never guessed. */
export function snippetRowCount(snippet: string): number | null {
  const m = /(\d+)\s+row\(s\)/.exec(snippet);
  return m ? Number(m[1]) : null;
}
