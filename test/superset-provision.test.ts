import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildDashboardCreatePayload,
  buildDashboardPositionJson,
  buildDashboardUpdatePayload,
  buildDatabasePayload,
  buildDatasetPayload,
  buildRequestsOverTimeChart,
  buildTokensByModelChart,
  dashboardExistsInList,
  decideEmbed,
  findByName,
  findOwnedDashboard,
  OFFGRID_DASHBOARD_TITLE,
  OFFGRID_DATASET_TABLE,
  OFFGRID_DB_NAME,
  type SupersetDashboardRow,
} from '../src/lib/superset-provision.ts';

// ── verify-or-fail: decideEmbed ───────────────────────────────────────────────

test('decideEmbed: not configured → not-configured (no token path)', () => {
  assert.deepEqual(decideEmbed({ configured: false }), { state: 'not-configured' });
  assert.deepEqual(decideEmbed({ configured: true, embedUuid: undefined }), {
    state: 'not-configured',
  });
});

test('decideEmbed: configured but UUID does NOT exist → not-provisioned, never ready (the ghost-dashboard bug)', () => {
  const d = decideEmbed({ configured: true, embedUuid: 'abc', dashboardExists: false });
  assert.equal(d.state, 'not-provisioned');
  assert.equal(d.reason, 'dashboard-uuid-not-found');
});

test('decideEmbed: existence unknown (probe failed) → not-provisioned, not ready', () => {
  const d = decideEmbed({ configured: true, embedUuid: 'abc', dashboardExists: undefined });
  assert.equal(d.state, 'not-provisioned');
});

test('decideEmbed: configured AND UUID verified to exist → ready', () => {
  const d = decideEmbed({ configured: true, embedUuid: 'abc', dashboardExists: true });
  assert.equal(d.state, 'ready');
  assert.equal(d.reason, undefined);
});

// ── dashboard existence / idempotency matchers ────────────────────────────────

const rows: SupersetDashboardRow[] = [
  { id: 1, uuid: 'uuid-a', dashboard_title: 'Something else' },
  { id: 7, uuid: 'uuid-b', dashboard_title: OFFGRID_DASHBOARD_TITLE },
];

test('dashboardExistsInList matches on uuid', () => {
  assert.equal(dashboardExistsInList(rows, 'uuid-b'), true);
  assert.equal(dashboardExistsInList(rows, 'uuid-missing'), false);
  assert.equal(dashboardExistsInList([], 'uuid-b'), false);
});

test('findOwnedDashboard matches the stable Off Grid title', () => {
  assert.equal(findOwnedDashboard(rows)?.id, 7);
  assert.equal(findOwnedDashboard([{ id: 3, dashboard_title: 'x' }]), undefined);
});

test('findByName is generic over the name key', () => {
  const dbs = [
    { id: 2, database_name: 'other' },
    { id: 9, database_name: OFFGRID_DB_NAME },
  ];
  assert.equal(findByName(dbs, 'database_name', OFFGRID_DB_NAME)?.id, 9);
  assert.equal(findByName(dbs, 'database_name', 'nope'), undefined);
});

// ── payload builders ──────────────────────────────────────────────────────────

test('buildDatabasePayload carries the uri and stable name, DML off', () => {
  const p = buildDatabasePayload('postgresql://u:p@h/db');
  assert.equal(p.database_name, OFFGRID_DB_NAME);
  assert.equal(p.sqlalchemy_uri, 'postgresql://u:p@h/db');
  assert.equal(p.allow_dml, false);
  assert.equal(p.expose_in_sqllab, true);
});

test('buildDatasetPayload targets audit_events on the given database', () => {
  const p = buildDatasetPayload(9);
  assert.equal(p.database, 9);
  assert.equal(p.table_name, OFFGRID_DATASET_TABLE);
  assert.equal(p.schema, 'public');
});

test('requests-over-time chart: valid JSON params, day grain, count metric', () => {
  const c = buildRequestsOverTimeChart(5);
  assert.equal(c.datasource_id, 5);
  assert.equal(c.datasource_type, 'table');
  const params = JSON.parse(c.params);
  assert.equal(params.time_grain_sqla, 'P1D');
  assert.equal(params.granularity_sqla, 'ts');
  assert.equal(params.metrics[0].aggregate, 'COUNT');
  assert.equal(params.datasource, '5__table');
});

test('tokens-by-model chart: sum of tokens grouped by model', () => {
  const c = buildTokensByModelChart(5);
  const params = JSON.parse(c.params);
  assert.equal(params.metrics[0].aggregate, 'SUM');
  assert.equal(params.metrics[0].column.column_name, 'tokens');
  assert.deepEqual(params.groupby, ['model']);
});

test('the two charts have distinct names (so find-or-create does not collapse them)', () => {
  assert.notEqual(
    buildRequestsOverTimeChart(1).slice_name,
    buildTokensByModelChart(1).slice_name,
  );
});

test('dashboard create payload uses the stable title', () => {
  assert.equal(buildDashboardCreatePayload().dashboard_title, OFFGRID_DASHBOARD_TITLE);
});

test('dashboard update payload attaches charts into a valid position layout', () => {
  const p = buildDashboardUpdatePayload([11, 22]);
  const layout = JSON.parse(p.position_json);
  // Every chart id ends up in exactly one CHART cell.
  const chartCells = Object.values(layout).filter(
    (n: unknown) => (n as { type?: string }).type === 'CHART',
  ) as { meta: { chartId: number } }[];
  assert.deepEqual(
    chartCells.map((c) => c.meta.chartId).sort(),
    [11, 22],
  );
  // Layout is a well-formed tree rooted at ROOT_ID → GRID_ID → ROW-1.
  assert.deepEqual(layout.ROOT_ID.children, ['GRID_ID']);
  assert.deepEqual(layout.GRID_ID.children, ['ROW-1']);
  assert.equal(layout['ROW-1'].children.length, 2);
});

test('position json handles an empty chart list without throwing', () => {
  const layout = buildDashboardPositionJson([]);
  assert.deepEqual(layout['ROW-1'] && (layout['ROW-1'] as { children: string[] }).children, []);
});
