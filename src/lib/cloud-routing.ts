// PURE cloud-egress GOVERNANCE chokepoint — ZERO I/O. This is the single place that decides, given a
// routing DECISION (from routing-policy.ts) and the set of configured providers, whether a request
// may ACTUALLY be forwarded to a cloud provider — and if not, exactly why and what to do instead.
//
// It exists so the governance invariants are enforced in ONE tested rule, not scattered across the
// request path:
//
//   INVARIANT 1 (block never leaves)     — an `effective:'block'` decision NEVER forwards to cloud.
//   INVARIANT 2 (local stays local)      — a `local` decision NEVER forwards to cloud.
//   INVARIANT 3 (egress leash)           — decideRouting() already demotes cloud→block when egress is
//                                          OFF; we re-assert it here so egress-off can NEVER reach a
//                                          provider even if a decision is constructed by hand.
//   INVARIANT 4 (honest degradation)     — a `cloud` decision with NO configured/selectable provider
//                                          does NOT fabricate a cloud call: it FALLS BACK per the
//                                          rule's `fallback` (default local) and is marked
//                                          cloudUnavailable, so the truth is recorded.
//
// PII/data-class gating is upstream: routing-policy rules map `data_class=pii → local` (or block), so
// a PII request never even produces a `cloud` decision. Egress being a governed switch is likewise
// enforced in decideRouting. This module is the last, independent gate before the network.

import type { RoutingDecision } from './routing-policy';
import type { CloudProviderConfig, CloudSelection } from './cloud-providers';
import { selectCloudProvider } from './cloud-providers';

/** What the request path should do after the governance gate. */
export type CloudPlanKind =
  | 'cloud' //  forward to a cloud provider (selection is present)
  | 'local' //  serve locally (either the decision was local, or cloud fell back to local)
  | 'block'; // hard stop — nothing runs (blocked decision / egress off)

export interface CloudPlan {
  kind: CloudPlanKind;
  /** Present iff kind === 'cloud'. The provider + upstream model to call. */
  selection: CloudSelection | null;
  /** True when a `cloud` decision could not be served by cloud and fell back (honest degradation). */
  cloudUnavailable: boolean;
  /**
   * The model the request should run as. For a cloud plan this is the provider's upstream model; for a
   * local fallback it is the decision's `fallback` model (or null → the pool default). Drives the
   * model tag used for cost attribution + the local proxy.
   */
  model: string | null;
  /** Human-readable reason, carried into audit. */
  reason: string;
}

/**
 * Decide what actually happens for a routing decision, given the configured cloud providers. PURE.
 *
 * `egressAllowed` is passed redundantly (decideRouting already leashed cloud→block when it's off) as
 * a defence-in-depth assertion: even a hand-built `effective:'cloud'` decision is forced to block
 * when egress is off. This makes "egress-off hard-stops cloud" true by construction here, not only
 * upstream.
 */
export function planCloudRoute(
  decision: RoutingDecision,
  providers: CloudProviderConfig[],
  egressAllowed: boolean,
): CloudPlan {
  // INVARIANT 3 — egress-off is an absolute hard-stop for cloud, re-asserted independently.
  if (decision.effective === 'cloud' && !egressAllowed) {
    return {
      kind: 'block',
      selection: null,
      cloudUnavailable: false,
      model: null,
      reason: 'cloud route blocked: org egress is OFF (leash)',
    };
  }

  // INVARIANT 1 — a blocked decision never runs anywhere.
  if (decision.effective === 'block') {
    return {
      kind: 'block',
      selection: null,
      cloudUnavailable: false,
      model: null,
      reason: decision.reason || 'blocked by routing policy',
    };
  }

  // INVARIANT 2 — a local decision stays local, full stop. It never consults cloud providers.
  if (decision.effective === 'local') {
    return {
      kind: 'local',
      selection: null,
      cloudUnavailable: false,
      model: decision.model ?? null,
      reason: decision.reason || 'routed local',
    };
  }

  // effective === 'cloud' AND egress is on: try to select a real, configured provider.
  const selection = selectCloudProvider(providers, decision.model);
  if (selection) {
    return {
      kind: 'cloud',
      selection,
      cloudUnavailable: false,
      model: selection.model,
      reason: `${decision.reason || 'routed cloud'} → ${selection.provider.id}:${selection.model}`,
    };
  }

  // INVARIANT 4 — cloud was permitted but NO provider is wired/selectable. Degrade honestly per the
  // rule's fallback (default local). NEVER pretend a cloud response happened.
  const fallback = (decision.fallback ?? 'local').toLowerCase();
  if (fallback === 'block') {
    return {
      kind: 'block',
      selection: null,
      cloudUnavailable: true,
      model: null,
      reason: `cloud routed but no provider configured; fallback=block → blocked`,
    };
  }
  return {
    kind: 'local',
    selection: null,
    cloudUnavailable: true,
    model: null, // fall back to the local pool's default model
    reason: `cloud routed but no provider configured; fell back to local`,
  };
}
