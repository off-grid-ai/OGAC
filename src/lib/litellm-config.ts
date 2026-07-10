// PURE LiteLLM config GENERATOR — ZERO I/O, ZERO network, exhaustively unit-testable (mirrors
// cloud-providers.ts / gateways-policy.ts). Turns the console's own view of the fleet — the on-prem
// node pool (the shared SSOT scripts/fleet-pool.mjs) + the configured cloud providers
// (cloud-providers.ts) — into a LiteLLM Proxy `config.yaml` OBJECT (model_list + router_settings +
// litellm_settings + general_settings).
//
// WHY this is the seam: LiteLLM Proxy is OpenAI-compatible, so it drops in behind the SAME
// GATEWAY_URL the console already points at — no routing-logic change in the console. This module is
// the single source of truth for what LiteLLM is TOLD to route to. It never fetches anything: the
// adapter (litellm.ts) reads live health back; the deploy step writes the generated object to a
// mounted config.yaml. Because it is pure it can be unit-tested against fixed pools/providers and can
// never, by construction, leak a key into a log (it only emits `os.environ/…` references for keys).
//
// DRY: the fleet pool comes from scripts/fleet-pool.mjs (also consumed by cluster-gateway.mjs); the
// cloud provider shape comes from cloud-providers.ts (CloudProviderConfig). Nothing is re-declared.
import { FLEET_POOL } from '../../scripts/fleet-pool.mjs';
import type { CloudProviderConfig } from './cloud-providers';

/** One node in the on-prem fleet pool (mirror of scripts/fleet-pool.mjs's FleetPoolNode). */
export interface FleetPoolNode {
  name: string;
  host: string;
  port: number;
  vision: boolean;
  model: string;
  /** Optional pool-membership flag; a `false` node is still listed but marked down (drained). */
  enabled?: boolean;
}

/** The shared fleet pool, re-typed for TS consumers. The `.mjs` SSOT is JSDoc-typed only. */
export const DEFAULT_FLEET_POOL: readonly FleetPoolNode[] = FLEET_POOL as readonly FleetPoolNode[];

/** A LiteLLM `model_list` entry: a public `model_name` mapped to one upstream deployment. */
export interface LiteLLMModelEntry {
  model_name: string;
  litellm_params: {
    /** LiteLLM model string. OpenAI-compatible upstreams use the `openai/<model>` prefix. */
    model: string;
    /** Upstream base URL (…/v1). */
    api_base: string;
    /**
     * API key. For cloud providers this is an `os.environ/<VAR>` reference so the real secret is
     * resolved by LiteLLM at runtime from its own env — NEVER the literal key (this module is pure
     * and its output may be written to a committed file). Fleet nodes need no key.
     */
    api_key?: string;
  };
  /** Per-deployment metadata LiteLLM surfaces on /model/info — used by the console Router view. */
  model_info: {
    id: string;
    /** 'on-prem' | 'cloud' — mirrors the console's egress class so the UI can group deployments. */
    egress: 'on-prem' | 'cloud';
    /** The logical node/provider id (g1.., openai, ..) for attribution. */
    origin: string;
    /** Whether this deployment accepts image input. */
    vision: boolean;
    /** Health-hint: a drained fleet node is listed but flagged so the UI shows it down. */
    drained?: boolean;
  };
}

/** LiteLLM `router_settings` — load-balancing + failover across the deployments. */
export interface LiteLLMRouterSettings {
  routing_strategy: string;
  num_retries: number;
  timeout: number;
  allowed_fails: number;
  cooldown_time: number;
  /** Enable per-deployment background health checks. */
  enable_pre_call_checks: boolean;
}

/** LiteLLM `litellm_settings` — the callback logging that maps into the offgrid-gateway index. */
export interface LiteLLMSettings {
  /** Success callbacks. We use a generic OTEL/custom callback that writes to OpenSearch. */
  success_callback: string[];
  failure_callback: string[];
  /** Drop unsupported params rather than 400 (keeps mixed-provider routing robust). */
  drop_params: boolean;
  /** Redact the message content in logs (privacy — the console stores metadata, not prompts). */
  turn_off_message_logging: boolean;
}

/** LiteLLM `general_settings` — master key + budget/rate-limit enforcement toggles. */
export interface LiteLLMGeneralSettings {
  master_key: string;
  /** Enforce per-key budgets + rate limits (the thing the hand-rolled aggregator lacked). */
  database_url?: string;
}

/** The full generated LiteLLM config object (serialised to config.yaml at deploy). */
export interface LiteLLMConfig {
  model_list: LiteLLMModelEntry[];
  router_settings: LiteLLMRouterSettings;
  litellm_settings: LiteLLMSettings;
  general_settings: LiteLLMGeneralSettings;
}

/** Inputs to the generator — all optional so an empty/partial deployment still yields a valid config. */
export interface LiteLLMConfigInput {
  /** The on-prem fleet nodes. Defaults to the shared SSOT pool. */
  pool?: readonly FleetPoolNode[];
  /** The configured cloud providers (from parseCloudProviders). Empty ⇒ no cloud deployments. */
  cloudProviders?: readonly CloudProviderConfig[];
  /** LiteLLM master key env-var NAME (not the value) — referenced as os.environ/<name>. */
  masterKeyEnvVar?: string;
  /** Postgres URL env-var NAME for LiteLLM's budget/key store; omitted ⇒ budgets disabled. */
  databaseUrlEnvVar?: string;
}

const DEFAULT_MASTER_KEY_VAR = 'OFFGRID_LITELLM_MASTER_KEY';

/** Fleet node → its public model_name. `onprem/<model>` namespaces the fleet from cloud. */
export function fleetModelName(node: FleetPoolNode): string {
  return `onprem/${node.model}`;
}

/** Map ONE fleet node → a LiteLLM model_list entry (OpenAI-compatible upstream, no key). PURE. */
function fleetEntry(node: FleetPoolNode): LiteLLMModelEntry {
  const drained = node.enabled === false;
  return {
    model_name: fleetModelName(node),
    litellm_params: {
      // The fleet nodes speak OpenAI /v1; LiteLLM's `openai/` prefix routes to a compatible upstream.
      model: `openai/${node.model}`,
      api_base: `http://${node.host}:${node.port}/v1`,
    },
    model_info: {
      id: node.name,
      egress: 'on-prem',
      origin: node.name,
      vision: node.vision,
      // A drained node stays in model_list (visible in the Router view) but is flagged so the UI
      // shows it as intentionally out of rotation rather than silently dropping it.
      ...(drained ? { drained: true } : {}),
    },
  };
}

/** Map ONE cloud provider → a LiteLLM model_list entry keyed by its default model. PURE. */
function cloudEntry(p: CloudProviderConfig): LiteLLMModelEntry {
  return {
    model_name: `${p.id}/${p.defaultModel}`,
    litellm_params: {
      model: `openai/${p.defaultModel}`,
      api_base: p.baseUrl,
      // Reference the env var, not the secret — this config may be written to a committed file.
      api_key: `os.environ/OFFGRID_CLOUD_${p.id.toUpperCase()}_API_KEY`,
    },
    model_info: {
      id: p.id,
      egress: 'cloud',
      origin: p.id,
      // Cloud vision capability is not known here; default false (the router doesn't gate on it).
      vision: false,
    },
  };
}

/**
 * Build the complete LiteLLM config object from the console's view of the fleet + cloud providers.
 * PURE — no I/O. An empty pool + no cloud providers yields a VALID config with an empty model_list
 * (LiteLLM starts, serves nothing — honest, never a fabricated deployment). Drained fleet nodes are
 * still listed (flagged), so the Router view shows the full topology.
 */
export function buildLiteLLMConfig(input: LiteLLMConfigInput = {}): LiteLLMConfig {
  const pool = input.pool ?? DEFAULT_FLEET_POOL;
  const cloud = input.cloudProviders ?? [];
  const masterKeyVar = input.masterKeyEnvVar ?? DEFAULT_MASTER_KEY_VAR;

  const model_list: LiteLLMModelEntry[] = [
    ...pool.map(fleetEntry),
    ...cloud.map(cloudEntry),
  ];

  return {
    model_list,
    router_settings: {
      // Least-busy routing keeps the fleet balanced; simple-shuffle is LiteLLM's other option.
      routing_strategy: 'least-busy',
      num_retries: 2,
      timeout: 600,
      allowed_fails: 3,
      cooldown_time: 30,
      enable_pre_call_checks: true,
    },
    litellm_settings: {
      // Custom callback (the OpenSearch writer) is wired by NAME in the deployed config; here we
      // declare the standard OTEL + custom hooks that emit the StandardLoggingPayload.
      success_callback: ['otel'],
      failure_callback: ['otel'],
      drop_params: true,
      // The console's traffic index stores metadata (model/tokens/latency/status), not raw prompts.
      turn_off_message_logging: true,
    },
    general_settings: {
      master_key: `os.environ/${masterKeyVar}`,
      ...(input.databaseUrlEnvVar
        ? { database_url: `os.environ/${input.databaseUrlEnvVar}` }
        : {}),
    },
  };
}

/**
 * Serialise the generated config to a YAML string for the mounted config.yaml. A tiny, dependency-
 * free emitter (the config shape is fixed + shallow) — PURE. Kept here so the deploy sample and the
 * live-generated file share ONE serializer (DRY). Not a general YAML library: it only handles the
 * scalar/array/object shapes this config uses.
 */
export function configToYaml(cfg: LiteLLMConfig): string {
  const lines: string[] = [];
  const scalar = (v: unknown): string => {
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    const s = String(v);
    // Quote strings that YAML would otherwise mis-parse (contain ':' or start with a special char).
    return /[:#]|^[\s\-?&*!|>'"%@`]/.test(s) ? JSON.stringify(s) : s;
  };

  lines.push('model_list:');
  for (const m of cfg.model_list) {
    lines.push(`  - model_name: ${scalar(m.model_name)}`);
    lines.push('    litellm_params:');
    lines.push(`      model: ${scalar(m.litellm_params.model)}`);
    lines.push(`      api_base: ${scalar(m.litellm_params.api_base)}`);
    if (m.litellm_params.api_key !== undefined) {
      lines.push(`      api_key: ${scalar(m.litellm_params.api_key)}`);
    }
    lines.push('    model_info:');
    lines.push(`      id: ${scalar(m.model_info.id)}`);
    lines.push(`      egress: ${scalar(m.model_info.egress)}`);
    lines.push(`      origin: ${scalar(m.model_info.origin)}`);
    lines.push(`      vision: ${scalar(m.model_info.vision)}`);
    if (m.model_info.drained !== undefined) {
      lines.push(`      drained: ${scalar(m.model_info.drained)}`);
    }
  }

  const block = (name: string, obj: Record<string, unknown>): void => {
    lines.push(`${name}:`);
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) {
        lines.push(`  ${k}:`);
        for (const item of v) lines.push(`    - ${scalar(item)}`);
      } else {
        lines.push(`  ${k}: ${scalar(v)}`);
      }
    }
  };

  block('router_settings', cfg.router_settings as unknown as Record<string, unknown>);
  block('litellm_settings', cfg.litellm_settings as unknown as Record<string, unknown>);
  block('general_settings', cfg.general_settings as unknown as Record<string, unknown>);

  return lines.join('\n') + '\n';
}
