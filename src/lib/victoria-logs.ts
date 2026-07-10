// VictoriaLogs read adapter. Logs are shipped to VictoriaLogs (via the OTel collector / a log
// shipper); this reads them back through VL's LogsQL HTTP API so the Platform-health Logs tab has a
// real search box + results table. Identical contract to the Langfuse/Marquez read adapters: env
// base URL, a `safe*` reader returning a typed empty view + `configured:false` when unset/unreachable
// (never throws into the page), and all response SHAPING split into `victoria-logs-shape.ts`.
//
//   OFFGRID_VICTORIALOGS_URL — e.g. http://127.0.0.1:9428
import {
  type LogsResult,
  emptyLogsResult,
  normalizeLogsQuery,
  parseLogsResponse,
} from './victoria-logs-shape';

const BASE = process.env.OFFGRID_VICTORIALOGS_URL;

type Fetcher = typeof fetch;

export function victoriaLogsConfigured(): boolean {
  return Boolean(BASE);
}

// Best-effort LogsQL search — never throws. Runs GET /select/logsql/query with the (normalized)
// query + a result cap, parses the JSONL body via the pure shaper. Unconfigured → typed empty +
// configured:false. Unreachable / non-2xx → configured:true + error, empty rows.
export async function safeSearchLogs(
  rawQuery: string,
  limit = 200,
  fetcher: Fetcher = fetch,
): Promise<LogsResult> {
  const query = normalizeLogsQuery(rawQuery);
  if (!BASE) return emptyLogsResult(query, false);
  try {
    const qs = new URLSearchParams({ query, limit: String(Math.min(Math.max(limit, 1), 1000)) });
    const res = await fetcher(`${BASE}/select/logsql/query?${qs.toString()}`, {
      headers: { accept: 'application/stream+json' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        configured: true,
        rows: [],
        query,
        error: `VictoriaLogs ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const body = await res.text();
    return { configured: true, rows: parseLogsResponse(body), query };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    return {
      configured: true,
      rows: [],
      query,
      error: `${err.message}${err.cause?.code ? ` [${err.cause.code}]` : ''}`,
    };
  }
}
