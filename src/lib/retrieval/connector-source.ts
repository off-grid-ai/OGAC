// ─── connectorSource — the 4th retrieval source: declared data-domains → live connector (1B) ──
//
// The rule engine as a router source. When a query NAMES or IMPLIES a declared data-domain
// ("employee quota", "invoices"), this routes DETERMINISTICALLY to that domain's bound connector
// (data-domains.ts → resolveDomain, never a guess) and reads it live (connector-query adapter →
// connector-exec). If nothing binds confidently, it contributes NOTHING (empty hits) — a query
// that doesn't name a declared domain must not pull from a connector by accident (risk #2).
//
// Implements the same `RetrievalSource` shape as kb/database/tool in sources.ts. Its `kind` is
// 'database' (a connector read is a structured-data read; SourceKind has no 'connector' member and
// types.ts is owned by another agent), but its `id` is 'connector' so it's distinct in routing.
import { queryDomain } from '@/lib/adapters/connector-query';
import { resolveDomain } from '@/lib/data-domains';
import { listDomains } from '@/lib/data-domains-store';
import { listConnectors } from '@/lib/store';
import type { RetrievalSource } from './types';

// Injectable I/O boundary so the source can be unit-tested without a live DB/connector. Production
// wiring uses the real store/domain-store; tests pass fakes.
export interface ConnectorSourceDeps {
  listDomains: typeof listDomains;
  listConnectors: typeof listConnectors;
  queryDomain: typeof queryDomain;
}

const defaultDeps: ConnectorSourceDeps = { listDomains, listConnectors, queryDomain };

// Build the source with explicit deps (test seam). `makeConnectorSource()` with no args = prod.
export function makeConnectorSource(deps: ConnectorSourceDeps = defaultDeps): RetrievalSource {
  return {
    id: 'connector',
    kind: 'database',
    label: 'Connectors (declared data-domains)',
    describe:
      'Routes a query to a declared data-domain’s bound connector by rule (deterministic), then reads it live.',
    async search(query, k, _opts, context) {
      // 1. Resolve the query to a declared domain — BY RULE. No match ⇒ contribute nothing.
      const domains = context?.dataDomains ?? (await deps.listDomains(context?.orgId));
      const domain = resolveDomain(query, domains);
      if (!domain) return [];

      // 2. Find the connector the domain binds to. Missing connector ⇒ nothing (never fabricate).
      const connectors = await deps.listConnectors();
      const connector = connectors.find((c) => c.id === domain.connectorId);
      if (!connector) return [];

      // 3. Read live through the shared query path. Failure ⇒ null ⇒ nothing.
      const { result, decision } = await deps.queryDomain(
        domain,
        // Pass `id` so connector-exec resolves the vaulted credential at query time — a vaulted
        // connector stores a credential-free endpoint and the secret comes from OpenBao by id.
        { type: connector.type, endpoint: connector.endpoint, id: connector.id },
        { op: 'read', limit: Math.max(1, Math.min(k, 50)) },
      );
      if (!result || result.rows.length === 0) return [];

      // 4. One hit per returned row (capped at k), each carrying provenance back to the domain +
      //    connector + resource. Deterministic order (as returned by the connector). Score is a
      //    fixed high confidence — this is a rule match, not a fuzzy retrieval.
      const rows = result.rows.slice(0, k);
      return rows.map((row, i) => ({
        sourceId: 'connector',
        sourceKind: 'database' as const,
        title: `${domain.label} · ${decision.resource}`,
        snippet: summarizeRow(row),
        ref: `connector:${domain.connectorId}/${decision.resource}#${i}`,
        // Rule-based bind: full confidence for the first row, gently decaying so order is stable.
        score: Number((1 - i * 0.001).toFixed(3)),
      }));
    },
  };
}

// Compact, deterministic one-line rendering of a row for the retrieval snippet. Stable key order,
// truncated. Never throws on odd values.
function summarizeRow(row: Record<string, unknown>): string {
  try {
    const parts = Object.keys(row)
      .sort()
      .slice(0, 6)
      .map((key) => `${key}=${stringifyValue(row[key])}`);
    return parts.join(' · ').slice(0, 200);
  } catch {
    return '';
  }
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 40);
  return String(v).slice(0, 40);
}

// The production source, wired to the real store + domain-store.
export const connectorSource: RetrievalSource = makeConnectorSource();
