import { evaluateAbac } from '@/lib/store';
import { recordDecision } from '@/lib/policy-decision-log';
import { POLICY } from './services';
import type { PolicyDecision, PolicyInput, PolicyPort } from './types';

// Mirror every enforcement decision into the read-back log so the Policy/Control surface shows a
// real decision history (see policy-decision-log.ts). Best-effort; never affects the decision.
function record(input: PolicyInput, decision: PolicyDecision): PolicyDecision {
  recordDecision({
    allow: decision.allow,
    engine: decision.engine,
    reason: decision.reason,
    role: input.role,
    resource: input.resource,
    attributes: input.attributes,
  });
  return decision;
}

// Access decisions behind one port. The first-party adapter evaluates the in-console ABAC rules
// (deny-overrides); the OPA adapter delegates to a Rego decision API. Selected via
// OFFGRID_ADAPTER_POLICY. OPA falls back to the first-party engine if unreachable, so the swap is
// reversible and never a hard dependency.
const env = process.env;

function metaOf(id: string) {
  const entry = POLICY.find((e) => e.meta.id === id);
  if (!entry) throw new Error(`policy adapter meta '${id}' missing`);
  return entry.meta;
}

async function firstPartyDecision(input: PolicyInput) {
  const { allow, matched } = await evaluateAbac(input);
  const reason = matched.length
    ? `${matched.length} rule(s) matched; ${allow ? 'allowed' : 'denied'} (deny-overrides)`
    : 'no rule matched; default deny';
  return { allow, reason, engine: 'abac' };
}

export const firstPartyPolicy: PolicyPort = {
  meta: metaOf('abac'),
  async evaluate(input) {
    return record(input, await firstPartyDecision(input));
  },
};

interface OpaResponse {
  result?: { allow?: boolean };
}

export const opaPolicy: PolicyPort = {
  meta: metaOf('opa'),
  async evaluate(input) {
    const url = env.OFFGRID_OPA_URL;
    if (!url) return record(input, await firstPartyDecision(input));
    try {
      const res = await fetch(`${url}/v1/data/offgrid/authz`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input }),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`opa ${res.status}`);
      const body = (await res.json()) as OpaResponse;
      const allow = Boolean(body.result?.allow);
      return record(input, {
        allow,
        reason: `OPA decision (offgrid/authz): ${allow}`,
        engine: 'opa',
      });
    } catch {
      // OPA down → fall back to the in-console engine rather than fail closed unexpectedly.
      return record(input, await firstPartyDecision(input));
    }
  },
};

export const POLICY_PORTS: PolicyPort[] = [firstPartyPolicy, opaPolicy];
