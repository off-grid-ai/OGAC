// FleetDM API — pure request/response shaping (ZERO-import, unit-testable). No fetch, no I/O.
//
// This is the SOLID split the console mandates: everything here decides *what* to send to the
// FleetDM REST API and *how* to normalise what comes back, with no side effects. The network calls
// live in the adapter (`src/lib/adapters/mdm.ts`) and the routes; those are thin and delegate the
// mapping here so it can be tested in isolation without a reachable FleetDM.
//
// FleetDM (Fleet Free / MIT core) is an osquery-based cross-platform MDM. We use:
//   - live osquery: POST /api/latest/fleet/queries (save) → POST .../queries/{id}/run (campaign) →
//     GET .../queries/{id}/report (poll for aggregated results)
//   - software inventory + CVEs: GET /api/latest/fleet/hosts/{id}/software
//   - policies CRUD: /api/latest/fleet/{global/}policies
//
// Endpoints are versioned `/api/latest/…`; FleetDM aliases `latest` to the running major, so we
// don't pin a version the server may not have.

export const FLEET_API = '/api/latest/fleet';

// ── Auth headers ──────────────────────────────────────────────────────────────
export function fleetHeaders(token: string | undefined, extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

// ── Live osquery query ──────────────────────────────────────────────────────────
export interface LiveQueryRow {
  hostId: number;
  hostName?: string;
  columns: Record<string, string>;
}

export interface LiveQueryResult {
  queryId: number;
  query: string;
  status: 'complete' | 'pending';
  respondedHosts: number;
  targetedHosts: number;
  rows: LiveQueryRow[];
  error?: string;
}

// osquery SQL must be a non-empty SELECT and must not attempt to mutate. FleetDM will also reject
// bad SQL, but validating here gives the UI an immediate, offline error and keeps the route thin.
export function validateOsquery(sql: string): { ok: true } | { ok: false; error: string } {
  const q = sql.trim();
  if (!q) return { ok: false, error: 'query is empty' };
  if (!/^select\b/i.test(q)) return { ok: false, error: 'query must be a SELECT statement' };
  if (/;\s*\S/.test(q)) return { ok: false, error: 'only a single statement is allowed' };
  if (/\b(attach|pragma|insert|update|delete|drop|alter|create)\b/i.test(q)) {
    return { ok: false, error: 'only read-only SELECT queries are permitted' };
  }
  return { ok: true };
}

// Body for saving a one-off live query as a named query object (FleetDM has no anonymous live-run;
// you create/reuse a query, then run a campaign against it).
export function saveQueryBody(name: string, sql: string): { name: string; query: string; observer_can_run: boolean } {
  return { name, query: sql, observer_can_run: true };
}

// Body to launch a live campaign against explicit host ids.
export function runCampaignBody(hostIds: number[]): { selected: { hosts: number[]; labels: number[] } } {
  return { selected: { hosts: hostIds, labels: [] } };
}

interface FleetQueryReportRow {
  host_id?: number;
  host_name?: string;
  columns?: Record<string, unknown>;
}

interface FleetQueryReport {
  query_id?: number;
  report_clipped?: boolean;
  results?: FleetQueryReportRow[];
}

// Map a FleetDM query report into our normalized rows. `targetedHosts` is how many hosts the
// campaign was aimed at, so the caller/UI can tell "still waiting" from "all in".
export function mapQueryReport(
  queryId: number,
  query: string,
  report: FleetQueryReport,
  targetedHosts: number,
): LiveQueryResult {
  const rows: LiveQueryRow[] = (report.results ?? []).map((r) => ({
    hostId: r.host_id ?? 0,
    hostName: r.host_name,
    columns: Object.fromEntries(
      Object.entries(r.columns ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)]),
    ),
  }));
  const responded = new Set(rows.map((r) => r.hostId)).size;
  return {
    queryId,
    query,
    status: responded >= targetedHosts && targetedHosts > 0 ? 'complete' : 'pending',
    respondedHosts: responded,
    targetedHosts,
    rows,
  };
}

// ── Software inventory + CVEs ─────────────────────────────────────────────────
export interface SoftwareCve {
  cve: string;
  cvssScore?: number;
  url?: string;
}

export interface SoftwareItem {
  id: number;
  name: string;
  version: string;
  source: string;
  vulnerabilities: SoftwareCve[];
}

export interface SoftwareInventory {
  hostId: number;
  count: number;
  vulnerableCount: number;
  software: SoftwareItem[];
}

interface FleetVuln {
  cve?: string;
  cvss_score?: number | null;
  details_link?: string;
}

interface FleetSoftware {
  id?: number;
  name?: string;
  version?: string;
  source?: string;
  vulnerabilities?: FleetVuln[] | null;
}

function topCvss(s: SoftwareItem): number {
  return s.vulnerabilities.reduce((max, v) => Math.max(max, v.cvssScore ?? 0), 0);
}

// FleetDM returns either { software: [...] } (host software endpoint) or { host: { software: [...] } }.
export function mapSoftware(hostId: number, payload: unknown): SoftwareInventory {
  const p = payload as { software?: FleetSoftware[]; host?: { software?: FleetSoftware[] } };
  const raw = p.software ?? p.host?.software ?? [];
  const software: SoftwareItem[] = raw.map((s) => ({
    id: s.id ?? 0,
    name: s.name ?? 'unknown',
    version: s.version ?? '',
    source: s.source ?? '',
    vulnerabilities: (s.vulnerabilities ?? [])
      .map((v) => ({ cve: v.cve ?? '', cvssScore: v.cvss_score ?? undefined, url: v.details_link }))
      .filter((v) => v.cve),
  }));
  // Highest-CVSS-first so the most exposed software surfaces at the top.
  software.sort((a, b) => topCvss(b) - topCvss(a) || a.name.localeCompare(b.name));
  return {
    hostId,
    count: software.length,
    vulnerableCount: software.filter((s) => s.vulnerabilities.length > 0).length,
    software,
  };
}

// ── Policies ──────────────────────────────────────────────────────────────────
export interface FleetPolicyInput {
  name: string;
  query: string;
  description?: string;
  resolution?: string;
  platform?: string;
  critical?: boolean;
}

export interface FleetPolicy {
  id: number;
  name: string;
  query: string;
  description: string;
  resolution: string;
  platform: string;
  critical: boolean;
  passingHostCount: number;
  failingHostCount: number;
}

interface FleetPolicyRaw {
  id?: number;
  name?: string;
  query?: string;
  description?: string;
  resolution?: string;
  platform?: string;
  critical?: boolean;
  passing_host_count?: number;
  failing_host_count?: number;
}

export function validatePolicyInput(
  input: Partial<FleetPolicyInput>,
): { ok: true } | { ok: false; error: string } {
  if (!input.name?.trim()) return { ok: false, error: 'name is required' };
  if (!input.query?.trim()) return { ok: false, error: 'query is required' };
  const q = validateOsquery(input.query);
  if (!q.ok) return q;
  return { ok: true };
}

// FleetDM's create/update policy body uses snake_case; only send fields that are set.
export function policyBody(input: Partial<FleetPolicyInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.query !== undefined) body.query = input.query;
  if (input.description !== undefined) body.description = input.description;
  if (input.resolution !== undefined) body.resolution = input.resolution;
  if (input.platform !== undefined) body.platform = input.platform;
  if (input.critical !== undefined) body.critical = input.critical;
  return body;
}

export function mapPolicy(raw: FleetPolicyRaw): FleetPolicy {
  return {
    id: raw.id ?? 0,
    name: raw.name ?? '',
    query: raw.query ?? '',
    description: raw.description ?? '',
    resolution: raw.resolution ?? '',
    platform: raw.platform ?? '',
    critical: Boolean(raw.critical),
    passingHostCount: raw.passing_host_count ?? 0,
    failingHostCount: raw.failing_host_count ?? 0,
  };
}

export function mapPolicies(payload: unknown): FleetPolicy[] {
  const p = payload as { policies?: FleetPolicyRaw[] };
  return (p.policies ?? []).map(mapPolicy);
}
