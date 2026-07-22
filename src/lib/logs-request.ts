// Pure request-shaping shared by the log-search routes (DRY: one place turns URL searchParams into
// a composed LogsQL query + range). ZERO-IO — unit-tested in test/victorialogs-query.test.ts's
// sibling (logs-request.test.ts). The routes stay thin: parse → this → adapter.
import {
  type LogFilter,
  type TimeRange,
  buildLogsQuery,
  parseRange,
} from './victorialogs-query';

// The field filters the search UI exposes as dropdowns. Kept here so the route + the client build
// the SAME LogsQL (no drift between what the operator sees and what runs).
export const FILTER_FIELDS = ['service', 'level'] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

// The logical UI filter name → the physical VictoriaLogs field it maps to on this deployment (OTel
// audit schema: service.name / severity). Kept in ONE place so the query builder AND the
// field-values lookup resolve to the SAME real field (no drift, no empty dropdowns).
export const PHYSICAL_FIELD: Record<FilterField, string> = {
  service: 'service.name',
  level: 'severity',
};

export interface LogsRequest {
  query: string; // composed LogsQL
  range: TimeRange;
  text: string; // the raw free-text portion (echoed back to the UI)
  filters: LogFilter[]; // the active field filters (echoed back to the UI)
}

// Turn URLSearchParams into a composed LogsQL request. Reads `q` (free text), `range`, and each
// known filter field (`service`, `level`). Pure; never throws.
export function parseLogsRequest(params: URLSearchParams): LogsRequest {
  const text = (params.get('q') ?? '').trim();
  const filters: LogFilter[] = []; // logical, echoed back to the UI (shows `service` / `level`)
  const queryFilters: LogFilter[] = []; // physical, used to compose the real LogsQL
  for (const field of FILTER_FIELDS) {
    const value = (params.get(field) ?? '').trim();
    if (value) {
      filters.push({ field, value });
      queryFilters.push({ field: PHYSICAL_FIELD[field], value });
    }
  }
  return {
    query: buildLogsQuery({ text, filters: queryFilters }),
    range: parseRange(params.get('range')),
    text,
    filters,
  };
}
