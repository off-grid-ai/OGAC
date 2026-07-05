// PURE OpenLineage facet builders — zero imports, zero I/O, fully unit-testable.
//
// The lineage adapter (src/lib/adapters/lineage.ts) emits OpenLineage RunEvents to Marquez. A bare
// event only says "job X read datasets A,B and wrote C". These builders enrich a dataset with the
// OpenLineage *facets* Marquez understands and renders:
//   • schema            — the dataset's fields (name / type / description)
//   • columnLineage     — how each output field derives from input fields (field-level lineage)
//   • dataQualityMetrics— row/byte counts + per-column null/distinct stats
//
// A facet is just a JSON object carrying two reserved keys — `_producer` (who emitted it) and
// `_schemaURL` (which OpenLineage facet spec it conforms to) — plus the facet payload. Producers
// that KNOW their shape (e.g. brain.ingest knows the source field, a DB dataset knows its columns)
// pass a DatasetFacetInput; everything here is defensive so a producer with partial info still
// emits a valid, Marquez-ingestible facet. This file NEVER fetches.

const PRODUCER = 'https://github.com/offgrid/console';
const OL = 'https://openlineage.io/spec/facets';

// Reserved keys every OpenLineage facet carries.
interface FacetBase {
  _producer: string;
  _schemaURL: string;
}

function base(schema: string): FacetBase {
  return { _producer: PRODUCER, _schemaURL: `${OL}/${schema}` };
}

// ── Inputs (what a producer hands us; loose/optional so partial info is fine) ──────────────────
export interface FieldInput {
  name: unknown;
  type?: unknown;
  description?: unknown;
}

export interface ColumnLineageInput {
  // output field name → the input fields it derives from ("ns:dataset:field" or bare field names)
  field: unknown;
  inputFields: { namespace?: unknown; dataset?: unknown; field: unknown }[];
  transformationType?: unknown;
  transformationDescription?: unknown;
}

export interface DataQualityInput {
  rowCount?: unknown;
  byteCount?: unknown;
  // per-column stats keyed by column name
  columns?: Record<string, { nullCount?: unknown; distinctCount?: unknown; count?: unknown }>;
}

export interface DatasetFacetInput {
  fields?: FieldInput[];
  columnLineage?: ColumnLineageInput[];
  dataQuality?: DataQualityInput;
}

// ── Facet-shaping helpers (each returns undefined when there's nothing meaningful to emit) ──────
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export interface SchemaField {
  name: string;
  type?: string;
  description?: string;
}

// OpenLineage `schema` facet — the dataset's fields. Fields without a real name are dropped; a
// facet with no usable fields is omitted entirely (returns undefined) rather than emitting {}.
export function buildSchemaFacet(fields: FieldInput[] | undefined) {
  const clean: SchemaField[] = (Array.isArray(fields) ? fields : [])
    .map((f) => {
      const name = str(f?.name);
      if (!name) return null;
      const field: SchemaField = { name };
      const type = str(f?.type);
      if (type) field.type = type;
      const description = str(f?.description);
      if (description) field.description = description;
      return field;
    })
    .filter((f): f is SchemaField => f !== null);
  if (!clean.length) return undefined;
  return { ...base('SchemaDatasetFacet.json'), fields: clean };
}

// OpenLineage `columnLineage` facet — output field → contributing input fields. Marquez renders
// this as field-level edges. Entries whose output field or input fields resolve to nothing are
// dropped; an empty facet is omitted.
export function buildColumnLineageFacet(entries: ColumnLineageInput[] | undefined) {
  const fields: Record<string, unknown> = {};
  for (const e of Array.isArray(entries) ? entries : []) {
    const outField = str(e?.field);
    if (!outField) continue;
    const inputFields = (Array.isArray(e?.inputFields) ? e.inputFields : [])
      .map((i) => {
        const field = str(i?.field);
        if (!field) return null;
        return {
          namespace: str(i?.namespace) ?? '',
          name: str(i?.dataset) ?? '',
          field,
        };
      })
      .filter((i): i is { namespace: string; name: string; field: string } => i !== null);
    if (!inputFields.length) continue;
    const entry: Record<string, unknown> = { inputFields };
    const tt = str(e?.transformationType);
    if (tt) entry.transformationType = tt;
    const td = str(e?.transformationDescription);
    if (td) entry.transformationDescription = td;
    fields[outField] = entry;
  }
  if (!Object.keys(fields).length) return undefined;
  return { ...base('ColumnLineageDatasetFacet.json'), fields };
}

// OpenLineage `dataQualityMetrics` facet — row/byte totals + per-column stats. Omitted when no
// numeric metric is present (a facet of all-nulls carries no information).
export function buildDataQualityFacet(dq: DataQualityInput | undefined) {
  if (!dq) return undefined;
  const facet: Record<string, unknown> = {};
  const rowCount = num(dq.rowCount);
  if (rowCount !== null) facet.rowCount = rowCount;
  const byteCount = num(dq.byteCount);
  if (byteCount !== null) facet.bytes = byteCount;

  const columnMetrics: Record<string, unknown> = {};
  for (const [col, stats] of Object.entries(dq.columns ?? {})) {
    const name = str(col);
    if (!name || !stats) continue;
    const m: Record<string, unknown> = {};
    const nulls = num(stats.nullCount);
    if (nulls !== null) m.nullCount = nulls;
    const distinct = num(stats.distinctCount);
    if (distinct !== null) m.distinctCount = distinct;
    const count = num(stats.count);
    if (count !== null) m.count = count;
    if (Object.keys(m).length) columnMetrics[name] = m;
  }
  if (Object.keys(columnMetrics).length) facet.columnMetrics = columnMetrics;

  if (!Object.keys(facet).length) return undefined;
  return { ...base('DataQualityMetricsInputDatasetFacet.json'), ...facet };
}

// Assemble the `facets` object for a single dataset from a producer's input. Returns undefined
// when the producer supplied nothing usable, so the caller emits a bare dataset (no `facets` key).
export function buildDatasetFacets(
  input: DatasetFacetInput | undefined,
): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const facets: Record<string, unknown> = {};
  const schema = buildSchemaFacet(input.fields);
  if (schema) facets.schema = schema;
  const columnLineage = buildColumnLineageFacet(input.columnLineage);
  if (columnLineage) facets.columnLineage = columnLineage;
  const dataQuality = buildDataQualityFacet(input.dataQuality);
  if (dataQuality) facets.dataQualityMetrics = dataQuality;
  return Object.keys(facets).length ? facets : undefined;
}

// A dataset reference plus its (optional) facets — what a producer passes to the lineage port so
// the adapter can attach facets to the right input/output dataset. `name` identifies which dataset
// in the event this describes.
export interface DatasetFacetSpec extends DatasetFacetInput {
  name: string;
}

// Build the OpenLineage dataset object { namespace, name, facets? } for one dataset, looking up any
// facet spec the producer attached by name. Pure — the adapter supplies the namespace.
export function buildDatasetObject(
  namespace: string,
  name: string,
  specs: DatasetFacetSpec[] | undefined,
): { namespace: string; name: string; facets?: Record<string, unknown> } {
  const spec = (specs ?? []).find((s) => s.name === name);
  const facets = spec ? buildDatasetFacets(spec) : undefined;
  return facets ? { namespace, name, facets } : { namespace, name };
}
