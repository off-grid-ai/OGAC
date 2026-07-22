// ─── Connector-query adapter — run a governed READ against a domain's bound connector (1B) ──
//
// The I/O seam between the pure rule engine (data-domains.ts resolves a phrase → DataDomain) and
// the ONE live query path (connector-exec.ts). Given a resolved domain + the connector it binds to,
// this reads the declared resource. READ-only, never fabricates: any failure ⇒ null (a wrong bind
// surfaces as a miss, never a made-up row — Builder Epic risk #2).
//
// SOLID / no-collision: the connector row is passed IN as a `ConnectorTarget` (type+endpoint), so
// this file never imports store.ts (owned by another agent this phase). The caller fetches the
// connector (via listConnectors/getConnector) and hands us the target.
//
// AUDIT: this adapter is pure-ish I/O against the connector; it does NOT write the audit log itself
// (recordAudit lives in store.ts, off-limits this phase). Instead every call returns a
// `ResolutionDecision` describing the bind + outcome, and the caller (route / executor) is expected
// to persist it via the existing audit helper. See `describeDecision` for a ready log line.
import { execConnectorQuery } from '@/lib/connector-exec';
import type {
  ConnectorQueryResult,
  ConnectorQueryRuntimeDependencies,
  ConnectorTarget,
} from '@/lib/connector-exec';
import type { DataDomain } from '@/lib/data-domains';

export interface QueryDomainOpts {
  op?: 'read' | 'count';
  limit?: number;
  params?: Record<string, unknown>;
  /** Trusted runtime actor. Never sourced from connector-query step params. */
  actorId?: string;
}

// The auditable record of ONE resolution: what phrase/domain bound to what connector+resource, and
// whether the live read succeeded. `ok:false` with rowsReturned:null = a miss (unreachable / bad
// binding), never a fabricated result. The caller feeds this to the audit log.
export interface ResolutionDecision {
  domainId: string;
  domainLabel: string;
  connectorId: string;
  resource: string;
  op: 'read' | 'count';
  ok: boolean;
  rowsReturned: number | null;
  dialect: string | null;
}

export interface QueryDomainResult {
  result: ConnectorQueryResult | null;
  decision: ResolutionDecision;
}

// Run the domain's declared READ against the connector target. Returns both the raw result (or null
// on any failure) and the audit-ready decision. The `resource` and any op-hint limit come from the
// DECLARATION (the rule), not from the caller's guess.
export async function queryDomain(
  domain: DataDomain,
  connector: ConnectorTarget,
  opts: QueryDomainOpts = {},
  dependencies: ConnectorQueryRuntimeDependencies = {},
): Promise<QueryDomainResult> {
  const op = opts.op ?? 'read';
  // opHints may declare a default limit for this domain; caller override wins, then hint, then default.
  const hintLimit =
    typeof domain.opHints?.limit === 'number' ? (domain.opHints.limit as number) : undefined;
  const limit = opts.limit ?? hintLimit;

  const decision: ResolutionDecision = {
    domainId: domain.id,
    domainLabel: domain.label,
    connectorId: domain.connectorId,
    resource: domain.resource,
    op,
    ok: false,
    rowsReturned: null,
    dialect: null,
  };

  const result = await execConnectorQuery(
    connector,
    {
      resource: domain.resource,
      op,
      limit,
      params: opts.params,
      binding: { orgId: domain.orgId, domainId: domain.id, actorId: opts.actorId },
    },
    dependencies,
  );

  if (result) {
    decision.ok = true;
    decision.rowsReturned = result.count;
    decision.dialect = result.dialect;
  }

  return { result, decision };
}

// A stable, human/audit-friendly one-line description of a resolution decision — hand to the audit
// helper as the event detail so the bind is attributable and reviewable.
export function describeDecision(d: ResolutionDecision): string {
  const outcome = d.ok ? `ok(${d.rowsReturned} rows via ${d.dialect})` : 'miss(no rows / unreachable)';
  return `data-domain "${d.domainLabel}" [${d.domainId}] → connector ${d.connectorId} :: ${d.resource} (${d.op}) → ${outcome}`;
}
