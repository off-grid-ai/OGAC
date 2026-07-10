/** A single addressable model node behind the gateway. */
interface GatewayNode {
    name: string;
    host: string;
    port: number;
    model: string;
    vision?: boolean;
    enabled?: boolean;
}
/**
 * Mutable context threaded through every policy for a single request.
 * A policy's `pre` hook may set `deny` (reject) or `shortCircuit` (serve without
 * hitting a node), mutate `body`, or stash data in `meta`.
 */
interface PolicyContext {
    caller: string;
    corrId: string;
    model: string;
    image: boolean;
    body: Record<string, unknown>;
    target: GatewayNode;
    candidates: GatewayNode[];
    deny?: {
        status: number;
        message: string;
        policy: string;
    };
    shortCircuit?: {
        status: number;
        json: unknown;
        from: string;
    };
    meta: Record<string, unknown>;
}
/** Result of an upstream call, handed to each policy's `post` hook. */
interface PolicyOutcome {
    status: number;
    output: string;
    promptTokens: number;
    completionTokens: number;
    streamed: boolean;
    raw?: unknown;
}
/** A composable gateway policy. `pre` runs before dispatch, `post` after. */
interface Policy {
    readonly name: string;
    pre?(ctx: PolicyContext): void | Promise<void>;
    post?(ctx: PolicyContext, o: PolicyOutcome): void | Promise<void>;
}

/** A single OpenAI-style chat message. `content` is a string or a multipart array. */
interface ChatMessage {
    role?: string;
    content?: unknown;
    [k: string]: unknown;
}
/** Pull the `messages` array out of a request body, or [] if absent/invalid. */
declare function getMessages(body: Record<string, unknown>): ChatMessage[];
/** Index of the last message with role 'user', or -1. */
declare function lastUserIndex(messages: ChatMessage[]): number;
/** Extract the text of a message's content (concatenating multipart text parts). */
declare function contentText(content: unknown): string;
/** Read the last user message text (empty string if none). */
declare function readLastUserText(body: Record<string, unknown>): string;
/**
 * Rewrite the last user message text in place, preserving content shape:
 * string stays a string; multipart keeps its parts, replacing the first text part
 * (or appending one). Returns true if a rewrite happened.
 */
declare function rewriteLastUserText(body: Record<string, unknown>, next: string): boolean;

declare function fnv1a(str: string): string;

interface GuardrailOptions {
    /** Substrings or regexes that, if matched in the user text, reject the request. */
    denyPatterns?: (string | RegExp)[];
    /** Reject if the user text exceeds this many characters. */
    maxInputChars?: number;
    /** Reject (403) if the requested model is in this list. */
    blockedModels?: string[];
    /** Redact PII in the user text before dispatch (requires presidioUrl). */
    piiRedact?: boolean;
    /** Base URL of a Presidio deployment, e.g. http://localhost:5002. */
    presidioUrl?: string;
}
declare function guardrails(opts?: GuardrailOptions): Policy;

interface RateLimitOptions {
    /** Allowed requests per minute per key. */
    rpm: number;
    /** Bucket key dimension. Default: 'caller'. */
    per?: 'caller' | 'model';
}
declare function rateLimit(opts: RateLimitOptions): Policy;

interface BudgetOptions {
    /** Max tokens allowed within the window per key. */
    maxTokens: number;
    /** Sliding window length in ms. Default: 60_000. */
    windowMs?: number;
    /** Budget key dimension. Default: 'caller'. */
    per?: 'caller' | 'model';
}
declare function budget(opts: BudgetOptions): Policy;

interface CacheOptions {
    /** Entry lifetime in ms. Default: 300_000 (5 min). */
    ttlMs?: number;
    /** Max stored entries before oldest are evicted. Default: 500. */
    maxEntries?: number;
}
declare function cache(opts?: CacheOptions): Policy;

/**
 * Reads (env or process.env):
 *  - OFFGRID_GUARDRAIL_DENY   comma-separated deny keywords/patterns
 *  - OFFGRID_MAX_INPUT_CHARS  max user-text length
 *  - OFFGRID_BLOCKED_MODELS   comma-separated blocked model ids
 *  - OFFGRID_PRESIDIO_URL     enables PII redaction when set
 *  - OFFGRID_RATELIMIT_RPM    requests-per-minute cap
 *  - OFFGRID_BUDGET_TOKENS    rolling token budget
 *  - OFFGRID_BUDGET_WINDOW_MS budget window (default 60000)
 *  - OFFGRID_CACHE_TTL_MS     enables response cache when set (>0)
 */
declare function policiesFromEnv(env?: Record<string, string | undefined>): Policy[];

type PolicyCategory = 'guardrail' | 'rate-limit' | 'budget' | 'cache';
interface PolicyIntegration {
    id: string;
    name: string;
    category: PolicyCategory;
    /** Config field keys a UI should prompt for. */
    configFields?: string[];
    description?: string;
}
/** Guardrail backends (content safety / validation). */
declare const GUARDRAIL_INTEGRATIONS: readonly PolicyIntegration[];
/** Rate-limit backends. */
declare const RATE_LIMIT_INTEGRATIONS: readonly PolicyIntegration[];
/** Budget backends. */
declare const BUDGET_INTEGRATIONS: readonly PolicyIntegration[];
/** Cache backends. */
declare const CACHE_INTEGRATIONS: readonly PolicyIntegration[];
/** All policy integrations, flattened, for a single unified UI list. */
declare const POLICY_INTEGRATIONS: readonly PolicyIntegration[];

export { BUDGET_INTEGRATIONS, type BudgetOptions, CACHE_INTEGRATIONS, type CacheOptions, type ChatMessage, GUARDRAIL_INTEGRATIONS, type GatewayNode, type GuardrailOptions, POLICY_INTEGRATIONS, type Policy, type PolicyCategory, type PolicyContext, type PolicyIntegration, type PolicyOutcome, RATE_LIMIT_INTEGRATIONS, type RateLimitOptions, budget, cache, contentText, fnv1a, getMessages, guardrails, lastUserIndex, policiesFromEnv, rateLimit, readLastUserText, rewriteLastUserText };
