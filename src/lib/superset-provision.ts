// Pure, zero-IO logic for the Superset integration:
//   1) decideEmbed()      — verify-or-fail: given the mint inputs and a dashboard-existence probe,
//      decide whether to hand the browser a token or a structured "not provisioned" state.
//   2) payload builders    — the exact request bodies POSTed to the Superset REST API to provision a
//      starter dashboard over the audit/gateway data. Idempotent selection (find-or-create) is driven
//      by the finders below, which match on the stable names these builders emit.
//
// Everything here is deterministic and side-effect free so it can be unit-tested without a live
// Superset. The IO orchestration (login, fetch, retries) lives in superset.ts.

// ─── Stable identifiers ─────────────────────────────────────────────────────
// These names are the idempotency keys: provisioning finds-or-creates by matching them, so they must
// never drift once shipped.
export const OFFGRID_DB_NAME = 'Off Grid AI Console';
export const OFFGRID_DATASET_TABLE = 'audit_events';
export const OFFGRID_DASHBOARD_TITLE = 'Off Grid AI — Gateway Overview';
export const CHART_REQUESTS_OVER_TIME = 'Requests over time';
export const CHART_TOKENS_BY_MODEL = 'Tokens by model';

// ─── verify-or-fail ─────────────────────────────────────────────────────────

export interface EmbedInputs {
  configured: boolean;
  embedUuid?: string;
  // Result of probing the dashboard via the Superset API. undefined ⇒ probe not run / not reachable.
  dashboardExists?: boolean;
}

export type EmbedState =
  | 'not-configured' // creds / embed uuid missing → integration simply off
  | 'not-provisioned' // configured, but the dashboard UUID does not exist in Superset → show CTA, no token
  | 'ready'; // dashboard verified to exist → safe to mint a guest token

export interface EmbedDecision {
  state: EmbedState;
  // A machine-readable code the route can pass through to the UI.
  reason?: string;
}

// The single decision that gates guest-token minting. Kept pure so the "valid token for a ghost
// dashboard" bug can be unit-tested: a configured integration whose UUID does not exist must resolve
// to 'not-provisioned', never 'ready'.
export function decideEmbed(inp: EmbedInputs): EmbedDecision {
  if (!inp.configured || !inp.embedUuid) {
    return { state: 'not-configured' };
  }
  if (inp.dashboardExists !== true) {
    return { state: 'not-provisioned', reason: 'dashboard-uuid-not-found' };
  }
  return { state: 'ready' };
}

// ─── Superset dashboard-list matching (idempotency) ─────────────────────────
// The Superset dashboard LIST endpoint (/api/v1/dashboard/) does NOT expose a `uuid` column — its
// list_columns are id/slug/dashboard_title/… only. The *embed* UUID (what the browser SDK loads) is a
// separate resource: GET /api/v1/dashboard/{id}/embedded → result.uuid. So verification is a two step:
//   1) find our dashboard in the list by its stable TITLE → get its id,
//   2) fetch that id's /embedded config and match its uuid to the configured embed UUID.
// These are the pure matchers; the two-step IO orchestration lives in superset.ts.

export interface SupersetDashboardRow {
  id: number;
  uuid?: string; // NOTE: not present in the list endpoint; only via a direct GET on some versions.
  dashboard_title?: string;
}

// The /api/v1/dashboard/{id}/embedded payload shape (result.uuid is the embeddable UUID).
export interface SupersetEmbeddedConfig {
  uuid?: string;
}

// Find an already-provisioned Off Grid AI dashboard by its stable title (for idempotent provisioning
// AND for the embed-existence probe). Title is the only stable identifier the list endpoint returns.
export function findOwnedDashboard(rows: SupersetDashboardRow[]): SupersetDashboardRow | undefined {
  return rows.find((r) => r.dashboard_title === OFFGRID_DASHBOARD_TITLE);
}

// True iff the fetched embedded config's uuid matches the configured embed UUID. Pure: the caller does
// the GET /dashboard/{id}/embedded and passes the parsed result here.
export function embeddedUuidMatches(
  config: SupersetEmbeddedConfig | null | undefined,
  embedUuid: string,
): boolean {
  return Boolean(config && typeof config.uuid === 'string' && config.uuid === embedUuid);
}

// Generic find-by-name over a Superset list result of {id, <nameKey>}.
export function findByName<T extends Record<string, unknown>>(
  rows: T[],
  nameKey: keyof T,
  name: string,
): T | undefined {
  return rows.find((r) => r[nameKey] === name);
}

// ─── Payload builders ───────────────────────────────────────────────────────

// POST /api/v1/database — connect the console Postgres. sqlalchemy_uri is supplied by the caller
// (it lives in server env, not here). Idempotent by database_name.
export function buildDatabasePayload(sqlalchemyUri: string) {
  return {
    database_name: OFFGRID_DB_NAME,
    sqlalchemy_uri: sqlalchemyUri,
    expose_in_sqllab: true,
    allow_ctas: false,
    allow_cvas: false,
    allow_dml: false,
  };
}

// POST /api/v1/dataset — register the audit_events table against the connected database.
export function buildDatasetPayload(databaseId: number, schema = 'public') {
  return {
    database: databaseId,
    schema,
    table_name: OFFGRID_DATASET_TABLE,
  };
}

// POST /api/v1/chart — "Requests over time": a time-series line of event count bucketed by day.
export function buildRequestsOverTimeChart(datasetId: number) {
  const params = {
    datasource: `${datasetId}__table`,
    viz_type: 'echarts_timeseries_line',
    granularity_sqla: 'ts',
    time_grain_sqla: 'P1D',
    metrics: [
      {
        expressionType: 'SIMPLE',
        column: { column_name: 'id', type: 'TEXT' },
        aggregate: 'COUNT',
        label: 'requests',
      },
    ],
    groupby: [],
    row_limit: 1000,
  };
  return {
    slice_name: CHART_REQUESTS_OVER_TIME,
    viz_type: 'echarts_timeseries_line',
    datasource_id: datasetId,
    datasource_type: 'table',
    params: JSON.stringify(params),
  };
}

// POST /api/v1/chart — "Tokens by model": a bar chart of summed tokens grouped by model.
export function buildTokensByModelChart(datasetId: number) {
  const params = {
    datasource: `${datasetId}__table`,
    viz_type: 'echarts_timeseries_bar',
    granularity_sqla: 'ts',
    metrics: [
      {
        expressionType: 'SIMPLE',
        column: { column_name: 'tokens', type: 'INTEGER' },
        aggregate: 'SUM',
        label: 'tokens',
      },
    ],
    groupby: ['model'],
    row_limit: 1000,
  };
  return {
    slice_name: CHART_TOKENS_BY_MODEL,
    viz_type: 'echarts_timeseries_bar',
    datasource_id: datasetId,
    datasource_type: 'table',
    params: JSON.stringify(params),
  };
}

// Minimal Superset position_json: a ROOT → GRID → ROW → two CHART cells layout, so the starter
// dashboard is never blank once charts are attached.
export function buildDashboardPositionJson(chartIds: number[]): Record<string, unknown> {
  const layout: Record<string, unknown> = {
    DASHBOARD_VERSION_KEY: 'v2',
    ROOT_ID: { type: 'ROOT', id: 'ROOT_ID', children: ['GRID_ID'] },
    GRID_ID: { type: 'GRID', id: 'GRID_ID', children: ['ROW-1'], parents: ['ROOT_ID'] },
    'ROW-1': {
      type: 'ROW',
      id: 'ROW-1',
      children: chartIds.map((_, i) => `CHART-${i}`),
      parents: ['ROOT_ID', 'GRID_ID'],
      meta: { background: 'BACKGROUND_TRANSPARENT' },
    },
  };
  chartIds.forEach((chartId, i) => {
    layout[`CHART-${i}`] = {
      type: 'CHART',
      id: `CHART-${i}`,
      children: [],
      parents: ['ROOT_ID', 'GRID_ID', 'ROW-1'],
      meta: { chartId, width: 6, height: 50 },
    };
  });
  return layout;
}

// The initial create body — dashboard is created first, charts are then generated pointing at its
// dataset, then attached via buildDashboardUpdatePayload.
export function buildDashboardCreatePayload() {
  return {
    dashboard_title: OFFGRID_DASHBOARD_TITLE,
    slug: 'offgrid-gateway-overview',
    published: true,
  };
}

// PUT /api/v1/dashboard/{id} — attach charts + an explicit two-cell layout.
export function buildDashboardUpdatePayload(chartIds: number[]) {
  return {
    dashboard_title: OFFGRID_DASHBOARD_TITLE,
    published: true,
    position_json: JSON.stringify(buildDashboardPositionJson(chartIds)),
  };
}
