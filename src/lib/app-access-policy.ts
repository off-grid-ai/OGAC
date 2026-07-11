// ─── Per-app access control — PURE decision (zero-IO, unit-tested) ────────────────────────────────
//
// Every app/agent (a "consumer") is a governed entity: an ACCESS POLICY binds who may act on it and
// under what conditions, enforced at EVERY entry point (run, view, edit, approve, trigger). This is
// the SOLID seam — the rule for "may this caller take this action on this consumer?" lives here with
// no DB/network, so it is exhaustively unit-testable. The thin I/O adapter (persist + load) is
// app-access.ts; the routes call this via that adapter.
//
// The decision COMPOSES three layers, evaluated in this order (deny-overrides, least-privilege):
//   1. RBAC  — is the caller's role / department on the allow-list for this action?
//   2. ABAC  — do the request attributes satisfy every attribute predicate for this action?
//              (reuses the policy-rules operator vocabulary — eq/neq/in/contains — plus numeric
//               comparators for thresholds like amount ≤ limit; NOT a new rules engine.)
//   3. APPROVAL AUTHORITY (approve action only) — does the approver hold the authority (role/user +
//              threshold) required to satisfy a HITL approval? An approver lacking authority is
//              rejected even if they can otherwise "approve".
//
// An `admin` role is always allowed (break-glass / platform operator) — least-privilege applies to
// everyone else. The store layer supplies a DEFAULT policy (owner + admins only) when none is bound.

import {
  type PolicyOperator,
  POLICY_OPERATORS,
} from '@/lib/policy-rules-policy';

// The actions an access policy governs. `run` = execute the consumer; `view` = read its detail/runs;
// `edit` = change its spec/policy; `approve` = satisfy a HITL approval on one of its runs;
// `trigger` = fire it via a webhook/schedule (machine ingress).
export type AppAction = 'run' | 'view' | 'edit' | 'approve' | 'trigger';
export const APP_ACTIONS: readonly AppAction[] = ['run', 'view', 'edit', 'approve', 'trigger'];

// The caller principal, as resolved by a route from the session/bearer + (best-effort) team
// membership. `role` is the effective (base) role; `department` is optional (null ⇒ unknown).
export interface AppAccessCaller {
  role: string | undefined;
  department?: string | null;
  orgId: string;
  userId: string; // the acting principal's stable id (email or machine client-id)
}

// An ABAC predicate over the request attributes. `attribute` names a key in requestAttrs; the
// operator/value semantics match the console policy-rules vocabulary, extended with numeric
// comparators (gt/gte/lt/lte) so thresholds (amount ≤ 50000) are expressible. When the predicate is
// unsatisfiable/attribute-missing the caller is DENIED (fail-closed on ABAC).
export type AbacOperator = PolicyOperator | 'gt' | 'gte' | 'lt' | 'lte';
export const ABAC_OPERATORS: readonly AbacOperator[] = [
  ...POLICY_OPERATORS,
  'gt',
  'gte',
  'lt',
  'lte',
];

export interface AbacPredicate {
  attribute: string; // key into requestAttrs, e.g. "amount" | "region" | "data_class"
  operator: AbacOperator;
  value: string; // compared per-operator; numeric ops coerce both sides to Number
}

// The RBAC + ABAC rule for ONE action.
export interface ActionRule {
  // Roles allowed to take this action. Empty ⇒ no role is allowed by role alone (fall through to
  // department / owner / admin). `*` allows any authenticated role.
  roles?: string[];
  // Departments allowed to take this action (ABAC-on-identity). Empty ⇒ none by department.
  departments?: string[];
  // ABAC predicates over request attributes — ALL must hold (AND). Empty ⇒ no attribute constraint.
  attributes?: AbacPredicate[];
}

// Who may SATISFY a HITL approval, and up to what threshold. An approver must (a) hold an approver
// role/be a listed approver user, AND (b) the value under `thresholdAttribute` in requestAttrs must
// be ≤ `maxThreshold` (when a threshold is configured). An approver above their authority is rejected.
export interface ApprovalAuthority {
  approverRoles?: string[]; // roles that may approve (e.g. ["manager","admin"])
  approverUsers?: string[]; // specific user ids that may approve
  thresholdAttribute?: string; // request attr the threshold applies to (e.g. "amount")
  maxThreshold?: number; // the largest value this authority may approve (inclusive)
}

// The full per-consumer access policy. `ownerId` is the consumer's owner (always allowed, all
// actions — they own it). Per-action RBAC/ABAC in `actions`. Approval authority in `approval`.
export interface AppAccessPolicy {
  appId: string;
  orgId: string;
  ownerId: string;
  actions: Partial<Record<AppAction, ActionRule>>;
  approval?: ApprovalAuthority;
}

export interface AccessDecision {
  allow: boolean;
  reason: string;
}

// ─── the default (least-privilege) policy — owner + admins only ───────────────────────────────────
// When no policy is bound for a consumer, only its owner and org admins may act. Everyone else is
// denied. This is what the store returns on a miss so an unconfigured consumer is closed, not open.
export function defaultAppAccessPolicy(
  appId: string,
  orgId: string,
  ownerId: string,
): AppAccessPolicy {
  return { appId, orgId, ownerId, actions: {} };
}

// ─── pure predicate evaluation ────────────────────────────────────────────────────────────────────
function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return Number.NaN;
}

// Evaluate ONE ABAC predicate against the request attributes. Fail-closed: a missing attribute or an
// unparseable numeric comparison is `false` (denies). Mirrors policy-rules operator semantics for the
// shared operators; adds numeric comparators for thresholds.
export function evaluatePredicate(
  pred: AbacPredicate,
  requestAttrs: Record<string, unknown>,
): boolean {
  const raw = requestAttrs[pred.attribute];
  switch (pred.operator) {
    case 'eq':
      return raw !== undefined && String(raw) === pred.value;
    case 'neq':
      return raw !== undefined && String(raw) !== pred.value;
    case 'in': {
      // value is a comma-separated set; membership by string.
      const set = pred.value.split(',').map((s) => s.trim());
      return raw !== undefined && set.includes(String(raw));
    }
    case 'contains':
      return raw !== undefined && String(raw).includes(pred.value);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = toNum(raw);
      const b = toNum(pred.value);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (pred.operator === 'gt') return a > b;
      if (pred.operator === 'gte') return a >= b;
      if (pred.operator === 'lt') return a < b;
      return a <= b;
    }
    default:
      return false;
  }
}

// True when EVERY predicate holds (AND). Empty ⇒ no constraint ⇒ true.
function allPredicatesHold(
  preds: AbacPredicate[] | undefined,
  requestAttrs: Record<string, unknown>,
): boolean {
  if (!preds || preds.length === 0) return true;
  return preds.every((p) => evaluatePredicate(p, requestAttrs));
}

function roleAllowed(rule: ActionRule | undefined, role: string | undefined): boolean {
  const roles = rule?.roles ?? [];
  if (roles.includes('*')) return true;
  return role !== undefined && roles.includes(role);
}

function departmentAllowed(
  rule: ActionRule | undefined,
  department: string | null | undefined,
): boolean {
  const depts = rule?.departments ?? [];
  return !!department && depts.includes(department);
}

// ─── the approval-authority check (approve action) ─────────────────────────────────────────────────
// An approver must hold an approver role OR be a listed approver user, AND be within the threshold.
// Returns {allow, reason}. Admins are NOT auto-granted here — HITL authority is deliberate: an
// approval policy can require e.g. a manager, and even an admin without threshold authority is
// bounded. (The RBAC gate above still lets admins reach this; authority is a second, explicit check.)
export function evaluateApprovalAuthority(
  authority: ApprovalAuthority | undefined,
  caller: AppAccessCaller,
  requestAttrs: Record<string, unknown>,
): AccessDecision {
  // No authority configured ⇒ any caller who passed RBAC for `approve` may approve.
  if (!authority) return { allow: true, reason: 'no approval authority constraint' };

  const roleOk = (authority.approverRoles ?? []).includes(caller.role ?? '');
  const userOk = (authority.approverUsers ?? []).includes(caller.userId);
  const hasApproverList =
    (authority.approverRoles?.length ?? 0) > 0 || (authority.approverUsers?.length ?? 0) > 0;
  if (hasApproverList && !roleOk && !userOk) {
    return {
      allow: false,
      reason: `approver ${caller.userId} (role ${caller.role ?? 'none'}) is not an authorized approver`,
    };
  }

  // Threshold: the value under thresholdAttribute must be ≤ maxThreshold.
  if (authority.thresholdAttribute && authority.maxThreshold !== undefined) {
    const v = toNum(requestAttrs[authority.thresholdAttribute]);
    if (Number.isNaN(v)) {
      return {
        allow: false,
        reason: `approval requires a numeric ${authority.thresholdAttribute} to check against the authority threshold`,
      };
    }
    if (v > authority.maxThreshold) {
      return {
        allow: false,
        reason: `${authority.thresholdAttribute}=${v} exceeds approver authority (max ${authority.maxThreshold})`,
      };
    }
  }
  return { allow: true, reason: 'approval authority satisfied' };
}

// ─── the top-level decision ────────────────────────────────────────────────────────────────────────
// evaluateAppAccess(policy, caller, action, requestAttrs) → {allow, reason}
//
// Order (deny-overrides, least-privilege):
//   • cross-org caller      → deny (defense in depth)
//   • admin role            → allow (break-glass; skips per-action RBAC/ABAC, but NOT approval authority)
//   • owner                 → allow (owns the consumer)
//   • else RBAC+ABAC        → the action's rule must admit the caller by role OR department, AND all
//                             its attribute predicates must hold. No matching rule ⇒ deny.
//   • approve action        → additionally the approval authority must be satisfied.
export function evaluateAppAccess(
  policy: AppAccessPolicy,
  caller: AppAccessCaller,
  action: AppAction,
  requestAttrs: Record<string, unknown> = {},
): AccessDecision {
  // Org boundary — a policy only ever governs its own org's callers. A cross-org caller is denied
  // outright (defense in depth; routes already org-scope the load).
  if (caller.orgId !== policy.orgId) {
    return {
      allow: false,
      reason: `caller org ${caller.orgId} does not match policy org ${policy.orgId}`,
    };
  }

  const isAdmin = caller.role === 'admin';
  const isOwner = !!caller.userId && caller.userId === policy.ownerId;
  const rule = policy.actions[action];

  // RBAC/ABAC gate — admin and owner bypass it; everyone else must be admitted by the action rule.
  if (!isAdmin && !isOwner) {
    const byRole = roleAllowed(rule, caller.role);
    const byDept = departmentAllowed(rule, caller.department);
    if (!byRole && !byDept) {
      return {
        allow: false,
        reason: `role ${caller.role ?? 'none'}${
          caller.department ? `/dept ${caller.department}` : ''
        } is not permitted to ${action} this consumer`,
      };
    }
    if (!allPredicatesHold(rule?.attributes, requestAttrs)) {
      return {
        allow: false,
        reason: `request attributes do not satisfy the ${action} constraints for this consumer`,
      };
    }
  }

  // Approval authority — a second, explicit gate for the HITL approve action (applies to admins too).
  if (action === 'approve') {
    const auth = evaluateApprovalAuthority(policy.approval, caller, requestAttrs);
    if (!auth.allow) return auth;
  }

  let via: 'admin' | 'owner' | 'policy' = 'policy';
  if (isAdmin) via = 'admin';
  else if (isOwner) via = 'owner';
  return { allow: true, reason: `${action} permitted (${via})` };
}

// ─── validation of a policy PATCH payload (pure; used by the admin route) ──────────────────────────
// Sanitizes an incoming policy body into an AppAccessPolicy's mutable parts. Never throws — returns a
// result object so the route handler stays thin. Only the fields present are validated.
export interface AppAccessPolicyInput {
  actions: Partial<Record<AppAction, ActionRule>>;
  approval?: ApprovalAuthority;
}

export interface PolicyValidation {
  ok: boolean;
  value?: AppAccessPolicyInput;
  errors: string[];
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function sanitizePredicates(raw: unknown, errors: string[], where: string): AbacPredicate[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push(`${where}.attributes must be an array`);
    return [];
  }
  const out: AbacPredicate[] = [];
  for (const p of raw) {
    const o = (p ?? {}) as Record<string, unknown>;
    const attribute = typeof o.attribute === 'string' ? o.attribute.trim() : '';
    let value: string;
    if (typeof o.value === 'string') value = o.value;
    else if (o.value === undefined) value = '';
    else value = String(o.value);
    const operator = o.operator;
    if (!attribute) {
      errors.push(`${where}.attributes: each predicate needs an attribute`);
      continue;
    }
    if (!(ABAC_OPERATORS as readonly string[]).includes(operator as string)) {
      errors.push(`${where}.attributes: operator must be one of ${ABAC_OPERATORS.join('|')}`);
      continue;
    }
    out.push({ attribute, operator: operator as AbacOperator, value });
  }
  return out;
}

export function validateAppAccessPolicyInput(raw: unknown): PolicyValidation {
  const errors: string[] = [];
  const body = (raw ?? {}) as Record<string, unknown>;
  const actions: Partial<Record<AppAction, ActionRule>> = {};

  const rawActions = (body.actions ?? {}) as Record<string, unknown>;
  if (typeof rawActions !== 'object' || rawActions === null || Array.isArray(rawActions)) {
    errors.push('actions must be an object keyed by action');
  } else {
    for (const key of Object.keys(rawActions)) {
      if (!(APP_ACTIONS as readonly string[]).includes(key)) {
        errors.push(`unknown action "${key}" — must be one of ${APP_ACTIONS.join('|')}`);
        continue;
      }
      const r = (rawActions[key] ?? {}) as Record<string, unknown>;
      const rule: ActionRule = {};
      if (r.roles !== undefined) {
        if (!isStringArray(r.roles)) errors.push(`actions.${key}.roles must be a string array`);
        else rule.roles = r.roles.map((s) => s.trim()).filter(Boolean);
      }
      if (r.departments !== undefined) {
        if (!isStringArray(r.departments))
          errors.push(`actions.${key}.departments must be a string array`);
        else rule.departments = r.departments.map((s) => s.trim()).filter(Boolean);
      }
      rule.attributes = sanitizePredicates(r.attributes, errors, `actions.${key}`);
      actions[key as AppAction] = rule;
    }
  }

  let approval: ApprovalAuthority | undefined;
  if (body.approval !== undefined && body.approval !== null) {
    const a = body.approval as Record<string, unknown>;
    approval = {};
    if (a.approverRoles !== undefined) {
      if (!isStringArray(a.approverRoles)) errors.push('approval.approverRoles must be a string array');
      else approval.approverRoles = a.approverRoles.map((s) => s.trim()).filter(Boolean);
    }
    if (a.approverUsers !== undefined) {
      if (!isStringArray(a.approverUsers)) errors.push('approval.approverUsers must be a string array');
      else approval.approverUsers = a.approverUsers.map((s) => s.trim()).filter(Boolean);
    }
    if (a.thresholdAttribute !== undefined) {
      if (typeof a.thresholdAttribute !== 'string')
        errors.push('approval.thresholdAttribute must be a string');
      else if (a.thresholdAttribute.trim()) approval.thresholdAttribute = a.thresholdAttribute.trim();
    }
    if (a.maxThreshold !== undefined) {
      const n = typeof a.maxThreshold === 'number' ? a.maxThreshold : Number(a.maxThreshold);
      if (!Number.isFinite(n)) errors.push('approval.maxThreshold must be a number');
      else approval.maxThreshold = n;
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], value: { actions, approval } };
}
