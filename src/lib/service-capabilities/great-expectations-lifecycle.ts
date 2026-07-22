// Provider-neutral Great Expectations capability contract. PURE: no network, database, auth, or
// framework imports. Routes validate untrusted input here; the HTTP adapter owns the remote boundary.

export const GX_OPERATIONS = [
  'profile',
  'validate',
  'suite.list',
  'suite.read',
  'suite.create',
  'suite.update',
  'suite.delete',
  'history.list',
] as const;

export type GxOperation = (typeof GX_OPERATIONS)[number];
export type GxEngine = 'great-expectations' | 'native-compatibility' | 'unknown';

export interface GxTenantContext {
  orgId: string;
  actor: string;
}

export interface GxExpectationSpec {
  type: string;
  kwargs: Record<string, unknown>;
}

export interface GxSuiteDraft {
  name: string;
  description: string;
  expectations: GxExpectationSpec[];
}

export interface GxSuite extends GxSuiteDraft {
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface GxSuiteUpdate {
  expectedVersion: number;
  description?: string;
  expectations?: GxExpectationSpec[];
}

export interface GxDataSourceRef {
  dataSourceId: string;
  assetName: string;
}

export interface GxProfileRequest extends GxDataSourceRef {
  sampleLimit: number;
}

export interface GxColumnProfile {
  name: string;
  inferredType: string;
  rowCount: number;
  nullCount: number;
  distinctCount: number | null;
  min: string | number | null;
  max: string | number | null;
}

export interface GxProfileResult extends GxDataSourceRef {
  profiledAt: string;
  sampledRows: number;
  columns: GxColumnProfile[];
}

export type GxValidationBatch =
  | { kind: 'asset'; dataSourceId: string; assetName: string; limit: number }
  | { kind: 'inline'; rows: Record<string, unknown>[] };

export interface GxValidationRequest {
  suiteName: string;
  batch: GxValidationBatch;
  idempotencyKey?: string;
}

export interface GxExpectationOutcome {
  type: string;
  success: boolean;
  unexpectedCount: number;
  detail: string;
}

export interface GxValidationRun {
  id: string;
  suiteName: string;
  suiteVersion: number | null;
  success: boolean;
  evaluated: number;
  failed: number;
  outcomes: GxExpectationOutcome[];
  startedAt: string;
  completedAt: string;
  engine: GxEngine;
  engineVersion: string | null;
  dataSourceId: string | null;
  assetName: string | null;
}

export interface GxHistoryQuery {
  suiteName?: string;
  dataSourceId?: string;
  limit: number;
  cursor?: string;
}

export interface GxHistoryPage {
  runs: GxValidationRun[];
  nextCursor: string | null;
}

export interface GxCapabilityManifest {
  serviceReachable: boolean;
  engine: GxEngine;
  engineVersion: string | null;
  operations: Record<GxOperation, boolean>;
  reason: string | null;
}

export type GxFailureKind = 'invalid' | 'unavailable' | 'not-found' | 'conflict' | 'upstream';

export type GxResult<T> =
  | { ok: true; value: T; manifest: GxCapabilityManifest }
  | { ok: false; kind: GxFailureKind; message: string; status: number; manifest: GxCapabilityManifest };

export interface GxLifecyclePort {
  capabilities(context: GxTenantContext): Promise<GxCapabilityManifest>;
  profile(context: GxTenantContext, input: GxProfileRequest): Promise<GxResult<GxProfileResult>>;
  listSuites(context: GxTenantContext): Promise<GxResult<GxSuite[]>>;
  getSuite(context: GxTenantContext, name: string): Promise<GxResult<GxSuite>>;
  createSuite(context: GxTenantContext, input: GxSuiteDraft): Promise<GxResult<GxSuite>>;
  updateSuite(context: GxTenantContext, name: string, input: GxSuiteUpdate): Promise<GxResult<GxSuite>>;
  deleteSuite(context: GxTenantContext, name: string, expectedVersion?: number): Promise<GxResult<{ deleted: true }>>;
  runValidation(context: GxTenantContext, input: GxValidationRequest): Promise<GxResult<GxValidationRun>>;
  history(context: GxTenantContext, query: GxHistoryQuery): Promise<GxResult<GxHistoryPage>>;
}

export interface ParseResult<T> {
  ok: boolean;
  errors: string[];
  value: T | null;
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const EXPECTATION = /^expect_[a-z0-9_]{3,120}$/;
const MAX_EXPECTATIONS = 200;
const MAX_INLINE_ROWS = 5_000;
const MAX_PROFILE_ROWS = 100_000;
const DEFAULT_SAMPLE_LIMIT = 1_000;
const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function identifier(value: unknown, label: string, errors: string[]): string {
  const normalized = text(value);
  if (!IDENTIFIER.test(normalized)) errors.push(`${label} must be 1-128 letters, numbers, dots, dashes, or underscores.`);
  return normalized;
}

function positiveInteger(value: unknown, fallback: number, max: number, label: string, errors: string[]): number {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    errors.push(`${label} must be an integer between 1 and ${max}.`);
    return fallback;
  }
  return value;
}

export function parseTenantContext(input: unknown): ParseResult<GxTenantContext> {
  const raw = object(input) ?? {};
  const errors: string[] = [];
  const orgId = identifier(raw.orgId, 'orgId', errors);
  const actor = text(raw.actor);
  if (!actor || actor.length > 320) errors.push('actor is required and must be at most 320 characters.');
  return errors.length ? { ok: false, errors, value: null } : { ok: true, errors: [], value: { orgId, actor } };
}

function parseExpectations(value: unknown, errors: string[]): GxExpectationSpec[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EXPECTATIONS) {
    errors.push(`expectations must contain between 1 and ${MAX_EXPECTATIONS} entries.`);
    return [];
  }
  return value.map((candidate, index) => {
    const raw = object(candidate) ?? {};
    const type = text(raw.type);
    if (!EXPECTATION.test(type)) errors.push(`expectations[${index}].type must be a Great Expectations expectation name.`);
    const kwargs = object(raw.kwargs);
    if (!kwargs) errors.push(`expectations[${index}].kwargs must be an object.`);
    return { type, kwargs: kwargs ?? {} };
  });
}

export function parseSuiteDraft(input: unknown): ParseResult<GxSuiteDraft> {
  const raw = object(input) ?? {};
  const errors: string[] = [];
  const name = identifier(raw.name, 'name', errors);
  const description = text(raw.description);
  if (description.length > 1_000) errors.push('description must be at most 1000 characters.');
  const expectations = parseExpectations(raw.expectations, errors);
  return errors.length
    ? { ok: false, errors, value: null }
    : { ok: true, errors: [], value: { name, description, expectations } };
}

export function parseSuiteUpdate(input: unknown): ParseResult<GxSuiteUpdate> {
  const raw = object(input) ?? {};
  const errors: string[] = [];
  const expectedVersion = positiveInteger(raw.expectedVersion, 0, Number.MAX_SAFE_INTEGER, 'expectedVersion', errors);
  const description = raw.description === undefined ? undefined : text(raw.description);
  if (description !== undefined && description.length > 1_000) errors.push('description must be at most 1000 characters.');
  const expectations = raw.expectations === undefined ? undefined : parseExpectations(raw.expectations, errors);
  if (description === undefined && expectations === undefined) errors.push('at least one of description or expectations is required.');
  return errors.length
    ? { ok: false, errors, value: null }
    : { ok: true, errors: [], value: { expectedVersion, description, expectations } };
}

export function parseProfileRequest(input: unknown): ParseResult<GxProfileRequest> {
  const raw = object(input) ?? {};
  const errors: string[] = [];
  const dataSourceId = identifier(raw.dataSourceId, 'dataSourceId', errors);
  const assetName = identifier(raw.assetName, 'assetName', errors);
  const sampleLimit = positiveInteger(raw.sampleLimit, DEFAULT_SAMPLE_LIMIT, MAX_PROFILE_ROWS, 'sampleLimit', errors);
  return errors.length
    ? { ok: false, errors, value: null }
    : { ok: true, errors: [], value: { dataSourceId, assetName, sampleLimit } };
}

export function parseValidationRequest(input: unknown): ParseResult<GxValidationRequest> {
  const raw = object(input) ?? {};
  const errors: string[] = [];
  const suiteName = identifier(raw.suiteName, 'suiteName', errors);
  const batchRaw = object(raw.batch) ?? {};
  let batch: GxValidationBatch;
  if (batchRaw.kind === 'inline') {
    const rows = Array.isArray(batchRaw.rows) ? batchRaw.rows.map(object).filter((row): row is Record<string, unknown> => row !== null) : [];
    if (!Array.isArray(batchRaw.rows) || rows.length !== batchRaw.rows.length || rows.length > MAX_INLINE_ROWS) {
      errors.push(`inline rows must contain at most ${MAX_INLINE_ROWS} objects.`);
    }
    batch = { kind: 'inline', rows };
  } else if (batchRaw.kind === 'asset') {
    const dataSourceId = identifier(batchRaw.dataSourceId, 'batch.dataSourceId', errors);
    const assetName = identifier(batchRaw.assetName, 'batch.assetName', errors);
    const limit = positiveInteger(batchRaw.limit, DEFAULT_SAMPLE_LIMIT, MAX_PROFILE_ROWS, 'batch.limit', errors);
    batch = { kind: 'asset', dataSourceId, assetName, limit };
  } else {
    errors.push('batch.kind must be inline or asset.');
    batch = { kind: 'inline', rows: [] };
  }
  const idempotencyKey = raw.idempotencyKey === undefined ? undefined : identifier(raw.idempotencyKey, 'idempotencyKey', errors);
  return errors.length
    ? { ok: false, errors, value: null }
    : { ok: true, errors: [], value: { suiteName, batch, idempotencyKey } };
}

export function parseHistoryQuery(input: unknown): ParseResult<GxHistoryQuery> {
  const raw = object(input) ?? {};
  const errors: string[] = [];
  const suiteName = raw.suiteName === undefined || raw.suiteName === '' ? undefined : identifier(raw.suiteName, 'suiteName', errors);
  const dataSourceId = raw.dataSourceId === undefined || raw.dataSourceId === '' ? undefined : identifier(raw.dataSourceId, 'dataSourceId', errors);
  const limit = positiveInteger(raw.limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT, 'limit', errors);
  const cursor = raw.cursor === undefined || raw.cursor === '' ? undefined : text(raw.cursor);
  if (cursor && (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))) errors.push('cursor is invalid.');
  return errors.length
    ? { ok: false, errors, value: null }
    : { ok: true, errors: [], value: { suiteName, dataSourceId, limit, cursor } };
}

export function unavailableManifest(reason: string, reachable = false, engine: GxEngine = 'unknown'): GxCapabilityManifest {
  return {
    serviceReachable: reachable,
    engine,
    engineVersion: null,
    operations: Object.fromEntries(GX_OPERATIONS.map((operation) => [operation, false])) as Record<GxOperation, boolean>,
    reason,
  };
}

export function parseCapabilityManifest(input: unknown): GxCapabilityManifest {
  const raw = object(input);
  if (!raw) return unavailableManifest('The Great Expectations capability manifest was malformed.');
  const engineRaw = text(raw.engine);
  const engine: GxEngine = engineRaw === 'great-expectations'
    ? 'great-expectations'
    : engineRaw === 'native' || engineRaw === 'native-compatibility'
      ? 'native-compatibility'
      : 'unknown';
  const advertised = object(raw.operations) ?? {};
  const operations = Object.fromEntries(
    GX_OPERATIONS.map((operation) => [operation, advertised[operation] === true]),
  ) as Record<GxOperation, boolean>;
  return {
    serviceReachable: raw.status === 'ok' || raw.serviceReachable === true,
    engine,
    engineVersion: text(raw.engineVersion) || null,
    operations,
    reason: text(raw.reason) || null,
  };
}

export function operationUnavailable<T>(manifest: GxCapabilityManifest, operation: GxOperation): GxResult<T> {
  const engine = manifest.engine === 'great-expectations' ? 'Great Expectations' : 'the native compatibility engine';
  return {
    ok: false,
    kind: 'unavailable',
    status: 501,
    message: `${operation} is not exposed by ${engine}.`,
    manifest,
  };
}
