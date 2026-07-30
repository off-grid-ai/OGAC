// ─── Scope an unfiltered read to the case being worked — pure ──────────────────────────────────────
//
// B3.1, the last inch. The compiler now notices when an agent reasons about data nothing fetches and
// inserts the read (`agent-data-dependency.ts`). But it inserts an UNFILTERED read, because at compile
// time nobody knows the resource's columns — and the live result was this:
//
//   s1   read expense_claims   → Meera Malhotra's claim, ₹41,346.44          (case-scoped, correct)
//   dep1 read employee_quota   → 20 arbitrary rows, none of them hers        (unscoped)
//   s2   agent → "no reimbursement quota data is provided in the sources for Meera Malhotra"
//
// The agent behaved correctly. The read was the defect — and it is the same twenty-unrelated-rows
// defect the case-scoping work already fixed once for HAND-WIRED steps, reintroduced by the fix for
// the missing read. A hand-authored step says `params: { employee_id: '{{case.employee_id}}' }`; an
// inserted step has no author to write that.
//
// Run time can do what compile time cannot: it holds the case record, and one cheap probe read reveals
// the resource's columns. Intersect the two and the filter writes itself.
//
// THE HAZARD THIS MODULE EXISTS TO AVOID. The naive intersection is dangerous. Both tables almost
// always have a column called `id`, and they mean different things — `employee_quota.id = <claim id>`
// is not a narrower read, it is a WRONG one, and it would return a confident row about the wrong
// entity. That is worse than the unscoped read it replaces, because nothing downstream can tell.
//
// So a column only becomes a filter when its name carries its own scope:
//   • `employee_id`, `policy_no`, `customer_code` — qualified, means the same thing in both tables.
//   • bare `id`, `code`, `no`  — table-local. NEVER matched.
//   • `status`, `amount`, `category` — not identifiers. Not matched: over-filtering on an attribute
//     turns "her quota" into "no rows" when a label differs by a word, which reads as an empty table.
//
// Narrowing on a shared qualified identifier is monotone and safe: it can only ever return a SUBSET of
// what the unscoped read returned, so the worst case is the empty set we already had — never a
// different entity's row.

/** A scalar a SQL equality filter can bind. Anything else (object, array) is not a join key. */
export type ScopeValue = string | number | boolean;

export interface CaseScope {
  /** Equality filters to apply, column → value. Empty when nothing safe was inferrable. */
  filters: Record<string, ScopeValue>;
  /** The columns used, for the step's detail line — an inferred filter must never be invisible. */
  keys: string[];
}

/**
 * Is this column name a QUALIFIED identifier — one whose meaning is the same in any table?
 *
 * The qualifier is what makes it safe: `employee_id` names the employee in every table that carries
 * it, while `id` names whatever row the table happens to hold. So we require a prefix before the
 * identifier suffix, and reject the bare form outright.
 */
export function isQualifiedIdentifier(column: string): boolean {
  const c = column.trim().toLowerCase();
  // At least one prefix segment, then an identifier-ish suffix. `employee_id` ✓  `id` ✗  `_id` ✗
  return /^[a-z0-9]+(?:_[a-z0-9]+)*_(?:id|code|no|number|ref)$/.test(c);
}

/** Scalars only, and never blank — a filter on '' is not a narrowing, it is a guess. */
function scopeValue(v: unknown): ScopeValue | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  return null;
}

/**
 * Infer the equality filters that scope `resourceColumns` to `caseRecord`.
 *
 * Both sides are compared case-insensitively (a probe row's keys come back however the driver cased
 * them), and the filter is emitted under the RESOURCE's spelling, since that is what goes into the
 * statement.
 */
export function inferCaseScope(
  resourceColumns: readonly string[],
  caseRecord: Record<string, unknown> | null | undefined,
): CaseScope {
  if (!caseRecord) return { filters: {}, keys: [] };

  // Case-record keys by normalised name, so `Employee_Id` in the row matches `employee_id` in the table.
  const byNorm = new Map<string, unknown>();
  for (const [k, v] of Object.entries(caseRecord)) byNorm.set(k.trim().toLowerCase(), v);

  const filters: Record<string, ScopeValue> = {};
  const keys: string[] = [];
  for (const column of resourceColumns) {
    if (!isQualifiedIdentifier(column)) continue;
    if (!byNorm.has(column.trim().toLowerCase())) continue;
    const value = scopeValue(byNorm.get(column.trim().toLowerCase()));
    if (value === null) continue;
    filters[column] = value;
    keys.push(column);
  }
  return { filters, keys };
}

/** Column names from a probe row. Nothing to learn from an empty result — and that is not an error. */
export function columnsOfRow(row: unknown): string[] {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
  return Object.keys(row as Record<string, unknown>);
}

/**
 * The step's detail suffix. An inferred filter changes what the app read, so it is always stated —
 * including when nothing could be inferred, because "we read this unscoped" is the fact a reviewer
 * needs in order to trust or distrust the answer.
 */
export function scopeDetail(scope: CaseScope): string {
  if (scope.keys.length === 0) return 'unscoped (no shared identifier with the case)';
  return `scoped to the case by ${scope.keys.join(', ')}`;
}
