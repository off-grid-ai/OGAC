// @offgrid/policy — public entry point.
// Plug-and-play policy layer for the Off Grid local AI gateway: guardrails,
// rate limits, budgets, and response caching. The "beat Portkey" middle layer.

export type {
  GatewayNode,
  Policy,
  PolicyContext,
  PolicyOutcome,
} from './gateway-types.js';

export {
  getMessages,
  lastUserIndex,
  contentText,
  readLastUserText,
  rewriteLastUserText,
} from './messages.js';
export type { ChatMessage } from './messages.js';

export { fnv1a } from './hash.js';

export { guardrails } from './guardrails.js';
export type { GuardrailOptions } from './guardrails.js';

export { rateLimit } from './rate-limit.js';
export type { RateLimitOptions } from './rate-limit.js';

export { budget } from './budget.js';
export type { BudgetOptions } from './budget.js';

export { cache } from './cache.js';
export type { CacheOptions } from './cache.js';

export { policiesFromEnv } from './from-env.js';

export {
  GUARDRAIL_INTEGRATIONS,
  RATE_LIMIT_INTEGRATIONS,
  BUDGET_INTEGRATIONS,
  CACHE_INTEGRATIONS,
  POLICY_INTEGRATIONS,
} from './catalog.js';
export type { PolicyCategory, PolicyIntegration } from './catalog.js';
