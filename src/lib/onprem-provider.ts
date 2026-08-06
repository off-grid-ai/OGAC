// ─── The on-prem gateway, as a PROVIDER (pure, zero-IO) ───────────────────────────────────────────
//
// The Providers page listed five CLOUD providers — OpenAI, Anthropic, DeepSeek, Zhipu and a generic
// OpenAI-compatible endpoint — and omitted the on-prem gateway entirely. On a page headed "Available
// model providers and endpoints", the only entry marked `available` was a cloud router, while the
// thing actually serving every request in the product did not appear at all.
//
// That is backwards for a product whose whole claim is that inference runs on your own hardware, and
// it is not a cosmetic omission: a buyer reading that page concludes the local models are not a
// provider, or worse, that the console is a front-end for someone else's API.
//
// The omission was structural rather than an oversight — cloud-providers.ts is explicitly a CLOUD
// registry (env-configured base URL + API key), so a local gateway with neither can never appear in
// it. Rather than bend that module, the on-prem gateway is described here from the live routing pool
// and prepended to the list.
//
// Pure: the caller fetches the pool and passes it in.

/** One entry from the aggregator's model pool. */
export interface PoolModel {
  id: string;
  gateways?: string[];
  capabilities?: string[];
}

/** The provider row shape the Providers page renders. */
export interface ProviderRow {
  id: string;
  label: string;
  baseUrl: string;
  configured: boolean;
  defaultModel: string;
  prefixes: string[];
  health: 'up' | 'down' | 'unconfigured';
  probeStatus: number;
  available: boolean;
  /** Distinguishes the local gateway from cloud egress in the UI. */
  onPrem?: boolean;
  /** Plain-language note shown under the row. */
  note?: string;
}

export const ONPREM_PROVIDER_ID = 'onprem';

/**
 * Describe the on-prem gateway as a provider row.
 *
 * `available` tracks whether the pool actually serves a model, not whether a URL is configured — the
 * same standard the cloud rows are held to. An empty pool means nothing is being served, and this
 * must say so rather than claim the local provider is fine because the process is up.
 *
 * The base URL is deliberately NOT shown as a raw loopback address: it is the same for every install
 * and tells the reader nothing. The nodes serving the models are the useful fact.
 */
export function onPremProviderRow(models: readonly PoolModel[]): ProviderRow {
  const serving = models.filter((m) => m.id);
  const nodes = [...new Set(serving.flatMap((m) => m.gateways ?? []))].sort();
  const up = serving.length > 0;

  return {
    id: ONPREM_PROVIDER_ID,
    label: 'Off Grid AI — on your hardware',
    // A location, not an endpoint: what a reader wants to know is where this runs.
    baseUrl: nodes.length ? `${nodes.length} node${nodes.length > 1 ? 's' : ''} on this network` : 'this network',
    configured: true,
    defaultModel: serving[0]?.id ?? '',
    prefixes: serving.map((m) => m.id),
    health: up ? 'up' : 'down',
    probeStatus: up ? 200 : 0,
    available: up,
    onPrem: true,
    note: up
      ? 'Requests are answered here by default. Nothing leaves your network unless a routing rule sends it to a cloud provider below.'
      : 'No model is currently being served on your hardware, so requests cannot be answered locally.',
  };
}

/**
 * The full provider list: on-prem FIRST, then cloud.
 *
 * Order is the point. The local gateway is the default path and every other row is an opt-in egress,
 * so listing it after five cloud vendors misrepresents how the product works.
 */
export function providersWithOnPrem(
  models: readonly PoolModel[],
  cloud: readonly ProviderRow[],
): ProviderRow[] {
  return [onPremProviderRow(models), ...cloud];
}
