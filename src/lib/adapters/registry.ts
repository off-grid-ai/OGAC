import { CACHE_PORTS } from './cache';
import { DRIFT_PORTS } from './drift';
import { EVALS_PORTS } from './evals';
import { FLAGS_PORTS } from './flags';
import { heuristicGrounding, modelGrounding } from './grounding';
import { gatewayInference, localInference } from './inference';
import { LINEAGE_PORTS } from './lineage';
import { MDM_PORTS } from './mdm';
import { otelObservability, signozObservability } from './observability';
import { PII_PORTS } from './pii';
import { POLICY_PORTS } from './policy';
import { SANDBOX_PORTS } from './sandbox';
import { envSecrets, openBaoSecrets } from './secrets';
import {
  BI,
  GUARDRAIL_ENTRIES,
  IDENTITY,
  LINEAGE,
  POLICY,
  PROVENANCE,
  type RegEntry,
  RETRIEVAL_ENTRIES,
  SANDBOX,
  SIEM,
  langfuseEntry,
} from './services';
import { SIGNING_PORTS } from './signing';
import type {
  AdapterMeta,
  CachePort,
  Capability,
  DriftPort,
  EvalsPort,
  FlagsPort,
  GroundingPort,
  InferencePort,
  LineagePort,
  MdmPort,
  ObservabilityPort,
  PiiPort,
  PolicyPort,
  SandboxPort,
  SecretsPort,
  SigningPort,
} from './types';

// The adapter registry. Each capability lists its available adapters; the active one is the
// first by default, overridable per deployment via OFFGRID_ADAPTER_<CAPABILITY> (the adapter
// id). Swapping an OSS tool is one env var — no caller changes — which keeps the stack
// swappable without a fork. Note: inference is ALWAYS our one gateway (the offline adapter is
// just a no-network fallback) — the console talks to a single gateway, never a third-party LLM.
const INFERENCE: InferencePort[] = [gatewayInference, localInference];
const OBSERVABILITY: ObservabilityPort[] = [otelObservability, signozObservability];
const SECRETS: SecretsPort[] = [envSecrets, openBaoSecrets];
const GROUNDING: GroundingPort[] = [modelGrounding, heuristicGrounding];

function pick<T extends { meta: AdapterMeta }>(capability: Capability, adapters: T[]): T {
  const wanted = process.env[`OFFGRID_ADAPTER_${capability.toUpperCase()}`];
  return adapters.find((a) => a.meta.id === wanted) ?? adapters[0];
}

export function getInference(): InferencePort {
  return pick('inference', INFERENCE);
}

export function getObservability(): ObservabilityPort {
  return pick('observability', OBSERVABILITY);
}

export function getSecrets(): SecretsPort {
  return pick('secrets', SECRETS);
}

export function getGrounding(): GroundingPort {
  return pick('grounding', GROUNDING);
}

// Behavior ports for the capabilities whose OSS swap-in actually performs the work in-path (not
// just an embedded UI). Each falls back to the first-party adapter internally if its service is
// unreachable, so selecting an OSS adapter is reversible and never a hard dependency.
export function getPolicy(): PolicyPort {
  return pick('policy', POLICY_PORTS);
}

export function getPii(): PiiPort {
  return pick('guardrails', PII_PORTS);
}

export function getLineage(): LineagePort {
  return pick('lineage', LINEAGE_PORTS);
}

export function getSigning(): SigningPort {
  return pick('provenance', SIGNING_PORTS);
}

export function getEvals(): EvalsPort {
  return pick('evals', EVALS_PORTS);
}

export function getDrift(): DriftPort {
  return pick('drift', DRIFT_PORTS);
}

export function getCache(): CachePort {
  return pick('caching', CACHE_PORTS);
}

export function getFlags(): FlagsPort {
  return pick('flags', FLAGS_PORTS);
}

export function getSandbox(): SandboxPort {
  return pick('sandbox', SANDBOX_PORTS);
}

export function getMdm(): MdmPort {
  return pick('mdm', MDM_PORTS);
}

export interface CapabilityBinding {
  capability: Capability;
  active: AdapterMeta;
  alternatives: AdapterMeta[];
  healthy?: boolean;
}

// Wrap a port array (whose adapters expose health()) into registry entries.
function portEntries<T extends { meta: AdapterMeta; health?: () => Promise<boolean> }>(
  ports: T[],
): RegEntry[] {
  return ports.map((p) => ({ meta: p.meta, health: p.health ? () => p.health!() : undefined }));
}

// The full capability surface — first-party defaults first, OSS swap-ins after. Drives the
// /admin/adapters API + the Integrations surface. Each entry's optional health() pings its live
// service, so the UI shows real connection status.
const ALL: Record<Capability, RegEntry[]> = {
  inference: portEntries(INFERENCE),
  observability: [...portEntries(OBSERVABILITY), langfuseEntry],
  secrets: portEntries(SECRETS),
  grounding: portEntries(GROUNDING),
  guardrails: GUARDRAIL_ENTRIES,
  retrieval: RETRIEVAL_ENTRIES,
  policy: POLICY,
  identity: IDENTITY,
  lineage: LINEAGE,
  caching: portEntries(CACHE_PORTS),
  siem: SIEM,
  flags: portEntries(FLAGS_PORTS),
  provenance: PROVENANCE,
  bi: BI,
  sandbox: [...portEntries(SANDBOX_PORTS), ...SANDBOX],
  evals: portEntries(EVALS_PORTS),
  drift: portEntries(DRIFT_PORTS),
  mdm: portEntries(MDM_PORTS),
};

// One row per capability — active adapter + swappable alternatives + live health (when probed).
export async function listBindings(withHealth = false): Promise<CapabilityBinding[]> {
  const caps = Object.keys(ALL) as Capability[];
  return Promise.all(
    caps.map(async (capability) => {
      const entries = ALL[capability];
      const active = pick(capability, entries);
      const healthy = withHealth && active.health ? await active.health() : undefined;
      return {
        capability,
        active: active.meta,
        alternatives: entries.map((e) => e.meta).filter((m) => m.id !== active.meta.id),
        healthy,
      };
    }),
  );
}

export interface EmbedTarget {
  capability: Capability;
  id: string;
  vendor: string;
  license: string;
  embedUrl?: string;
  configured: boolean;
}

// Tier-3 embeds: adapters whose UI we don't rebuild but surface as an SSO'd iframe. An embed is
// a separate, customer-run instance (mere aggregation) — so its license never touches our core.
// `configured` is false until the deployment sets the adapter's URL env.
export function listEmbeds(): EmbedTarget[] {
  const out: EmbedTarget[] = [];
  for (const capability of Object.keys(ALL) as Capability[]) {
    for (const { meta } of ALL[capability]) {
      if (meta.render !== 'embed') continue;
      out.push({
        capability,
        id: meta.id,
        vendor: meta.vendor,
        license: meta.license,
        embedUrl: meta.embedUrl,
        configured: Boolean(meta.embedUrl),
      });
    }
  }
  return out;
}
