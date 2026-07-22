// PURE logic for the LiteLLM provider-pool management surface (routing → models). Validate an
// add-deployment request into a /model/new body, and shape /model/info into display rows. Zero I/O so
// it's unit-testable; the network writes live in litellm.ts (addModelDeployment/deleteModelDeployment).
// The pool = the set of model deployments LiteLLM routes across (fleet on-prem + cloud). Config-file
// models are the base (not removable here); DB-managed ones (added via /model/new) are removable.

export interface ProviderPoolInput {
  modelName?: unknown; // the routing alias operators call, e.g. "cloud/gpt-4o-mini"
  provider?: unknown; // "openai" | "anthropic" | "openai-compatible" | "onprem" | ...
  model?: unknown; // the upstream model id, e.g. "gpt-4o-mini"
  apiBase?: unknown; // required for compatible/on-prem providers
  apiKey?: unknown; // required for cloud providers
}

export interface ProviderPoolRow {
  id: string;
  modelName: string;
  upstreamModel: string;
  apiBase: string | null;
  dbManaged: boolean; // true = added via /model/new (removable); false = config-file base
}

// Cloud providers authenticate with an API key; these route through a hosted endpoint.
const CLOUD_PROVIDERS = new Set(['openai', 'anthropic', 'azure', 'bedrock', 'vertex_ai', 'gemini']);
// Providers that reach a self-hosted OpenAI-compatible endpoint need a base URL, not necessarily a key.
const BASE_REQUIRED = new Set(['openai-compatible', 'onprem', 'hosted_vllm', 'ollama']);

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// Validate the input and build the LiteLLM /model/new body. Returns a typed error the route surfaces
// as a 400 — never a partial/ambiguous body.
export function buildAddModelBody(
  raw: ProviderPoolInput,
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const modelName = str(raw.modelName);
  const provider = str(raw.provider).toLowerCase();
  const model = str(raw.model);
  const apiBase = str(raw.apiBase);
  const apiKey = str(raw.apiKey);

  if (!modelName) return { ok: false, error: 'a routing name (model_name) is required' };
  if (!provider) return { ok: false, error: 'a provider is required' };
  if (!model) return { ok: false, error: 'an upstream model id is required' };
  if (CLOUD_PROVIDERS.has(provider) && !apiKey) {
    return { ok: false, error: `provider "${provider}" needs an API key` };
  }
  if (BASE_REQUIRED.has(provider) && !apiBase) {
    return { ok: false, error: `provider "${provider}" needs a base URL` };
  }

  const params: Record<string, unknown> = { model: `${provider}/${model}` };
  if (apiBase) params.api_base = apiBase;
  if (apiKey) params.api_key = apiKey;
  return { ok: true, body: { model_name: modelName, litellm_params: params } };
}

interface RawModelInfoItem {
  model_name?: unknown;
  litellm_params?: { model?: unknown; api_base?: unknown } | null;
  model_info?: { id?: unknown; db_model?: unknown } | null;
}

// Shape a /model/info response ({data:[...]}) into display rows. Never throws on a malformed shape.
export function shapeProviderPool(raw: unknown): ProviderPoolRow[] {
  const data = (raw as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data.map((d) => {
    const item = (d ?? {}) as RawModelInfoItem;
    const lp = item.litellm_params ?? {};
    const mi = item.model_info ?? {};
    return {
      id: str(mi.id),
      modelName: str(item.model_name),
      upstreamModel: str(lp.model),
      apiBase: str(lp.api_base) || null,
      dbManaged: mi.db_model === true,
    };
  });
}

// The rows an operator can REMOVE (only DB-managed deployments; config-file base models are fixed here).
export function removablePool(rows: ProviderPoolRow[]): ProviderPoolRow[] {
  return rows.filter((r) => r.dbManaged && r.id);
}
