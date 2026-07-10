// Pure shaping for the Superset chart-data API (`POST /api/v1/chart/{id}/data`). ZERO network —
// this module is unit-tested against representative Superset JSON. The thin fetcher that actually
// talks HTTP lives in `superset-data.ts` (excluded from coverage); every branch here is covered by
// superset-data-shape.test.ts.
//
// This is the NATIVE path that replaces the Superset iframe embed: the console asks Superset (the
// governed semantic/query engine) to RUN a chart's query and hand back the raw result rows, then
// renders them with OUR recharts components. No Superset UI is ever framed.
//
// Superset answers a chart-data request as:
//   { result: [ { data: [ {<col>: <val>, …}, … ], colnames: [...], coltypes: [...] } ], … }
// `data` is an array of row objects keyed by column/label. We tolerate missing/empty/garbage and
// degrade to an HONEST empty (hasData:false) — never fabricated numbers.

// ── Raw API shapes ─────────────────────────────────────────────────────────────
export interface SupersetChartDataResult {
  data?: Array<Record<string, unknown>> | null;
  colnames?: string[] | null;
  coltypes?: number[] | null;
}
export interface SupersetChartDataResponse {
  result?: SupersetChartDataResult[] | null;
  message?: string | null; // Superset error message on 4xx/5xx bodies
}

// ── Display model (recharts-ready) ──────────────────────────────────────────────
// One native chart's worth of data: the rows Superset returned plus the axis/value keys the chart
// binds to. `hasData` is false when nothing came back — the UI then shows an honest empty state
// rather than an empty axis pretending to be live. Deterministic column order.
export type SupersetChartKind = 'line' | 'bar' | 'number';

export interface NativeChartData {
  id: string; // stable key for the panel (chart title / spec id)
  title: string;
  kind: SupersetChartKind;
  xKey: string; // the category / time column recharts plots on the X axis
  valueKeys: string[]; // the numeric series columns
  rows: Array<Record<string, string | number | null>>;
  hasData: boolean;
  // For kind:'number' — the single scalar to show as a stat tile (first value column, first row).
  scalar: number | null;
  error?: string;
}

// Coerce an arbitrary cell to a finite number, or null (an honest gap, never a silent 0). Numeric
// strings are accepted (Superset sometimes stringifies aggregates); everything non-finite → null.
export function toNumber(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Coerce a cell to a display string for the X axis (categories / timestamps come back as strings,
// numbers, or epoch millis). null/undefined → ''.
export function toLabel(raw: unknown): string {
  if (raw == null) return '';
  return String(raw);
}

// Pull the first result block's data rows, tolerating every missing/malformed level.
function extractRows(res: SupersetChartDataResponse | null | undefined): Array<Record<string, unknown>> {
  const block = res?.result?.[0];
  const data = block?.data;
  return Array.isArray(data) ? data.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : [];
}

// Infer the numeric value columns from the row set: every column whose FIRST non-empty cell parses
// as a number. The remaining columns are candidate dimensions (X axis). Column order is taken from
// the first row so the output is deterministic.
function inferColumns(rows: Array<Record<string, unknown>>): { numeric: string[]; dims: string[] } {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const numeric: string[] = [];
  const dims: string[] = [];
  for (const c of cols) {
    const firstNonEmpty = rows.find((r) => r[c] != null && r[c] !== '');
    if (firstNonEmpty && toNumber(firstNonEmpty[c]) != null) numeric.push(c);
    else dims.push(c);
  }
  return { numeric, dims };
}

// A chart spec: which Superset chart id to query and how to render it. `xColumn`/`valueColumns`
// pin the mapping when known; when omitted we infer (dims → X, numerics → series).
export interface SupersetChartSpec {
  id: string; // our stable id (used as the panel key + fallback title)
  chartId: number; // Superset slice id to POST /chart/{id}/data
  title: string;
  kind: SupersetChartKind;
  xColumn?: string;
  valueColumns?: string[];
}

// Pure: fold a Superset chart-data response into a native recharts chart. Missing/empty → an honest
// empty (hasData:false). An error body's `message` is surfaced. Never throws.
export function shapeChart(
  spec: SupersetChartSpec,
  res: SupersetChartDataResponse | null | undefined,
): NativeChartData {
  const error = res?.message ?? undefined;
  const raw = extractRows(res);
  const { numeric, dims } = inferColumns(raw);

  const xKey = spec.xColumn ?? dims[0] ?? '';
  const valueKeys = (spec.valueColumns ?? numeric).filter((k) => k !== xKey);

  const rows: Array<Record<string, string | number | null>> = raw.map((r) => {
    const row: Record<string, string | number | null> = {};
    if (xKey) row[xKey] = toLabel(r[xKey]);
    for (const k of valueKeys) row[k] = toNumber(r[k]);
    return row;
  });

  // hasData is true only when at least one value cell is a real number — an all-null table is empty.
  const hasData = rows.length > 0 && rows.some((r) => valueKeys.some((k) => r[k] != null));

  // For a number tile, the scalar is the first value column of the first row.
  const scalar =
    spec.kind === 'number' && valueKeys.length && raw.length ? toNumber(raw[0][valueKeys[0]]) : null;

  return {
    id: spec.id,
    title: spec.title,
    kind: spec.kind,
    xKey,
    valueKeys,
    rows: spec.kind === 'number' ? [] : rows,
    hasData: spec.kind === 'number' ? scalar != null : hasData,
    scalar,
    error,
  };
}
