// PURE cloud-provider CONFIGURATION + SELECTION — ZERO I/O, ZERO imports, exhaustively unit-testable
// (mirrors routing-policy.ts / tenancy-policy.ts). This module answers two questions with no network:
//
//   1. Which cloud providers are CONFIGURED? — parsed from a plain env bag, so a provider is only
//      "wired" when it has both a base URL and an API key. No key ⇒ not configured ⇒ never used.
//   2. Given a routing decision's target model, WHICH configured provider + upstream model should
//      serve it? — a pure selection rule.
//
// The I/O adapter (cloud-client.ts) does the actual fetch; the governance chokepoint
// (cloud-routing.ts) decides whether a cloud call is even PERMITTED. This file only describes the
// providers and picks one — it can never, by construction, leak data (it has no fetch).
//
// Every OpenAI-compatible provider is treated identically: a base URL (…/v1) + a bearer API key.
// OpenAI, an OpenAI-compatible proxy, and Anthropic (via its OpenAI-compatible /v1 endpoint) all fit.

/** A cloud provider as configured from env. `apiKey` is present ⇒ the provider is usable. */
export interface CloudProviderConfig {
  /** Stable id used in models tags + audit (e.g. 'openai', 'anthropic', 'compat'). */
  id: string;
  /** Human label for the console. */
  label: string;
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 (no trailing slash). */
  baseUrl: string;
  /** Bearer API key. NEVER logged or returned to the client — presence only. */
  apiKey: string;
  /**
   * Model-tag prefixes that route to this provider. A routing rule's target model like
   * `openai/gpt-4o-mini` or `cloud:openai:gpt-4o` selects this provider by its id/prefix.
   */
  prefixes: string[];
  /** Default upstream model to use when the routing rule names the provider but no specific model. */
  defaultModel: string;
}

/** The env bag this module reads (a plain object so tests pass values without touching process.env). */
export type CloudEnv = Record<string, string | undefined>;

/** One provider's env-var contract. Keys are read case-sensitively from the env bag. */
interface ProviderSpec {
  id: string;
  label: string;
  baseUrlKey: string;
  apiKeyKey: string;
  /** Fallback base URL when only the key is set (well-known endpoints). '' ⇒ base URL is required. */
  defaultBaseUrl: string;
  prefixes: string[];
  defaultModelKey: string;
  defaultModelFallback: string;
}

// The built-in provider specs. Anthropic exposes an OpenAI-compatible surface at /v1 (chat/completions),
// so it is wired through the SAME contract. `compat` is a generic OpenAI-compatible base URL (any proxy,
// vLLM, OpenRouter, a self-hosted cloud, …) — base URL is REQUIRED for it (no well-known default).
const SPECS: readonly ProviderSpec[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrlKey: 'OFFGRID_CLOUD_OPENAI_BASE_URL',
    apiKeyKey: 'OFFGRID_CLOUD_OPENAI_API_KEY',
    defaultBaseUrl: 'https://api.openai.com/v1',
    prefixes: ['openai/', 'openai:', 'gpt-', 'o1', 'o3', 'o4'],
    defaultModelKey: 'OFFGRID_CLOUD_OPENAI_MODEL',
    defaultModelFallback: 'gpt-4o-mini',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrlKey: 'OFFGRID_CLOUD_ANTHROPIC_BASE_URL',
    apiKeyKey: 'OFFGRID_CLOUD_ANTHROPIC_API_KEY',
    // Anthropic's OpenAI-compatible endpoint.
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    prefixes: ['anthropic/', 'anthropic:', 'claude-', 'claude/'],
    defaultModelKey: 'OFFGRID_CLOUD_ANTHROPIC_MODEL',
    defaultModelFallback: 'claude-3-5-haiku-latest',
  },
  {
    id: 'compat',
    label: 'OpenAI-compatible',
    baseUrlKey: 'OFFGRID_CLOUD_COMPAT_BASE_URL',
    apiKeyKey: 'OFFGRID_CLOUD_COMPAT_API_KEY',
    defaultBaseUrl: '', // required — a generic proxy has no well-known URL
    prefixes: ['compat/', 'compat:', 'cloud/', 'cloud:'],
    defaultModelKey: 'OFFGRID_CLOUD_COMPAT_MODEL',
    defaultModelFallback: '',
  },
] as const;

function trimSlash(u: string): string {
  return u.replace(/\/+$/, '');
}

/**
 * Parse the configured cloud providers from an env bag. A provider is included ONLY when it has a
 * usable API key AND a base URL (its own or a well-known default). No key ⇒ omitted entirely, so an
 * unconfigured provider can never be selected. PURE — reads the passed bag, never process.env.
 */
export function parseCloudProviders(env: CloudEnv): CloudProviderConfig[] {
  const out: CloudProviderConfig[] = [];
  for (const spec of SPECS) {
    const apiKey = (env[spec.apiKeyKey] ?? '').trim();
    if (!apiKey) continue; // no key ⇒ not configured ⇒ never eligible for cloud
    const baseUrl = trimSlash((env[spec.baseUrlKey] ?? '').trim() || spec.defaultBaseUrl);
    if (!baseUrl) continue; // generic compat provider with a key but no URL is not usable
    out.push({
      id: spec.id,
      label: spec.label,
      baseUrl,
      apiKey,
      prefixes: [spec.id, ...spec.prefixes],
      defaultModel: (env[spec.defaultModelKey] ?? '').trim() || spec.defaultModelFallback,
    });
  }
  return out;
}

/** The result of picking a provider + upstream model for a target model tag. */
export interface CloudSelection {
  provider: CloudProviderConfig;
  /** The model id to send upstream (provider-namespaced prefix stripped). */
  model: string;
}

/**
 * Strip a provider-selecting prefix from a model tag, leaving the bare upstream model id.
 * `openai/gpt-4o` → `gpt-4o`; `cloud:anthropic:claude-3` → matched by 'anthropic' → `claude-3`;
 * `gpt-4o` (bare, matched by the 'gpt-' prefix) → `gpt-4o` (unchanged). PURE.
 */
function stripPrefix(model: string, prefix: string): string {
  const lower = model.toLowerCase();
  const p = prefix.toLowerCase();
  // Namespacing prefixes (end in '/' or ':') are removed; bare model-family prefixes (e.g. 'gpt-')
  // are kept — they ARE part of the real upstream model id.
  if ((p.endsWith('/') || p.endsWith(':')) && lower.startsWith(p)) {
    return model.slice(prefix.length);
  }
  return model;
}

/**
 * Select the configured cloud provider + upstream model for a routing decision's target model.
 * Matching is by longest provider prefix first, so `cloud:openai:` beats a bare `cloud:`. Returns
 * null when NO configured provider matches — the caller MUST then degrade honestly (fall back to
 * local / record cloud-unavailable), never fabricate a cloud response. PURE.
 *
 * When the model tag names no provider at all but exactly one provider is configured, that provider
 * is used with its default model — the common "one cloud key, route `cloud` there" case.
 */
export function selectCloudProvider(
  providers: CloudProviderConfig[],
  targetModel: string | null,
): CloudSelection | null {
  if (providers.length === 0) return null;
  const model = (targetModel ?? '').trim();

  // Rank (provider, prefix) pairs by prefix length so the most specific match wins.
  const matches: { provider: CloudProviderConfig; prefix: string }[] = [];
  const lower = model.toLowerCase();
  for (const provider of providers) {
    for (const prefix of provider.prefixes) {
      if (lower.startsWith(prefix.toLowerCase()) || lower.includes(`:${prefix.toLowerCase()}:`)) {
        matches.push({ provider, prefix });
      }
    }
  }
  if (matches.length) {
    matches.sort((a, b) => b.prefix.length - a.prefix.length);
    const { provider, prefix } = matches[0];
    let upstream = stripPrefix(model, prefix);
    // Handle the `cloud:openai:gpt-4o` triple form: strip everything up to and including the last ':'.
    if (upstream.includes(':')) upstream = upstream.slice(upstream.lastIndexOf(':') + 1);
    return { provider, model: upstream.trim() || provider.defaultModel };
  }

  // No provider named in the tag. If exactly one is configured, use it with the requested model
  // (or its default). With several configured and no hint, we can't guess — return null (honest).
  if (providers.length === 1) {
    return { provider: providers[0], model: model || providers[0].defaultModel };
  }
  return null;
}

/** Public view of a provider's configuration for the console — presence only, NEVER the key. */
export interface CloudProviderStatus {
  id: string;
  label: string;
  baseUrl: string;
  configured: boolean;
  defaultModel: string;
  prefixes: string[];
}

/**
 * Report every KNOWN provider (whether or not configured) as a status row for the UI — so the
 * console can show "OpenAI: not configured" honestly rather than hiding it. Never exposes keys.
 * PURE.
 */
export function cloudProviderStatuses(env: CloudEnv): CloudProviderStatus[] {
  const configured = new Map(parseCloudProviders(env).map((p) => [p.id, p]));
  return SPECS.map((spec) => {
    const c = configured.get(spec.id);
    return {
      id: spec.id,
      label: spec.label,
      baseUrl: c?.baseUrl ?? spec.defaultBaseUrl,
      configured: Boolean(c),
      defaultModel: c?.defaultModel ?? spec.defaultModelFallback,
      prefixes: c?.prefixes ?? [spec.id, ...spec.prefixes],
    };
  });
}
