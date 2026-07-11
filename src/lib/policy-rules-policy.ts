// Pure policy-rule validation + shaping — zero imports, unit-testable. This is the SOLID seam for the
// Policy management module: the rules for what makes a valid console-owned policy entry live here,
// with no DB/network. lib/policy-rules.ts is the thin I/O adapter that persists what this validates,
// and the OPA-bundle projection below is the pure transform the "push to OPA" action ships.

// A console-owned policy entry: "when a request's <attribute> <operator> <value>, <effect> it."
// Distinct from routing_rules (which pick a target); these are allow/deny authorization entries the
// console compiles into the OPA data document at offgrid/console_policy.
export interface PolicyRuleInput {
  name: string;
  description: string;
  attribute: string; // e.g. role | data_class | resource | region
  operator: PolicyOperator;
  value: string;
  effect: PolicyEffect;
  priority: number; // lower = evaluated first
}

export type PolicyEffect = 'allow' | 'deny';
export type PolicyOperator = 'eq' | 'neq' | 'in' | 'contains';

export const POLICY_EFFECTS: readonly PolicyEffect[] = ['allow', 'deny'];
export const POLICY_OPERATORS: readonly PolicyOperator[] = ['eq', 'neq', 'in', 'contains'];

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
}

const NAME_MAX = 120;
const VALUE_MAX = 500;
const DESC_MAX = 500;

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function isEffect(v: unknown): v is PolicyEffect {
  return typeof v === 'string' && (POLICY_EFFECTS as readonly string[]).includes(v);
}

function isOperator(v: unknown): v is PolicyOperator {
  return typeof v === 'string' && (POLICY_OPERATORS as readonly string[]).includes(v);
}

// Coerce a priority into an integer in [0, 10000]; non-numeric / out-of-range → null (the validator
// turns that into a message). Accepts number or numeric string.
function coercePriority(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < 0 || n > 10000) return null;
  return n;
}

function validAttribute(a: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(a);
}

// Validate a full create payload. Trims strings; enforces required fields, enum membership, and
// lengths. Never throws — returns a result object so route handlers stay thin.
export function validatePolicyRule(raw: unknown): ValidationResult<PolicyRuleInput> {
  const errors: string[] = [];
  const body = (raw ?? {}) as Record<string, unknown>;

  const name = asString(body.name).trim();
  if (!name) errors.push('name is required');
  else if (name.length > NAME_MAX) errors.push(`name must be ≤ ${NAME_MAX} chars`);

  const attribute = asString(body.attribute).trim();
  if (!attribute) errors.push('attribute is required');
  else if (!validAttribute(attribute))
    errors.push('attribute may only contain letters, digits, and _.-');

  const value = asString(body.value).trim();
  if (!value) errors.push('value is required');
  else if (value.length > VALUE_MAX) errors.push(`value must be ≤ ${VALUE_MAX} chars`);

  const description = asString(body.description).trim();
  if (description.length > DESC_MAX) errors.push(`description must be ≤ ${DESC_MAX} chars`);

  if (!isEffect(body.effect)) errors.push('effect must be allow | deny');
  if (!isOperator(body.operator)) errors.push('operator must be eq | neq | in | contains');

  const priority = coercePriority(body.priority ?? 100);
  if (priority === null) errors.push('priority must be an integer in [0, 10000]');

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    value: {
      name,
      description,
      attribute,
      value,
      effect: body.effect as PolicyEffect,
      operator: body.operator as PolicyOperator,
      priority: priority as number,
    },
  };
}

// Validate a partial update payload (PATCH): only provided keys are checked, and at least one
// mutable field must be present. Returns the sanitized partial on success.
export function validatePolicyRulePatch(
  raw: unknown,
): ValidationResult<Partial<PolicyRuleInput> & { enabled?: boolean }> {
  const errors: string[] = [];
  const body = (raw ?? {}) as Record<string, unknown>;
  const out: Partial<PolicyRuleInput> & { enabled?: boolean } = {};

  if ('name' in body) {
    const name = asString(body.name).trim();
    if (!name) errors.push('name cannot be empty');
    else if (name.length > NAME_MAX) errors.push(`name must be ≤ ${NAME_MAX} chars`);
    else out.name = name;
  }
  if ('attribute' in body) {
    const attribute = asString(body.attribute).trim();
    if (!attribute || !validAttribute(attribute))
      errors.push('attribute may only contain letters, digits, and _.-');
    else out.attribute = attribute;
  }
  if ('value' in body) {
    const value = asString(body.value).trim();
    if (!value) errors.push('value cannot be empty');
    else if (value.length > VALUE_MAX) errors.push(`value must be ≤ ${VALUE_MAX} chars`);
    else out.value = value;
  }
  if ('description' in body) {
    const description = asString(body.description).trim();
    if (description.length > DESC_MAX) errors.push(`description must be ≤ ${DESC_MAX} chars`);
    else out.description = description;
  }
  if ('effect' in body) {
    if (!isEffect(body.effect)) errors.push('effect must be allow | deny');
    else out.effect = body.effect;
  }
  if ('operator' in body) {
    if (!isOperator(body.operator)) errors.push('operator must be eq | neq | in | contains');
    else out.operator = body.operator;
  }
  if ('priority' in body) {
    const priority = coercePriority(body.priority);
    if (priority === null) errors.push('priority must be an integer in [0, 10000]');
    else out.priority = priority;
  }
  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') errors.push('enabled must be a boolean');
    else out.enabled = body.enabled;
  }

  if (!errors.length && Object.keys(out).length === 0) errors.push('no updatable fields provided');
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], value: out };
}

// A stored rule as the module returns it.
export interface PolicyRule extends PolicyRuleInput {
  id: string;
  enabled: boolean;
}

// Pure projection of the enabled policy rules into an OPA-friendly data document. This is exactly
// what the "Push to OPA" action ships to `PUT /v1/data/offgrid/console_policy`. Deny-overrides:
// deny entries sort ahead of allow entries, then ascending priority, so the Rego (or the first-party
// engine) can apply deny-first semantics deterministically. Disabled rules are dropped.
export interface OpaPolicyDocument {
  version: number;
  entries: Array<{
    id: string;
    attribute: string;
    operator: PolicyOperator;
    value: string;
    effect: PolicyEffect;
    priority: number;
  }>;
}

export function toOpaDocument(rules: PolicyRule[], version = 1): OpaPolicyDocument {
  const entries = rules
    .filter((r) => r.enabled)
    .slice()
    .sort((a, b) =>
      a.effect === b.effect ? a.priority - b.priority : a.effect === 'deny' ? -1 : 1,
    )
    .map((r) => ({
      id: r.id,
      attribute: r.attribute,
      operator: r.operator,
      value: r.value,
      effect: r.effect,
      priority: r.priority,
    }));
  return { version, entries };
}
