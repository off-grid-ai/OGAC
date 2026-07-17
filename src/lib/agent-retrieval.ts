// Agent retrieval orchestration: resolve metadata first, authorize the REAL declared domain ids,
// then (and only then) invoke retrieval I/O. Pure decisions live in agent-retrieval-policy.ts;
// listDomains + route are injected external boundaries for real integration tests.

import { requestedAgentDomainIds, authorizeAgentDomains } from '@/lib/agent-retrieval-policy';
import { listDomains } from '@/lib/data-domains-store';
import type { DataDomain } from '@/lib/data-domains';
import type { DataAccessVerdict, PipelineContract } from '@/lib/pipeline-enforcement';
import { classify, route } from '@/lib/retrieval/router';
import type { RouteResult } from '@/lib/retrieval/types';

export interface AgentRetrievalDeps {
  listDomains: (orgId: string) => Promise<DataDomain[]>;
  retrieve: typeof route;
}

const DEFAULT_DEPS: AgentRetrievalDeps = {
  listDomains,
  retrieve: route,
};

export type AgentRetrievalResult =
  | {
      allow: true;
      requestedDomainIds: string[];
      routed: RouteResult;
    }
  | {
      allow: false;
      requestedDomainIds: string[];
      denied: DataAccessVerdict;
    };

/** Resolve → authorize → retrieve. A denied result guarantees `deps.retrieve` was never called. */
export async function retrieveAgentSources(
  input: {
    query: string;
    k: number;
    orgId: string;
    contract: PipelineContract | null;
  },
  deps: AgentRetrievalDeps = DEFAULT_DEPS,
): Promise<AgentRetrievalResult> {
  const intent = classify(input.query);
  const readsDeclaredDomains = intent.intent.includes('database');

  // No declared-domain read means there is no domain id to authorize (KB/tool-only retrieval).
  // With no pipeline contract, the additive legacy path also avoids the metadata read entirely.
  let domains: DataDomain[] | undefined;
  let requestedDomainIds: string[] = [];
  if (input.contract && readsDeclaredDomains) {
    domains = (await deps.listDomains(input.orgId)).filter(
      (domain) => domain.orgId === input.orgId,
    );
    requestedDomainIds = requestedAgentDomainIds(
      input.query,
      input.orgId,
      domains,
      readsDeclaredDomains,
    );
    const access = authorizeAgentDomains(input.contract, requestedDomainIds);
    if (!access.allow && access.denied) {
      return { allow: false, requestedDomainIds, denied: access.denied };
    }
  }

  const routed = await deps.retrieve(input.query, input.k, undefined, {
    orgId: input.orgId,
    dataDomains: domains,
  });
  return { allow: true, requestedDomainIds, routed };
}
