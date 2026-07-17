// PURE agent retrieval-scope rules. The run path supplies org-scoped declared domains plus the
// router's intent decision; this module decides which REAL data-domain ids would be touched and
// evaluates each against the bound pipeline contract. It owns no DB/network I/O.

import { resolveDomain, type DataDomain } from '@/lib/data-domains';
import {
  enforceDataAccess,
  type DataAccessVerdict,
  type PipelineContract,
} from '@/lib/pipeline-enforcement';

/** Resolve the declared domain a structured-data query would touch, confined to the run's org. */
export function requestedAgentDomainIds(
  query: string,
  runOrgId: string,
  declaredDomains: readonly DataDomain[],
  readsDeclaredDomains: boolean,
): string[] {
  if (!readsDeclaredDomains) return [];
  const inOrg = declaredDomains.filter((domain) => domain.orgId === runOrgId);
  const resolved = resolveDomain(query, inOrg);
  return resolved ? [resolved.id] : [];
}

export interface AgentDomainAccessDecision {
  allow: boolean;
  verdicts: DataAccessVerdict[];
  denied: DataAccessVerdict | null;
}

/** Evaluate every resolved real domain id. Empty means this retrieval reads no declared domain. */
export function authorizeAgentDomains(
  contract: PipelineContract | null,
  requestedDomainIds: readonly string[],
): AgentDomainAccessDecision {
  const ids = [...new Set(requestedDomainIds.map((id) => id.trim()).filter(Boolean))];
  const verdicts = ids.map((id) => enforceDataAccess(contract, id));
  const denied = verdicts.find((verdict) => !verdict.allow) ?? null;
  return { allow: denied === null, verdicts, denied };
}
