// PURE sample-gateway specs for the registry seed (Gateways × Pipelines, P1). ZERO I/O — just the
// canonical set of gateways every deployment starts with, with STABLE ids so the seed is idempotent
// (INSERT … ON CONFLICT (id) DO NOTHING in the store). The seed route loops these over each org.
//
// Availability is NOT decided here — the store merges live health at read time (an unconfigured
// OpenAI/Anthropic shows as unconfigured; OpenRouter shows reachable iff its key+URL are wired). This
// file only declares identity + base URL + default model + kind; egressClass is derived from kind.
import { type GatewayKind, egressClassFor } from '@/lib/gateways-policy';

export interface SampleGatewaySpec {
  /** Stable id — the idempotency key. Suffixed per-org by the seed so ids never collide across orgs. */
  key: string;
  name: string;
  kind: GatewayKind;
  baseUrl: string;
  defaultModel: string;
}

// The sample gateways every deployment starts with — one per first-class kind (on-prem + the cloud
// providers openai/anthropic/deepseek/zhipu) plus OpenRouter as a `compat` example. baseUrl carries
// the well-known endpoint for reference; compat (OpenRouter) needs an explicit URL (no default).
export const SAMPLE_GATEWAYS: readonly SampleGatewaySpec[] = [
  {
    key: 'onprem-cluster',
    name: 'On-Prem Cluster',
    kind: 'on-prem',
    baseUrl: '', // the aggregator — reached via GATEWAY_URL, not a stored URL
    // The default model the on-prem aggregator serves. A gateway must advertise a default so the
    // hierarchy (pipeline.defaultModel ?? gateway.defaultModel) always resolves a real, local model —
    // e.g. the AI-quality judge pipeline inherits this rather than egressing to a cloud gateway.
    defaultModel: 'gemma-4-e4b',
  },
  {
    key: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  {
    key: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-haiku-latest',
  },
  {
    key: 'deepseek',
    name: 'DeepSeek',
    kind: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  {
    key: 'zhipu',
    name: 'Zhipu AI (GLM)',
    kind: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.6',
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    kind: 'compat',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: '',
  },
] as const;

/** Build the stable id for a sample gateway within an org. Deterministic ⇒ idempotent seed. */
export function sampleGatewayId(orgId: string, key: string): string {
  return `gw_seed_${orgId}_${key}`;
}

export interface SeedGatewayPlan {
  id: string;
  name: string;
  kind: GatewayKind;
  baseUrl: string;
  defaultModel: string;
  egressClass: ReturnType<typeof egressClassFor>;
  enabled: boolean;
}

/** Resolve the concrete create-inputs (with stable ids + derived egress) for one org. PURE. */
export function planSeedGateways(orgId: string): SeedGatewayPlan[] {
  return SAMPLE_GATEWAYS.map((s) => ({
    id: sampleGatewayId(orgId, s.key),
    name: s.name,
    kind: s.kind,
    baseUrl: s.baseUrl,
    defaultModel: s.defaultModel,
    egressClass: egressClassFor(s.kind),
    enabled: true,
  }));
}
