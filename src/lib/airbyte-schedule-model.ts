// ─── Airbyte schedule / sync-mode model — PURE logic, zero I/O ────────────────
// SOLID: everything here is a pure function. The adapter (src/lib/adapters/airbyte.ts) reads a
// connection over Airbyte's POST config API, hands the raw ConnectionRead here to be reshaped into a
// mutable ConnectionUpdate, and posts the result back — this file decides every field. No fetch, no
// env, no IO imports, so it is exhaustively unit-testable with no mocks and no live box.
//
// Airbyte 0.63.15 scheduling: a connection carries `scheduleType` (manual | basic | cron) +
// `scheduleData`. Per-stream sync behaviour lives in `syncCatalog.streams[].config`
// (syncMode + destinationSyncMode). CDC is a SOURCE-connector configuration (replication method),
// not a connection sync mode — we surface it read-only from the stream shape when detectable.

// ─── Schedule types ──────────────────────────────────────────────────────────
export type ScheduleType = 'manual' | 'basic' | 'cron';

// The five Airbyte basic-schedule time units. `minutes` is Airbyte-valid but discouraged for real
// connections; we keep it because the API accepts it and an operator may want a fast demo cadence.
export const TIME_UNITS = ['minutes', 'hours', 'days', 'weeks', 'months'] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];

export function isTimeUnit(v: unknown): v is TimeUnit {
  return typeof v === 'string' && (TIME_UNITS as readonly string[]).includes(v);
}

// The console's compact sync-mode vocabulary — the four combinations Airbyte exposes as
// (syncMode × destinationSyncMode). CDC is orthogonal (source replication method), reported
// separately by the stream's `cdc` flag.
export type SyncModeChoice =
  | 'full_refresh_overwrite'
  | 'full_refresh_append'
  | 'incremental_append'
  | 'incremental_dedup';

export const SYNC_MODE_CHOICES: readonly SyncModeChoice[] = [
  'full_refresh_overwrite',
  'full_refresh_append',
  'incremental_append',
  'incremental_dedup',
];

export interface ScheduleInput {
  type: ScheduleType;
  // basic
  units?: number;
  timeUnit?: string;
  // cron
  cronExpression?: string;
  cronTimeZone?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// A Quartz cron expression is 6 or 7 whitespace-separated fields (Airbyte uses Quartz). We don't
// re-implement Quartz semantics; we reject anything that clearly isn't a Quartz expression
// (wrong field count, illegal characters) so a typo fails here instead of at the Airbyte boundary.
const CRON_FIELD = /^[0-9A-Z*?/,\-#L W]+$/i;

export function validateCron(expr: unknown): boolean {
  if (typeof expr !== 'string') return false;
  const fields = expr.trim().split(/\s+/);
  if (fields.length < 6 || fields.length > 7) return false;
  return fields.every((f) => f.length > 0 && CRON_FIELD.test(f));
}

// A few Quartz presets so the UI can offer common cadences without the operator hand-writing cron.
export const CRON_PRESETS: readonly { label: string; expression: string }[] = [
  { label: 'Every hour', expression: '0 0 * * * ?' },
  { label: 'Every 6 hours', expression: '0 0 */6 * * ?' },
  { label: 'Daily at 02:00', expression: '0 0 2 * * ?' },
  { label: 'Weekdays at 06:00', expression: '0 0 6 ? * MON-FRI' },
  { label: 'Weekly (Sun 00:00)', expression: '0 0 0 ? * SUN' },
];

// Validate a schedule change before it ever reaches Airbyte. Pure — returns every problem at once so
// a form can render them together rather than one-at-a-time.
export function validateScheduleInput(input: ScheduleInput): ValidationResult {
  const errors: string[] = [];
  if (input.type === 'manual') {
    // nothing to validate — manual carries no cadence
  } else if (input.type === 'basic') {
    const units = Number(input.units);
    if (!Number.isInteger(units) || units <= 0) {
      errors.push('units must be a positive whole number');
    }
    if (!isTimeUnit(input.timeUnit)) {
      errors.push(`timeUnit must be one of: ${TIME_UNITS.join(', ')}`);
    }
  } else if (input.type === 'cron') {
    if (!validateCron(input.cronExpression)) {
      errors.push('cronExpression must be a valid 6- or 7-field Quartz cron expression');
    }
  } else {
    errors.push(`unknown schedule type: ${String((input as { type?: unknown }).type)}`);
  }
  return { ok: errors.length === 0, errors };
}

// ─── ConnectionUpdate field whitelist ─────────────────────────────────────────
// Airbyte's /connections/update expects a ConnectionUpdate, NOT the ConnectionRead that
// /connections/get returns. ConnectionRead carries read-only fields (sourceId, destinationId,
// breakingChange, isSyncing, …) that update rejects. We whitelist only the mutable ConnectionUpdate
// fields so a get→merge→update round-trip never carries an illegal field. connectionId is always
// required.
const CONNECTION_UPDATE_FIELDS = [
  'connectionId',
  'name',
  'namespaceDefinition',
  'namespaceFormat',
  'prefix',
  'operationIds',
  'syncCatalog',
  'scheduleType',
  'scheduleData',
  'status',
  'resourceRequirements',
  'sourceCatalogId',
  'geography',
  'notifySchemaChanges',
  'nonBreakingChangesPreference',
] as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Reduce a raw ConnectionRead to a mutable ConnectionUpdate carrying only the whitelisted fields.
// Returns null when the connection has no connectionId (nothing safe to update).
export function pickConnectionUpdateFields(
  connection: unknown,
): Record<string, unknown> | null {
  if (!isObj(connection)) return null;
  const id = connection.connectionId;
  if (typeof id !== 'string' || !id) return null;
  const update: Record<string, unknown> = {};
  for (const key of CONNECTION_UPDATE_FIELDS) {
    if (connection[key] !== undefined) update[key] = connection[key];
  }
  return update;
}

// Build the { scheduleType, scheduleData } fields for a schedule change. Manual carries no
// scheduleData (Airbyte reads only the type). Assumes the input already passed validateScheduleInput.
export function buildScheduleData(input: ScheduleInput): {
  scheduleType: ScheduleType;
  scheduleData?: Record<string, unknown>;
} {
  if (input.type === 'manual') return { scheduleType: 'manual' };
  if (input.type === 'basic') {
    return {
      scheduleType: 'basic',
      scheduleData: { basicSchedule: { timeUnit: input.timeUnit, units: Number(input.units) } },
    };
  }
  return {
    scheduleType: 'cron',
    scheduleData: {
      cron: {
        cronExpression: String(input.cronExpression).trim(),
        cronTimeZone: input.cronTimeZone?.trim() || 'UTC',
      },
    },
  };
}

// Merge a validated schedule change into a picked ConnectionUpdate. Sets scheduleType/scheduleData,
// and strips the legacy top-level `schedule` field (mutually exclusive with scheduleType — leaving
// both trips Airbyte's validation). Pure: returns a NEW object, never mutates the input.
export function applyScheduleToUpdate(
  update: Record<string, unknown>,
  input: ScheduleInput,
): Record<string, unknown> {
  const { scheduleType, scheduleData } = buildScheduleData(input);
  const next: Record<string, unknown> = { ...update, scheduleType };
  if (scheduleData) next.scheduleData = scheduleData;
  else delete next.scheduleData;
  delete next.schedule; // legacy field, incompatible with scheduleType
  return next;
}

// Map the console sync-mode vocabulary → Airbyte's (syncMode, destinationSyncMode) pair.
export function mapSyncModeChoice(choice: SyncModeChoice): {
  syncMode: string;
  destinationSyncMode: string;
} {
  switch (choice) {
    case 'full_refresh_overwrite':
      return { syncMode: 'full_refresh', destinationSyncMode: 'overwrite' };
    case 'full_refresh_append':
      return { syncMode: 'full_refresh', destinationSyncMode: 'append' };
    case 'incremental_append':
      return { syncMode: 'incremental', destinationSyncMode: 'append' };
    case 'incremental_dedup':
      return { syncMode: 'incremental', destinationSyncMode: 'append_dedup' };
  }
}

// Fold an Airbyte (syncMode, destinationSyncMode) pair back into the console vocabulary. Unknown
// combinations fall back to full_refresh_overwrite (the safest default label).
export function classifySyncMode(
  syncMode: unknown,
  destinationSyncMode: unknown,
): SyncModeChoice {
  const s = String(syncMode ?? '').toLowerCase();
  const d = String(destinationSyncMode ?? '').toLowerCase();
  if (s === 'incremental') return d === 'append_dedup' ? 'incremental_dedup' : 'incremental_append';
  return d === 'append' ? 'full_refresh_append' : 'full_refresh_overwrite';
}

// Apply a sync-mode change to ONE stream inside a picked ConnectionUpdate's syncCatalog. Matches the
// stream by name (Airbyte stream names are unique per namespace; we match on name for the common
// single-namespace case). Returns a NEW update object; if the stream isn't found the catalog is
// unchanged. incremental modes require a cursor — callers validate cursor presence separately.
export function applySyncModeToStream(
  update: Record<string, unknown>,
  streamName: string,
  choice: SyncModeChoice,
): Record<string, unknown> {
  const catalog = isObj(update.syncCatalog) ? update.syncCatalog : undefined;
  const streams = catalog && Array.isArray(catalog.streams) ? catalog.streams : undefined;
  if (!streams) return { ...update };
  const { syncMode, destinationSyncMode } = mapSyncModeChoice(choice);
  const nextStreams = streams.map((entry) => {
    if (!isObj(entry)) return entry;
    const stream = isObj(entry.stream) ? entry.stream : undefined;
    const name = stream ? String(stream.name ?? '') : '';
    if (name !== streamName) return entry;
    const config = isObj(entry.config) ? entry.config : {};
    return { ...entry, config: { ...config, syncMode, destinationSyncMode, selected: true } };
  });
  return { ...update, syncCatalog: { ...catalog, streams: nextStreams } };
}

// ─── Connection detail (read view) ─────────────────────────────────────────────
export interface StreamDetail {
  name: string;
  namespace?: string;
  syncMode: SyncModeChoice;
  cursorField?: string[];
  primaryKey?: string[][];
  cdc: boolean;
}

export interface ConnectionDetail {
  connectionId: string;
  name: string;
  status: string;
  scheduleType: ScheduleType;
  cronExpression?: string;
  cronTimeZone?: string;
  intervalUnits?: number;
  intervalTimeUnit?: string;
  scheduleLabel: string;
  streams: StreamDetail[];
}

function optStrArr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string');
  return out.length ? out : undefined;
}

// A stream carries CDC when its cursor is Airbyte's internal CDC cursor (_ab_cdc_*). Best-effort,
// read-only — CDC is a source-connector replication method, not a connection-level sync mode.
function detectCdc(
  stream: Record<string, unknown> | undefined,
  config: Record<string, unknown>,
): boolean {
  const cursor =
    optStrArr(config.cursorField) ?? (stream ? optStrArr(stream.defaultCursorField) : undefined);
  return cursor?.some((c) => c.toLowerCase().startsWith('_ab_cdc')) ?? false;
}

// Normalize a raw ConnectionRead into the compact console detail view. Never throws — a malformed
// shape yields sensible defaults (manual, empty streams) so the detail page renders honestly.
export function normalizeConnectionDetail(raw: unknown): ConnectionDetail {
  const r = isObj(raw) ? raw : {};
  const scheduleType = normalizeScheduleType(r.scheduleType, r.schedule);
  const detail: ConnectionDetail = {
    connectionId: typeof r.connectionId === 'string' ? r.connectionId : '',
    name: typeof r.name === 'string' && r.name ? r.name : String(r.connectionId ?? 'connection'),
    status: typeof r.status === 'string' ? r.status : 'unknown',
    scheduleType,
    scheduleLabel: 'manual',
    streams: [],
  };

  const data = isObj(r.scheduleData) ? r.scheduleData : undefined;
  if (scheduleType === 'cron') {
    const cron = data && isObj(data.cron) ? data.cron : undefined;
    detail.cronExpression =
      cron && typeof cron.cronExpression === 'string' ? cron.cronExpression : undefined;
    detail.cronTimeZone =
      cron && typeof cron.cronTimeZone === 'string' ? cron.cronTimeZone : undefined;
    detail.scheduleLabel = detail.cronExpression ? `cron: ${detail.cronExpression}` : 'cron';
  } else if (scheduleType === 'basic') {
    const basic = data && isObj(data.basicSchedule) ? data.basicSchedule : undefined;
    const legacy = !basic && isObj(r.schedule) ? r.schedule : undefined;
    const units = Number((basic?.units ?? legacy?.units) as unknown);
    const timeUnit = String((basic?.timeUnit ?? legacy?.timeUnit) ?? '');
    if (Number.isFinite(units) && timeUnit) {
      detail.intervalUnits = units;
      detail.intervalTimeUnit = timeUnit;
      detail.scheduleLabel = `every ${units} ${timeUnit}`;
    } else {
      detail.scheduleLabel = 'basic';
    }
  }

  const catalog = isObj(r.syncCatalog) ? r.syncCatalog : undefined;
  const streams = catalog && Array.isArray(catalog.streams) ? catalog.streams : [];
  detail.streams = streams
    .map((entry): StreamDetail | null => {
      if (!isObj(entry)) return null;
      const stream = isObj(entry.stream) ? entry.stream : undefined;
      const config = isObj(entry.config) ? entry.config : {};
      const name = stream && typeof stream.name === 'string' ? stream.name : '';
      if (!name) return null;
      return {
        name,
        namespace: stream && typeof stream.namespace === 'string' ? stream.namespace : undefined,
        syncMode: classifySyncMode(config.syncMode, config.destinationSyncMode),
        cursorField: optStrArr(config.cursorField),
        primaryKey: Array.isArray(config.primaryKey)
          ? (config.primaryKey as unknown[]).map((k) => optStrArr(k) ?? []).filter((k) => k.length)
          : undefined,
        cdc: detectCdc(stream, config),
      };
    })
    .filter((s): s is StreamDetail => s !== null);

  return detail;
}

// ─── Compose helpers — the whole get→pick→validate→apply decision, pure ───────
// A route hands the raw ConnectionRead + the requested change here and gets back either a ready-to-
// POST ConnectionUpdate or a reason. This keeps the route a thin I/O shell (fetch → build → post).
export type BuildResult =
  | { ok: true; update: Record<string, unknown> }
  | { ok: false; error: string };

export function buildScheduleUpdate(raw: unknown, input: ScheduleInput): BuildResult {
  const valid = validateScheduleInput(input);
  if (!valid.ok) return { ok: false, error: valid.errors.join('; ') };
  const picked = pickConnectionUpdateFields(raw);
  if (!picked) return { ok: false, error: 'connection not found' };
  return { ok: true, update: applyScheduleToUpdate(picked, input) };
}

export function buildSyncModeUpdate(
  raw: unknown,
  streamName: string,
  choice: SyncModeChoice,
): BuildResult {
  if (typeof streamName !== 'string' || !streamName.trim()) {
    return { ok: false, error: 'streamName is required' };
  }
  if (!SYNC_MODE_CHOICES.includes(choice)) {
    return { ok: false, error: `mode must be one of: ${SYNC_MODE_CHOICES.join(', ')}` };
  }
  const picked = pickConnectionUpdateFields(raw);
  if (!picked) return { ok: false, error: 'connection not found' };
  // Guard: incremental modes need a cursor already configured on the stream (Airbyte rejects an
  // incremental stream with no cursor). Read the current detail to check.
  const detail = normalizeConnectionDetail(raw);
  const stream = detail.streams.find((s) => s.name === streamName);
  if (!stream) return { ok: false, error: `stream not found: ${streamName}` };
  const isIncremental = choice === 'incremental_append' || choice === 'incremental_dedup';
  if (isIncremental && !(stream.cursorField && stream.cursorField.length)) {
    return {
      ok: false,
      error: `stream "${streamName}" has no cursor field — incremental sync needs one`,
    };
  }
  if (choice === 'incremental_dedup' && !(stream.primaryKey && stream.primaryKey.length)) {
    return {
      ok: false,
      error: `stream "${streamName}" has no primary key — deduped sync needs one`,
    };
  }
  return { ok: true, update: applySyncModeToStream(picked, streamName, choice) };
}

// Fold Airbyte's scheduleType (+ legacy schedule presence) onto our three-value vocabulary.
function normalizeScheduleType(rawType: unknown, legacySchedule: unknown): ScheduleType {
  const t = String(rawType ?? '').toLowerCase();
  if (t === 'cron') return 'cron';
  if (t === 'basic') return 'basic';
  if (t === 'manual') return 'manual';
  // No scheduleType but a legacy `schedule` object → basic cadence.
  if (isObj(legacySchedule)) return 'basic';
  return 'manual';
}
