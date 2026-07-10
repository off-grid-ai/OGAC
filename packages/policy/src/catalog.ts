// @offgrid/policy — integration catalog.
// Machine-readable descriptions of available policy backends so a UI (console) can
// render a "policies" configuration screen without hardcoding options.

export type PolicyCategory = 'guardrail' | 'rate-limit' | 'budget' | 'cache';

export interface PolicyIntegration {
  id: string;
  name: string;
  category: PolicyCategory;
  /** Config field keys a UI should prompt for. */
  configFields?: string[];
  description?: string;
}

/** Guardrail backends (content safety / validation). */
export const GUARDRAIL_INTEGRATIONS: readonly PolicyIntegration[] = [
  {
    id: 'presidio',
    name: 'Microsoft Presidio (PII)',
    category: 'guardrail',
    configFields: ['url'],
    description: 'Detect and redact PII via a local Presidio analyzer/anonymizer.',
  },
  {
    id: 'regex',
    name: 'Regex/Keyword deny',
    category: 'guardrail',
    configFields: ['patterns'],
    description: 'Block requests whose text matches keyword substrings or regexes.',
  },
  {
    id: 'llm-judge',
    name: 'LLM judge',
    category: 'guardrail',
    configFields: ['model', 'rubric'],
    description: 'Route input through a local model that judges against a rubric.',
  },
  {
    id: 'json-schema',
    name: 'JSON schema validate',
    category: 'guardrail',
    configFields: ['schema'],
    description: 'Validate structured output against a JSON schema.',
  },
  {
    id: 'max-input',
    name: 'Max input size',
    category: 'guardrail',
    configFields: ['maxInputChars'],
    description: 'Reject prompts larger than a character cap.',
  },
  {
    id: 'blocked-models',
    name: 'Model allow/deny list',
    category: 'guardrail',
    configFields: ['blockedModels'],
    description: 'Refuse requests targeting disallowed models.',
  },
  {
    id: 'secrets-scan',
    name: 'Secret/credential scan',
    category: 'guardrail',
    configFields: [],
    description: 'Detect leaked API keys, tokens, and private keys in prompts.',
  },
];

/** Rate-limit backends. */
export const RATE_LIMIT_INTEGRATIONS: readonly PolicyIntegration[] = [
  {
    id: 'token-bucket',
    name: 'Token-bucket RPM',
    category: 'rate-limit',
    configFields: ['rpm', 'per'],
    description: 'In-process requests-per-minute limiter keyed by caller or model.',
  },
];

/** Budget backends. */
export const BUDGET_INTEGRATIONS: readonly PolicyIntegration[] = [
  {
    id: 'rolling-tokens',
    name: 'Rolling token budget',
    category: 'budget',
    configFields: ['maxTokens', 'windowMs', 'per'],
    description: 'Sliding-window token spend cap per caller or model.',
  },
];

/** Cache backends. */
export const CACHE_INTEGRATIONS: readonly PolicyIntegration[] = [
  {
    id: 'exact-memory',
    name: 'Exact-match memory cache',
    category: 'cache',
    configFields: ['ttlMs', 'maxEntries'],
    description: 'In-process cache of non-streaming responses keyed by request hash.',
  },
];

/** All policy integrations, flattened, for a single unified UI list. */
export const POLICY_INTEGRATIONS: readonly PolicyIntegration[] = [
  ...GUARDRAIL_INTEGRATIONS,
  ...RATE_LIMIT_INTEGRATIONS,
  ...BUDGET_INTEGRATIONS,
  ...CACHE_INTEGRATIONS,
];
