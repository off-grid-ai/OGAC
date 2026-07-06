// Starter policy templates. Pure catalog + apply-payload builder — the only import is the pure
// policy-rules types (shape + validator), no DB/network. Each template is a plain-language name +
// what it enforces + the CONCRETE PolicyRuleInput it creates. The Policy UI renders this and, on
// "Apply", posts buildPolicyPayload(...) through the EXISTING create path
// (POST /api/v1/admin/policy/rules → validatePolicyRule → createPolicyRule → push to OPA). No new
// storage and no invented rule format: the payload is exactly what the policy engine already accepts.

import {
  type PolicyEffect,
  type PolicyOperator,
  type PolicyRuleInput,
  validatePolicyRule,
} from '@/lib/policy-rules-policy';

export type PolicyTemplateGroup =
  | 'Data residency'
  | 'Egress control'
  | 'Model governance'
  | 'Operations';

export const POLICY_TEMPLATE_GROUPS: readonly PolicyTemplateGroup[] = [
  'Data residency',
  'Egress control',
  'Model governance',
  'Operations',
];

// A template is a fully-formed PolicyRuleInput plus presentation metadata. The `rule` is the concrete
// entry that gets created — it already matches the console policy-rule shape (attribute/operator/
// value/effect/priority), so no translation happens at apply time.
export interface PolicyTemplate {
  id: string; // stable slug — React key + lookup, not persisted
  group: PolicyTemplateGroup;
  // Plain-language name shown to the operator (the rule's name is this too).
  title: string;
  // "What it enforces" — one/two sentences an operator reads before applying.
  enforces: string;
  rule: PolicyRuleInput;
}

// A one-line "the concrete rule this creates" for the card, e.g. "deny when region neq on_prem".
export function ruleSummary(t: PolicyTemplate): string {
  const { attribute, operator, value, effect } = t.rule;
  return `${effect} when ${attribute} ${operator} ${value}`;
}

// Build the apply payload: exactly the PolicyRuleInput the POST route validates and persists. Pure
// and total. We run it through the real validator so a malformed template is caught in tests, not
// in production — and so this file can never drift from the shape the engine accepts.
export function buildPolicyPayload(t: PolicyTemplate): PolicyRuleInput {
  const result = validatePolicyRule(t.rule);
  if (!result.ok || !result.value) {
    throw new Error(`policy template "${t.id}" is invalid: ${result.errors.join('; ')}`);
  }
  return result.value;
}

// Case-insensitive search across title, enforces, and the concrete rule fields.
export function searchTemplates(templates: PolicyTemplate[], query: string): PolicyTemplate[] {
  const q = query.trim().toLowerCase();
  if (!q) return templates;
  return templates.filter((t) => {
    const { attribute, value, effect } = t.rule;
    const hay = [t.title, t.enforces, attribute, value, effect, ruleSummary(t)]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

// Group templates by category, preserving POLICY_TEMPLATE_GROUPS order, dropping empty groups.
export function groupTemplates(
  templates: PolicyTemplate[],
): Array<{ group: PolicyTemplateGroup; items: PolicyTemplate[] }> {
  return POLICY_TEMPLATE_GROUPS.map((group) => ({
    group,
    items: templates.filter((t) => t.group === group),
  })).filter((g) => g.items.length > 0);
}

const deny: PolicyEffect = 'deny';
const eq: PolicyOperator = 'eq';
const neq: PolicyOperator = 'neq';
const contains: PolicyOperator = 'contains';

export const POLICY_TEMPLATES: readonly PolicyTemplate[] = [
  {
    id: 'data-residency-on-prem',
    group: 'Data residency',
    title: 'Data residency — keep on-prem',
    enforces:
      'Deny any request whose region is not the on-prem fleet, so data never leaves the local deployment.',
    rule: {
      name: 'Data residency — keep on-prem',
      description: 'Deny requests originating outside the on-prem region.',
      attribute: 'region',
      operator: neq,
      value: 'on_prem',
      effect: deny,
      priority: 10,
    },
  },
  {
    id: 'retention-max',
    group: 'Data residency',
    title: 'Retention limit',
    enforces:
      'Deny requests tagged for indefinite retention, forcing every workload onto a bounded retention class.',
    rule: {
      name: 'Retention limit — no indefinite',
      description: 'Deny requests whose retention class is indefinite.',
      attribute: 'retention',
      operator: eq,
      value: 'indefinite',
      effect: deny,
      priority: 60,
    },
  },
  {
    id: 'pii-egress-block',
    group: 'Egress control',
    title: 'PII egress block',
    enforces:
      'Deny any request whose data class is PII, blocking personally-identifiable data from leaving the boundary.',
    rule: {
      name: 'PII egress block',
      description: 'Deny requests carrying PII-classified data.',
      attribute: 'data_class',
      operator: eq,
      value: 'pii',
      effect: deny,
      priority: 20,
    },
  },
  {
    id: 'cloud-leash',
    group: 'Egress control',
    title: 'Cloud leash — no external providers',
    enforces:
      'Deny requests whose destination is an external/cloud target, keeping inference on the local fleet only.',
    rule: {
      name: 'Cloud leash — no external destinations',
      description: 'Deny requests routed to an external cloud destination.',
      attribute: 'destination',
      operator: eq,
      value: 'external',
      effect: deny,
      priority: 25,
    },
  },
  {
    id: 'model-allowlist',
    group: 'Model governance',
    title: 'Model allowlist — fleet models only',
    enforces:
      'Deny requests whose provider is not the on-prem fleet, so only fleet-hosted models can serve traffic.',
    rule: {
      name: 'Model allowlist — fleet only',
      description: 'Deny requests targeting a provider other than the on-prem fleet.',
      attribute: 'provider',
      operator: neq,
      value: 'fleet',
      effect: deny,
      priority: 30,
    },
  },
  {
    id: 'no-external-provider',
    group: 'Model governance',
    title: 'Block named external providers',
    enforces:
      'Deny requests whose provider string contains a known external vendor marker (e.g. openai, anthropic, google), a coarse belt-and-suspenders alongside the allowlist.',
    rule: {
      name: 'Block external providers',
      description: 'Deny requests whose provider name contains an external-vendor marker.',
      attribute: 'provider',
      operator: contains,
      value: 'external',
      effect: deny,
      priority: 35,
    },
  },
  {
    id: 'rate-limit-class',
    group: 'Operations',
    title: 'Rate-limit tier — deny burst class',
    enforces:
      'Deny requests marked as the uncapped/burst rate class, forcing callers onto a rate-limited tier.',
    rule: {
      name: 'Rate-limit — deny uncapped tier',
      description: 'Deny requests whose rate class is uncapped.',
      attribute: 'rate_class',
      operator: eq,
      value: 'uncapped',
      effect: deny,
      priority: 80,
    },
  },
];
