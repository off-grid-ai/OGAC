import {
  operationUnavailable,
  parseCapabilityManifest,
  parseTenantContext,
  unavailableManifest,
  type GxCapabilityManifest,
  type GxHistoryPage,
  type GxHistoryQuery,
  type GxLifecyclePort,
  type GxOperation,
  type GxProfileRequest,
  type GxProfileResult,
  type GxResult,
  type GxSuite,
  type GxSuiteDraft,
  type GxSuiteUpdate,
  type GxTenantContext,
  type GxValidationRequest,
  type GxValidationRun,
} from '@/lib/service-capabilities/great-expectations-lifecycle';

// Real network boundary for the versioned Off Grid Great Expectations lifecycle sidecar contract.
// The currently deployed compatibility sidecar does not expose this contract, so capability
// negotiation makes every absent operation an explicit 501 instead of fabricating lifecycle state.

const DEFAULT_URL = 'http://127.0.0.1:8944';
const TIMEOUT_MS = 10_000;
const CAPABILITY_TIMEOUT_MS = 2_500;

interface AdapterConfig {
  baseUrl?: string;
  token?: string;
}

interface RequestSpec<T> {
  operation: GxOperation;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  decode: (body: unknown) => T | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function decodeSuite(value: unknown): GxSuite | null {
  const raw = record(value);
  if (!raw || !text(raw.name) || !Number.isInteger(raw.version) || (raw.version as number) < 1) return null;
  if (!Array.isArray(raw.expectations) || !text(raw.createdAt) || !text(raw.updatedAt)) return null;
  const expectations = raw.expectations.map((candidate) => {
    const expectation = record(candidate);
    const kwargs = record(expectation?.kwargs);
    return expectation && text(expectation.type) && kwargs
      ? { type: text(expectation.type), kwargs }
      : null;
  });
  if (expectations.some((item) => item === null)) return null;
  return {
    name: text(raw.name),
    description: text(raw.description),
    expectations: expectations as GxSuite['expectations'],
    version: raw.version as number,
    createdAt: text(raw.createdAt),
    updatedAt: text(raw.updatedAt),
  };
}

function decodeProfile(value: unknown): GxProfileResult | null {
  const raw = record(value);
  if (!raw || !text(raw.dataSourceId) || !text(raw.assetName) || !text(raw.profiledAt)) return null;
  if (!Number.isInteger(raw.sampledRows) || (raw.sampledRows as number) < 0 || !Array.isArray(raw.columns)) return null;
  const columns = raw.columns.map((candidate) => {
    const column = record(candidate);
    const rowCount = finiteNumber(column?.rowCount);
    const nullCount = finiteNumber(column?.nullCount);
    const distinctCount = column?.distinctCount === null ? null : finiteNumber(column?.distinctCount);
    if (!column || !text(column.name) || !text(column.inferredType) || rowCount === null || nullCount === null) return null;
    if (column.distinctCount !== null && distinctCount === null) return null;
    const min = typeof column.min === 'string' || typeof column.min === 'number' ? column.min : null;
    const max = typeof column.max === 'string' || typeof column.max === 'number' ? column.max : null;
    return { name: text(column.name), inferredType: text(column.inferredType), rowCount, nullCount, distinctCount, min, max };
  });
  if (columns.some((column) => column === null)) return null;
  return {
    dataSourceId: text(raw.dataSourceId),
    assetName: text(raw.assetName),
    profiledAt: text(raw.profiledAt),
    sampledRows: raw.sampledRows as number,
    columns: columns as GxProfileResult['columns'],
  };
}

function decodeValidation(value: unknown): GxValidationRun | null {
  const raw = record(value);
  if (!raw || !text(raw.id) || !text(raw.suiteName) || !text(raw.startedAt) || !text(raw.completedAt)) return null;
  if (typeof raw.success !== 'boolean' || !Number.isInteger(raw.evaluated) || !Number.isInteger(raw.failed)) return null;
  if (!Array.isArray(raw.outcomes)) return null;
  const outcomes = raw.outcomes.map((candidate) => {
    const outcome = record(candidate);
    if (!outcome || !text(outcome.type) || typeof outcome.success !== 'boolean' || !Number.isInteger(outcome.unexpectedCount)) return null;
    return {
      type: text(outcome.type),
      success: outcome.success,
      unexpectedCount: outcome.unexpectedCount as number,
      detail: text(outcome.detail),
    };
  });
  if (outcomes.some((outcome) => outcome === null)) return null;
  const engine = raw.engine === 'great-expectations' || raw.engine === 'native-compatibility' ? raw.engine : 'unknown';
  return {
    id: text(raw.id),
    suiteName: text(raw.suiteName),
    suiteVersion: raw.suiteVersion === null ? null : finiteNumber(raw.suiteVersion),
    success: raw.success,
    evaluated: raw.evaluated as number,
    failed: raw.failed as number,
    outcomes: outcomes as GxValidationRun['outcomes'],
    startedAt: text(raw.startedAt),
    completedAt: text(raw.completedAt),
    engine,
    engineVersion: raw.engineVersion === null ? null : text(raw.engineVersion) || null,
    dataSourceId: raw.dataSourceId === null ? null : text(raw.dataSourceId) || null,
    assetName: raw.assetName === null ? null : text(raw.assetName) || null,
  };
}

function failure<T>(
  manifest: GxCapabilityManifest,
  kind: 'invalid' | 'not-found' | 'conflict' | 'upstream',
  message: string,
  status: number,
): GxResult<T> {
  return { ok: false, kind, message, status, manifest };
}

function responseMessage(body: unknown, fallback: string): string {
  const raw = record(body);
  return text(raw?.error) || text(raw?.message) || fallback;
}

export function createGreatExpectationsLifecycleAdapter(config: AdapterConfig = {}): GxLifecyclePort {
  const configuredUrl = () => (config.baseUrl ?? process.env.OFFGRID_GX_LIFECYCLE_URL ?? process.env.OFFGRID_DATAQUALITY_URL ?? DEFAULT_URL).replace(/\/$/, '');
  const configuredToken = () => config.token ?? process.env.OFFGRID_GX_LIFECYCLE_TOKEN ?? '';

  function authHeaders(context: GxTenantContext): Record<string, string> | null {
    const parsed = parseTenantContext(context);
    const token = configuredToken().trim();
    if (!parsed.ok || !parsed.value || !token) return null;
    return {
      authorization: `Bearer ${token}`,
      'x-offgrid-org-id': parsed.value.orgId,
      'x-offgrid-actor': parsed.value.actor,
    };
  }

  async function capabilities(context: GxTenantContext): Promise<GxCapabilityManifest> {
    const headers = authHeaders(context);
    if (!headers) {
      return unavailableManifest('Great Expectations lifecycle credentials or tenant context are not configured.');
    }
    try {
      const response = await fetch(`${configuredUrl()}/v1/capabilities`, {
        headers,
        signal: AbortSignal.timeout(CAPABILITY_TIMEOUT_MS),
      });
      if (!response.ok) {
        return unavailableManifest(`Great Expectations lifecycle manifest returned HTTP ${response.status}.`, response.status < 500);
      }
      const manifest = parseCapabilityManifest(await response.json().catch(() => null));
      if (!manifest.serviceReachable) return { ...manifest, reason: manifest.reason ?? 'Great Expectations lifecycle service is not ready.' };
      return manifest;
    } catch (error) {
      return unavailableManifest(`Great Expectations lifecycle service is unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function request<T>(context: GxTenantContext, spec: RequestSpec<T>): Promise<GxResult<T>> {
    const parsedContext = parseTenantContext(context);
    if (!parsedContext.ok || !parsedContext.value) {
      return failure(unavailableManifest('Tenant context is invalid.'), 'invalid', parsedContext.errors.join('; '), 400);
    }
    const manifest = await capabilities(parsedContext.value);
    if (!manifest.operations[spec.operation]) return operationUnavailable(manifest, spec.operation);
    const headers = authHeaders(parsedContext.value);
    if (!headers) return failure(manifest, 'upstream', 'Great Expectations lifecycle credentials are unavailable.', 502);

    try {
      const response = await fetch(`${configuredUrl()}${spec.path}`, {
        method: spec.method,
        headers: { ...headers, ...(spec.body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = response.status === 204 ? { deleted: true } : await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 400 || response.status === 422) return failure(manifest, 'invalid', responseMessage(body, 'Great Expectations rejected the request.'), 400);
        if (response.status === 404) return failure(manifest, 'not-found', responseMessage(body, 'Great Expectations resource was not found.'), 404);
        if (response.status === 409) return failure(manifest, 'conflict', responseMessage(body, 'Great Expectations resource version conflicts.'), 409);
        return failure(manifest, 'upstream', responseMessage(body, `Great Expectations returned HTTP ${response.status}.`), 502);
      }
      const value = spec.decode(body);
      return value === null
        ? failure(manifest, 'upstream', 'Great Expectations returned a malformed response.', 502)
        : { ok: true, value, manifest };
    } catch (error) {
      return failure(manifest, 'upstream', `Great Expectations request failed: ${error instanceof Error ? error.message : String(error)}`, 502);
    }
  }

  return {
    capabilities,
    profile: (context, input) => request(context, { operation: 'profile', method: 'POST', path: '/v1/profiles', body: input, decode: decodeProfile }),
    listSuites: (context) => request(context, {
      operation: 'suite.list', method: 'GET', path: '/v1/suites',
      decode: (body) => {
        const raw = record(body);
        const candidates = Array.isArray(body) ? body : Array.isArray(raw?.suites) ? raw.suites : null;
        if (!candidates) return null;
        const suites = candidates.map(decodeSuite);
        return suites.some((suite) => suite === null) ? null : suites as GxSuite[];
      },
    }),
    getSuite: (context, name) => request(context, { operation: 'suite.read', method: 'GET', path: `/v1/suites/${encodeURIComponent(name)}`, decode: decodeSuite }),
    createSuite: (context, input) => request(context, { operation: 'suite.create', method: 'POST', path: '/v1/suites', body: input, decode: decodeSuite }),
    updateSuite: (context, name, input) => request(context, { operation: 'suite.update', method: 'PATCH', path: `/v1/suites/${encodeURIComponent(name)}`, body: input, decode: decodeSuite }),
    deleteSuite: (context, name, expectedVersion) => request(context, {
      operation: 'suite.delete', method: 'DELETE',
      path: `/v1/suites/${encodeURIComponent(name)}${expectedVersion === undefined ? '' : `?expectedVersion=${expectedVersion}`}`,
      decode: (body) => record(body)?.deleted === true ? { deleted: true } : null,
    }),
    runValidation: (context, input) => request(context, { operation: 'validate', method: 'POST', path: '/v1/validations', body: input, decode: decodeValidation }),
    history: (context, query) => {
      const params = new URLSearchParams({ limit: String(query.limit) });
      if (query.suiteName) params.set('suiteName', query.suiteName);
      if (query.dataSourceId) params.set('dataSourceId', query.dataSourceId);
      if (query.cursor) params.set('cursor', query.cursor);
      return request(context, {
        operation: 'history.list', method: 'GET', path: `/v1/validations?${params}`,
        decode: (body) => {
          const raw = record(body);
          if (!raw || !Array.isArray(raw.runs)) return null;
          const runs = raw.runs.map(decodeValidation);
          if (runs.some((run) => run === null)) return null;
          return { runs: runs as GxValidationRun[], nextCursor: raw.nextCursor === null ? null : text(raw.nextCursor) || null } satisfies GxHistoryPage;
        },
      });
    },
  };
}

export const greatExpectationsLifecycle = createGreatExpectationsLifecycleAdapter();
