import { stateFromProbe, type HonestState } from '@/lib/honest-state';
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
  jaegerEntry,
  langfuseEntry,
  litellmEntry,
  victoriaLogsEntry,
  victoriaMetricsEntry,
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
// Default = lexical floor (heuristicGrounding): no per-run model cost, additive/safe. Opt into
// paraphrase-aware model-NLI grounding with OFFGRID_ADAPTER_GROUNDING=model (falls back to lexical
// if the gateway is unreachable). pick() returns adapters[0] when the env var is unset.
const GROUNDING: GroundingPort[] = [heuristicGrounding, modelGrounding];

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
  // Whether the active adapter has a backing service configured (its env URL is set). Lets the
  // UI tell "not configured yet" (calm) apart from "configured but down" (a real problem) —
  // both otherwise surface as healthy===false. Adapters with no remote to reach report undefined.
  configured?: boolean;
  /**
   * The canonical §11 state for this capability, decided by the one shared rule (honest-state.ts).
   * `healthy` + `configured` are kept for callers that already read them; new surfaces should render
   * this, so "not configured" cannot look like an outage on one page and like silence on another.
   */
  state?: HonestState;
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
  observability: [
    ...portEntries(OBSERVABILITY),
    langfuseEntry,
    litellmEntry,
    victoriaMetricsEntry,
    victoriaLogsEntry,
    jaegerEntry,
  ],
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
// Capabilities whose failure STOPS work rather than letting it through. Guardrails, PII and policy
// are enforcement: if they cannot run, the run is denied. Everything else (observability, analytics,
// evals) fails open — work continues, it is simply not recorded or scored, which is a different and
// less dangerous fact that the badge must not conflate.
const FAIL_CLOSED_CAPABILITIES = new Set<string>(['guardrails', 'pii', 'policy', 'secrets']);

export async function listBindings(withHealth = false): Promise<CapabilityBinding[]> {
  const caps = Object.keys(ALL) as Capability[];
  return Promise.all(
    caps.map(async (capability) => {
      const entries = ALL[capability];
      const active = pick(capability, entries);
      const healthy = withHealth && active.health ? await active.health() : undefined;
      // "Configured" means an operator has wired this capability to something — NOT that it has an
      // embeddable UI. Deriving it from `embedUrl` alone reported the flagship capability as NOT SET
      // UP while the gateway was demonstrably serving models, because inference is native and embeds
      // nothing. §11 forbids exactly that: a state that misrepresents whether a control is active.
      //
      // An adapter that answered its health probe IS configured, whatever it renders as. Only when a
      // probe fails does the embed URL (or its absence) tell us whether anyone ever wired it up.
      const configured = active.health
        ? healthy === true || Boolean(active.meta.embedUrl)
        : undefined;
      return {
        capability,
        active: active.meta,
        alternatives: entries.map((e) => e.meta).filter((m) => m.id !== active.meta.id),
        healthy,
        configured,
        // ROADMAP §11 names seven states the UI must distinguish, and this surface was rendering its
        // own ad-hoc version of three of them. One vocabulary decides it (honest-state.ts) so
        // "not configured" cannot read as an outage here and as silence somewhere else.
        //
        // FAIL MODE MATTERS: an unreachable guardrail fails CLOSED (the run is stopped), an
        // unreachable observability sink fails OPEN (work continues unrecorded). Those are opposite
        // facts and a single red badge for both is exactly what §11 forbids.
        state: stateFromProbe({
          configured,
          reachable: healthy,
          failMode: FAIL_CLOSED_CAPABILITIES.has(capability) ? 'closed' : 'open',
        }),
      };
    }),
  );
}
