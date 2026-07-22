// Thin network shell for the OpenSearch INDEX-ADMIN + SECURITY-ANALYTICS read surfaces. All
// request/response SHAPING is pure and lives in `src/lib/opensearch-admin.ts` (unit-tested, no
// network); this file only does I/O — it GETs the raw bodies against OpenSearch's `_index_template`,
// `_alias`, and `_plugins/_security_analytics/*` APIs and hands them to the pure parsers.
//
// READ-ONLY: index templates + aliases are deploy-owned (bootstrapped with the cluster); the writable
// lifecycle knob is the ISM policy, which `opensearch-alerting.ts` already owns. Security-analytics
// detectors are surfaced read-only with their firing state.
//
// GRACEFUL WHEN UNSUPPORTED: builds without the security-analytics plugin answer these paths with
// 404 / "no handler found". We read the REAL response and return `{ supported:false, …, note }` —
// never faking success — matching the alerting/ISM pattern (isPluginUnsupported is the shared probe).
//
//   OFFGRID_OPENSEARCH_URL — e.g. http://127.0.0.1:9200 (defaults to localhost, same as the SIEM adapter)
import {
  type AliasSummary,
  type DetectorSummary,
  type IndexTemplateSummary,
  isPluginUnsupported,
  mergeDetectorAlerts,
  parseAliases,
  parseDetectorAlerts,
  parseDetectors,
  parseIndexTemplates,
} from '@/lib/opensearch-admin';

const DEFAULT_URL = 'http://127.0.0.1:9200';

function osUrl(): string {
  return process.env.OFFGRID_OPENSEARCH_URL ?? DEFAULT_URL;
}

export function adminConfigured(): boolean {
  return Boolean(process.env.OFFGRID_OPENSEARCH_URL);
}

async function osFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${osUrl()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  });
}

// ── index templates ──────────────────────────────────────────────────────────────────────────────

export interface TemplatesResult {
  configured: boolean;
  templates: IndexTemplateSummary[];
  error?: string;
}

/** List index templates via `GET _index_template`. Core API — always present when OpenSearch is up. */
export async function listIndexTemplates(): Promise<TemplatesResult> {
  const configured = adminConfigured();
  try {
    const res = await osFetch('/_index_template');
    if (!res.ok) {
      return { configured, templates: [], error: `OpenSearch ${res.status}` };
    }
    const json = (await res.json()) as Parameters<typeof parseIndexTemplates>[0];
    return { configured, templates: parseIndexTemplates(json) };
  } catch (e) {
    return { configured, templates: [], error: (e as Error).message };
  }
}

// ── aliases ────────────────────────────────────────────────────────────────────────────────────

export interface AliasesResult {
  configured: boolean;
  aliases: AliasSummary[];
  error?: string;
}

/** List aliases via `GET _alias`. Core API — always present when OpenSearch is up. */
export async function listAliases(): Promise<AliasesResult> {
  const configured = adminConfigured();
  try {
    const res = await osFetch('/_alias');
    if (!res.ok) {
      return { configured, aliases: [], error: `OpenSearch ${res.status}` };
    }
    const json = (await res.json()) as Parameters<typeof parseAliases>[0];
    return { configured, aliases: parseAliases(json) };
  } catch (e) {
    return { configured, aliases: [], error: (e as Error).message };
  }
}

// ── security-analytics detectors ─────────────────────────────────────────────────────────────────

export interface DetectorsResult {
  configured: boolean;
  supported: boolean;
  detectors: DetectorSummary[];
  note?: string;
  error?: string;
}

/**
 * List security-analytics detectors + merge each one's firing state (active/acknowledged alert
 * counts). Two calls: `detectors/_search` for the definitions, then the alerts API for firing state —
 * a failed/absent alerts call degrades to zero counts (the detectors still list). Reports
 * `supported:false` (never faking) when the security-analytics plugin isn't installed.
 */
export async function listDetectors(): Promise<DetectorsResult> {
  const configured = adminConfigured();
  try {
    const res = await osFetch('/_plugins/_security_analytics/detectors/_search', {
      method: 'POST',
      body: JSON.stringify({ size: 200, query: { match_all: {} } }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (isPluginUnsupported(res.status, body)) {
        return {
          configured,
          supported: false,
          detectors: [],
          note: `Security-analytics plugin not available (OpenSearch ${res.status} for _plugins/_security_analytics/detectors)`,
        };
      }
      return { configured, supported: true, detectors: [], error: `OpenSearch ${res.status}` };
    }
    const json = (await res.json()) as Parameters<typeof parseDetectors>[0];
    const detectors = parseDetectors(json);
    const counts = await fetchDetectorAlertCounts();
    return { configured, supported: true, detectors: mergeDetectorAlerts(detectors, counts) };
  } catch (e) {
    return { configured, supported: true, detectors: [], error: (e as Error).message };
  }
}

/** Best-effort read of the alerts API for firing state. Any failure → empty tally (never throws). */
async function fetchDetectorAlertCounts(): Promise<
  ReturnType<typeof parseDetectorAlerts>
> {
  try {
    const res = await osFetch('/_plugins/_security_analytics/alerts?size=1000');
    if (!res.ok) return new Map();
    const json = (await res.json()) as Parameters<typeof parseDetectorAlerts>[0];
    return parseDetectorAlerts(json);
  } catch {
    return new Map();
  }
}
