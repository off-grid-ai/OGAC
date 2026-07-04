// PURE Provit access policy — ZERO imports, ZERO I/O, fully unit-testable. Mirrors the
// tenancy-policy.ts / analytics-rules-policy.ts split: this file holds the load-bearing access
// DECISIONS (push visibility, ABAC evaluation, row visibility), while provit-access.ts is the
// impure adapter that feeds DB / session inputs into these functions. Keeping this import-free is
// the SOLID seam: the SQL filter and the in-memory predicate come from ONE source of truth, so
// they can never drift.

/**
 * Push visibility from token presence. A Provit integration token binds the push to an account's
 * org (paid, private/team data → 'org'); no token → the free public showcase ('public').
 */
export function pushVisibility(hasOrgToken: boolean): 'org' | 'public' {
  return hasOrgToken ? 'org' : 'public';
}

/** A single ABAC rule row (mirrors store.ts AbacRule, minus id). */
export interface ProvitAbacRule {
  role: string;
  resource: string;
  attribute: string;
  operator: string;
  value: string;
  effect: string;
}

/** Does one rule match the (role, action) request? Mirrors store.ts ruleMatches with the Provit
 *  context: resource='provit', attributes={ action }. Wildcards ('*') match any role/resource. */
function ruleMatches(rule: ProvitAbacRule, role: string, action: string): boolean {
  if (rule.role !== '*' && rule.role !== role) return false;
  if (rule.resource !== '*' && rule.resource !== 'provit') return false;
  // The rule's attribute selects which context value it compares; Provit only supplies `action`.
  const attr = rule.attribute === 'action' ? action : undefined;
  const av = attr ?? '';
  if (rule.operator === 'in') return attr !== undefined && rule.value.split(',').includes(av);
  if (rule.operator === 'neq') return av !== rule.value;
  return attr !== undefined && av === rule.value;
}

/**
 * ABAC decision for Provit. Deny-overrides: any matching deny wins. Otherwise allowed if a
 * matching allow exists. IMPORTANT: for Provit, NO matching rule → allowed (the RBAC module gate
 * already applied). This mirrors provit-access.provitAbacAllows for a single role:
 *   - matched deny         → false
 *   - matched, none allow  → false  (a governing rule exists but doesn't grant → denied)
 *   - matched, some allow  → true
 *   - no matching rule      → true   (fail-open refinement)
 * Admins are handled by the caller (never reach here).
 */
export function abacAllows(rules: ProvitAbacRule[], role: string, action: string): boolean {
  const matched = rules.filter((r) => ruleMatches(r, role, action));
  if (matched.length === 0) return true; // no governing rule → allowed
  if (matched.some((r) => r.effect === 'deny')) return false; // deny-overrides
  return matched.some((r) => r.effect === 'allow');
}

/**
 * Row-level tenancy predicate: can this viewer SEE this row? The truth table MUST match the SQL
 * in provit-access.visibilityFilter:
 *   public                          → anyone
 *   org      AND row.orgId == viewer.orgId   → same-org members
 *   private  AND row.ownerId == viewer.email → the owner only
 */
export function canSee(
  row: { visibility: string; orgId: string; ownerId: string },
  viewer: { orgId: string; email: string },
): boolean {
  if (row.visibility === 'public') return true;
  if (row.visibility === 'org') return row.orgId === viewer.orgId;
  if (row.visibility === 'private') return row.ownerId === viewer.email;
  return false;
}
