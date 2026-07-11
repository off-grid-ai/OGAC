// Pure shaping for VictoriaLogs query responses. ZERO network — unit-tested against representative
// VictoriaLogs output. The thin fetcher lives in `victoria-logs.ts` (excluded from coverage); every
// branch here is covered by victoria-logs-shape.test.ts.
//
// VictoriaLogs answers LogsQL over GET/POST /select/logsql/query and streams newline-delimited JSON
// (JSONL): one JSON object per matching log line, each with the system fields `_time`, `_msg`,
// `_stream` and arbitrary user fields. We parse that stream tolerantly (blank/garbage lines skipped)
// and shape it into a stable row model for the search results table.

export interface LogRow {
  time: string; // _time (ISO), or '' if absent
  message: string; // _msg, or '' if absent
  stream: string; // _stream label set, or ''
  // Remaining user fields (everything that isn't a leading-underscore system field), for expansion.
  fields: Record<string, string>;
}

// Pure: parse one JSONL line into a LogRow, or null if the line is blank / not valid JSON / not an
// object. System fields (leading underscore) are lifted out; the rest become `fields`.
export function parseLogLine(line: string): LogRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;
  const str = (v: unknown): string =>
    v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith('_')) continue;
    fields[k] = str(v);
  }
  return {
    time: str(rec._time),
    message: str(rec._msg),
    stream: str(rec._stream),
    fields,
  };
}

// Pure: parse the whole JSONL body into rows (newest-first if `_time` is present), dropping empty /
// invalid lines. Never throws.
export function parseLogsResponse(body: string | null | undefined): LogRow[] {
  if (!body) return [];
  const rows: LogRow[] = [];
  for (const line of body.split('\n')) {
    const row = parseLogLine(line);
    if (row) rows.push(row);
  }
  // Newest first when times are comparable ISO strings; stable otherwise.
  return rows.sort((a, b) => {
    if (a.time < b.time) return 1;
    if (a.time > b.time) return -1;
    return 0;
  });
}

export interface LogsResult {
  configured: boolean;
  rows: LogRow[];
  query: string;
  error?: string;
}

// Pure: an empty-but-typed result for the unconfigured/unqueried case (never a throw into the page).
export function emptyLogsResult(query = '', configured = false): LogsResult {
  return { configured, rows: [], query };
}

// Pure: normalize a user-supplied LogsQL query. An empty query means "match everything recent" —
// LogsQL's `*` — so the search box works with no filter. Trims whitespace. Never throws.
export function normalizeLogsQuery(raw: string | null | undefined): string {
  const q = (raw ?? '').trim();
  return q || '*';
}
