// Thin I/O adapter for the audit-log surface. Bridges the audit search backend (searchAudit, owned
// by the foundation agent in src/lib/siem.ts) to the pure view-model (audit-log-view.ts). This file
// is the ONLY place the surface touches I/O — the page and export route call this, then everything
// else is pure + unit-tested.
//
// GRACEFUL DEGRADATION: searchAudit today pushes `q` + `outcome` + offset paging into OpenSearch.
// The richer filters (actor / action / project / time-range) are being wired server-side. Until
// they land, we over-fetch a window with the server-supported filters and apply the rest in the
// pure `filterAuditRows`, then paginate in-memory. When searchAudit gains native support the pure
// post-filter is an idempotent no-op — no double-filtering, no code change here required.
import { searchAudit } from '@/lib/siem';
import {
  auditFacets,
  DEFAULT_PAGE_SIZE,
  filterAuditRows,
  MAX_PAGE_SIZE,
  normalizeAudit,
  type AuditFilters,
  type AuditRow,
  type AuditView,
} from '@/lib/audit-log-view';

export interface AuditPage {
  rows: AuditRow[]; // this page, post-filtered
  total: number; // total rows after post-filter (drives pagination)
  page: number;
  size: number;
  configured: boolean;
  error?: string;
  facets: ReturnType<typeof auditFacets>;
}

// The over-fetch window. When the pure post-filter is doing the narrowing we must pull enough rows
// for filtering + pagination to be correct. Capped so a huge index never blows the request.
const FETCH_WINDOW = 2000;

// Read one page of audit rows for the given filters. Never throws — a search outage surfaces as
// { configured, error } and an empty page.
export async function readAuditPage(f: AuditFilters): Promise<AuditPage> {
  const page = f.page && f.page >= 1 ? f.page : 1;
  const size = Math.min(f.size ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  // Only pass filters searchAudit is known to support today; the rest are applied by filterAuditRows.
  const result = await searchAudit({
    q: f.q,
    outcome: f.outcome,
    size: FETCH_WINDOW,
    from: 0,
  });
  const view: AuditView = normalizeAudit(result);
  const filtered = filterAuditRows(view.rows, f);
  const start = (page - 1) * size;
  const rows = filtered.slice(start, start + size);
  return {
    rows,
    total: filtered.length,
    page,
    size,
    configured: view.configured,
    error: view.error,
    facets: auditFacets(view.rows),
  };
}

// Read the WHOLE filtered set (up to the fetch window) for export — no pagination slice.
export async function readAuditForExport(f: AuditFilters): Promise<{
  rows: AuditRow[];
  configured: boolean;
  error?: string;
}> {
  const result = await searchAudit({ q: f.q, outcome: f.outcome, size: FETCH_WINDOW, from: 0 });
  const view = normalizeAudit(result);
  return { rows: filterAuditRows(view.rows, f), configured: view.configured, error: view.error };
}
