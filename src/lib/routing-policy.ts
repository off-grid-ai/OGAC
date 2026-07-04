// PURE model-routing decision — ZERO imports, ZERO I/O, so it is exhaustively unit-testable
// (mirrors tenancy-policy.ts). This is the heart of the "external intelligence, leashed" promise:
// given the routing rules, a request's attributes, and the org egress switch, decide whether the
// request runs on a LOCAL model, is allowed out to a CLOUD model, or is BLOCKED. The I/O adapter
// (store.ts evaluateRouting) fetches rules + policy and delegates here.
//
// The master leash: a `cloud` action while org egress is OFF is demoted to `block`. That is how
// "data_class = PII → never leaves the box" holds regardless of who asks — it is enforced here, in
// pure logic, not left to a caller to remember.

export interface RoutingRuleLite {
  name: string;
  priority: number;
  attribute: string;
  operator: string; // 'eq' (default) | 'neq' | 'in'
  value: string;
  action: string; // 'local' | 'cloud' | 'block'
  model: string;
  fallback: string;
  enabled: boolean;
}

export interface RoutingDecision {
  action: 'local' | 'cloud' | 'block';
  effective: 'local' | 'cloud' | 'block';
  model: string | null;
  fallback: string | null;
  matched: string | null;
  reason: string;
}

/** Does a rule's condition match the request attributes? Mirrors the ABAC matcher semantics. */
export function ruleMatchesAttributes(
  rule: Pick<RoutingRuleLite, 'attribute' | 'operator' | 'value'>,
  attributes: Record<string, string>,
): boolean {
  const attr = attributes[rule.attribute];
  if (rule.operator === 'in') return rule.value.split(',').includes(attr);
  if (rule.operator === 'neq') return attr !== rule.value;
  return attr === rule.value;
}

/**
 * Decide routing. First ENABLED rule (by ascending priority) whose condition matches wins; no
 * match defaults to local. A `cloud` action is leashed to `block` when egress is off.
 *
 * `rules` need not be pre-sorted — this sorts by priority so the decision is order-independent.
 */
export function decideRouting(
  rules: RoutingRuleLite[],
  attributes: Record<string, string>,
  egressAllowed: boolean,
): RoutingDecision {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  const hit = ordered.find((r) => r.enabled && ruleMatchesAttributes(r, attributes));

  if (!hit) {
    return {
      action: 'local',
      effective: 'local',
      model: null,
      fallback: null,
      matched: null,
      reason: 'no rule matched; defaulted to local',
    };
  }

  const action = (['local', 'cloud', 'block'].includes(hit.action) ? hit.action : 'block') as
    RoutingDecision['action'];
  const leashed = action === 'cloud' && !egressAllowed;
  return {
    action,
    effective: leashed ? 'block' : action,
    model: hit.model || null,
    fallback: hit.fallback || null,
    matched: hit.name,
    reason: leashed ? `${hit.name} → cloud, but org egress is OFF (leashed to block)` : hit.name,
  };
}
