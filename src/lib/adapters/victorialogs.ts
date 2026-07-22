// ─── VictoriaLogs adapter (I/O half of the centralized log-search surface) ───────
// Thin fetch client over the VictoriaLogs LogsQL HTTP API. SOLID: this module ONLY does I/O — every
// query string, parse, shape and clamp is delegated to the zero-IO src/lib/victorialogs-query.ts
// (and the reused victoria-logs-shape.ts). Graceful-degrade like the other read adapters
// (warehouse.ts, victoria-logs.ts): `configured:false` when no base URL, an honest `error` string
// (never a throw into the route) when the box is unreachable / non-2xx.
//
//   OFFGRID_VICTORIALOGS_URL — e.g. http://127.0.0.1:9428  (no auth on the deployed instance)

import type { AdapterMeta } from './types';
import {
  type FieldValue,
  type HistogramSeries,
  type LogRow,
  type RetentionInfo,
  clampLimit,
  normalizeFieldValues,
  parseLogsResponse,
  parseRetentionFlags,
  shapeHits,
} from '@/lib/victorialogs-query';

const env = process.env;
const TIMEOUT_MS = 8000;

// Read the base URL lazily on each call (env isn't captured at import time) so a test / a late-set
// deploy env still resolves. Trailing slash trimmed for clean path joins.
function baseUrl(): string | undefined {
  const raw = env.OFFGRID_VICTORIALOGS_URL;
  return raw ? raw.replace(/\/$/, '') : undefined;
}

export function victoriaLogsConfigured(): boolean {
  return Boolean(baseUrl());
}

// Flatten a thrown value to a diagnosable one-liner; fetch failures hide the errno on err.cause.code.
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { code?: unknown } }).cause;
    const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
    return code ? `${err.message} [${code}]` : err.message;
  }
  return String(err);
}

interface Options {
  start?: string;
  end?: string;
  step?: string;
  limit?: number;
}

// GET a VictoriaLogs endpoint with the given query params; returns the raw response text. Throws on
// transport / non-2xx so the typed callers below can degrade to `{ error }` honestly.
async function get(path: string, params: Record<string, string | undefined>): Promise<string> {
  const base = baseUrl();
  if (!base) throw new Error('unconfigured');
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, v);
  }
  const res = await fetch(`${base}${path}?${qs.toString()}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`VictoriaLogs ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  return res.text();
}

export interface SearchResult {
  configured: boolean;
  rows: LogRow[];
  query: string;
  error?: string;
}
export interface HitsResult {
  configured: boolean;
  series: HistogramSeries;
  query: string;
  error?: string;
}
export interface FieldValuesResult {
  configured: boolean;
  field: string;
  values: FieldValue[];
  error?: string;
}
export interface RetentionResult {
  configured: boolean;
  retention?: RetentionInfo;
  error?: string;
}

export interface VictoriaLogsPort {
  meta: AdapterMeta;
  configured(): boolean;
  health(): Promise<boolean>;
  // The `query` passed here is the ALREADY-COMPOSED LogsQL string (built by the pure buildLogsQuery).
  search(query: string, opts?: Options): Promise<SearchResult>;
  hits(query: string, opts?: Options): Promise<HitsResult>;
  fieldValues(field: string, query: string, opts?: Options): Promise<FieldValuesResult>;
  retention(): Promise<RetentionResult>;
}

const meta: AdapterMeta = {
  id: 'victorialogs',
  capability: 'observability',
  vendor: 'VictoriaLogs',
  license: 'Apache-2.0',
  render: 'native',
  embedUrl: env.OFFGRID_VICTORIALOGS_URL,
  description: 'Centralized fleet log search over LogsQL — query, histogram, field filters, retention.',
};

export const victoriaLogs: VictoriaLogsPort = {
  meta,

  configured() {
    return victoriaLogsConfigured();
  },

  async health() {
    const base = baseUrl();
    if (!base) return false;
    try {
      // VL answers /health with "OK" when live.
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) });
      return res.ok;
    } catch {
      return false;
    }
  },

  async search(query, opts = {}) {
    if (!baseUrl()) return { configured: false, rows: [], query };
    try {
      const body = await get('/select/logsql/query', {
        query,
        start: opts.start,
        end: opts.end,
        limit: String(clampLimit(opts.limit)),
      });
      return { configured: true, rows: parseLogsResponse(body), query };
    } catch (err) {
      return { configured: true, rows: [], query, error: describeError(err) };
    }
  },

  async hits(query, opts = {}) {
    const empty: HistogramSeries = { buckets: [], total: 0, max: 0 };
    if (!baseUrl()) return { configured: false, series: empty, query };
    try {
      const body = await get('/select/logsql/hits', {
        query,
        start: opts.start,
        end: opts.end,
        step: opts.step,
      });
      return { configured: true, series: shapeHits(JSON.parse(body)), query };
    } catch (err) {
      return { configured: true, series: empty, query, error: describeError(err) };
    }
  },

  async fieldValues(field, query, opts = {}) {
    if (!baseUrl()) return { configured: false, field, values: [] };
    try {
      const body = await get('/select/logsql/field_values', {
        field,
        query,
        start: opts.start,
        end: opts.end,
      });
      return { configured: true, field, values: normalizeFieldValues(JSON.parse(body)) };
    } catch (err) {
      return { configured: true, field, values: [], error: describeError(err) };
    }
  },

  async retention() {
    if (!baseUrl()) return { configured: false };
    try {
      // VL surfaces non-default command-line flags at /flags as plain text; parse -retentionPeriod
      // out of it. When absent, the pure parser reports the deploy-managed default honestly.
      const body = await get('/flags', {});
      return { configured: true, retention: parseRetentionFlags(body) };
    } catch (err) {
      return { configured: true, error: describeError(err) };
    }
  },
};
