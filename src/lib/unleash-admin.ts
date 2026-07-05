// PURE Unleash Admin API request/response shaping — no I/O, no fetch, no env reads. Everything here
// is a synchronous data transform so it's exhaustively unit-testable. The thin I/O adapter
// (`unleash-client.ts`) composes these into real HTTP calls; routes stay dumb.
//
// Unleash Admin API surface we drive (project defaults to `default`):
//   POST   /api/admin/projects/{project}/features                         create toggle
//   PUT    /api/admin/projects/{project}/features/{name}                  update toggle (description)
//   DELETE /api/admin/projects/{project}/features/{name}                  archive toggle
//   POST   /api/admin/projects/{project}/features/{name}/environments/{env}/on|off   enable/disable
//   PUT    /api/admin/projects/{project}/features/{name}/environments/{env}/variants variants
//   POST   /api/admin/projects/{project}/features/{name}/environments/{env}/strategies add strategy
//
// Docs: https://docs.getunleash.io/reference/api/unleash

export const DEFAULT_PROJECT = 'default';

// ─── Variants ───────────────────────────────────────────────────────────────
// A variant splits a toggle's ON traffic into named buckets by weight. `weightType: 'fix'` pins an
// absolute weight; the (default) 'variable' buckets share the remainder. Weights are integers on a
// 0–1000 scale (so 500 = 50%).
export interface VariantPayload {
  name: string;
  weight: number;
  weightType?: 'variable' | 'fix';
  stickiness?: string;
  payload?: { type: 'string' | 'json' | 'csv' | 'number'; value: string };
}

export interface VariantInput {
  name: string;
  weight?: number; // omit → auto-balanced across variable variants
  weightType?: 'variable' | 'fix';
  stickiness?: string;
  payload?: { type: 'string' | 'json' | 'csv' | 'number'; value: string };
}

const VARIANT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

// Build the Unleash variants array. Unleash requires the sum of `variable`-type weights to total
// exactly 1000; if the caller leaves weights off (or they don't sum to 1000) we auto-balance the
// variable ones evenly, distributing the rounding remainder to the first buckets. Explicit `fix`
// weights are honored verbatim and excluded from the auto-balance pool.
export function buildVariantsPayload(variants: VariantInput[]): VariantPayload[] {
  if (variants.length === 0) return [];
  for (const v of variants) {
    if (!VARIANT_NAME_RE.test(v.name)) {
      throw new Error(`invalid variant name: ${JSON.stringify(v.name)}`);
    }
  }

  const out: VariantPayload[] = variants.map((v) => ({
    name: v.name,
    weight: 0,
    weightType: v.weightType ?? 'variable',
    stickiness: v.stickiness ?? 'default',
    ...(v.payload ? { payload: v.payload } : {}),
  }));

  const fixedTotal = variants.reduce(
    (sum, v) => (v.weightType === 'fix' ? sum + clampWeight(v.weight ?? 0) : sum),
    0,
  );
  // Fix weights already exceed the budget → nothing left to distribute; honor them and zero the rest.
  const variablePool = Math.max(0, 1000 - fixedTotal);
  const variableIdx = out.map((v, i) => (v.weightType === 'fix' ? -1 : i)).filter((i) => i >= 0);

  out.forEach((v, i) => {
    if (variants[i].weightType === 'fix') v.weight = clampWeight(variants[i].weight ?? 0);
  });

  if (variableIdx.length > 0) {
    const base = Math.floor(variablePool / variableIdx.length);
    let remainder = variablePool - base * variableIdx.length;
    for (const i of variableIdx) {
      out[i].weight = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
    }
  }
  return out;
}

function clampWeight(w: number): number {
  if (!Number.isFinite(w)) return 0;
  return Math.max(0, Math.min(1000, Math.round(w)));
}

// ─── Gradual rollout (flexibleRollout strategy) ──────────────────────────────
export interface FlexibleRolloutStrategy {
  name: 'flexibleRollout';
  parameters: { rollout: string; stickiness: string; groupId: string };
}

// A flexibleRollout gradually exposes a percentage of traffic. `percent` is clamped to 0–100.
// `groupId` seeds the hash so the same users stay bucketed as the percentage grows (defaults to the
// flag name). Returns the strategy body the Admin API expects.
export function buildRolloutStrategy(
  percent: number,
  opts: { groupId?: string; stickiness?: string } = {},
): FlexibleRolloutStrategy {
  const rollout = String(
    Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0))),
  );
  return {
    name: 'flexibleRollout',
    parameters: {
      rollout,
      stickiness: opts.stickiness ?? 'default',
      groupId: opts.groupId ?? '',
    },
  };
}

// Pull the current rollout percentage out of a feature's environment strategies (first
// flexibleRollout wins). Returns null when there's no gradual-rollout strategy set.
export function readRolloutPercent(strategies: UnleashStrategy[] | undefined): number | null {
  const s = strategies?.find((x) => x.name === 'flexibleRollout');
  if (!s) return null;
  const raw = s.parameters?.rollout;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Find the id of the first flexibleRollout strategy in an environment (for PUT-vs-POST decisions).
export function findRolloutStrategyId(strategies: UnleashStrategy[] | undefined): string | null {
  const s = strategies?.find((x) => x.name === 'flexibleRollout');
  return s?.id ?? null;
}

// ─── Feature create/update payloads ──────────────────────────────────────────
export interface CreateFeaturePayload {
  name: string;
  description: string;
  type: string;
  impressionData: boolean;
}

export function buildCreateFeaturePayload(
  name: string,
  description = '',
  type = 'release',
): CreateFeaturePayload {
  return { name, description, type, impressionData: false };
}

// ─── Admin API response → console FlagDetail shaping ─────────────────────────
export interface UnleashStrategy {
  id?: string;
  name: string;
  parameters?: Record<string, string>;
}

export interface UnleashEnvironment {
  name: string;
  enabled: boolean;
  strategies?: UnleashStrategy[];
  variants?: VariantPayload[];
}

export interface UnleashFeatureDetail {
  name: string;
  description?: string;
  type?: string;
  archived?: boolean;
  project?: string;
  variants?: VariantPayload[];
  environments?: UnleashEnvironment[];
}

// The console's normalized view of a flag, blending the toggle + the *selected environment's*
// enabled state, variants, and rollout. This is what routes return and the UI renders.
export interface FlagDetail {
  key: string;
  enabled: boolean;
  description: string;
  variants: VariantPayload[];
  rolloutPercent: number | null;
  source: 'unleash' | 'native';
}

// Shape a single Unleash feature (from GET .../features/{name}) into a FlagDetail for the given env.
export function toFlagDetail(feature: UnleashFeatureDetail, env: string): FlagDetail {
  const environment = feature.environments?.find((e) => e.name === env);
  return {
    key: feature.name,
    enabled: environment?.enabled ?? false,
    description: feature.description ?? '',
    // Env-scoped variants take precedence (Unleash ≥4.19); fall back to feature-level variants.
    variants: environment?.variants ?? feature.variants ?? [],
    rolloutPercent: readRolloutPercent(environment?.strategies),
    source: 'unleash',
  };
}

export interface UnleashFeatureListItem {
  name: string;
  description?: string;
  environments?: UnleashEnvironment[];
}

// Shape the project features list (GET .../features → { features: [...] }) into the console's flat
// flag list for a given environment.
export function toFlagList(
  features: UnleashFeatureListItem[],
  env: string,
): Array<{ key: string; enabled: boolean; description: string }> {
  return features
    .map((f) => ({
      key: f.name,
      enabled: f.environments?.find((e) => e.name === env)?.enabled ?? false,
      description: f.description ?? '',
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// ─── URL builders (pure string assembly) ─────────────────────────────────────
export function featuresPath(project: string): string {
  return `/api/admin/projects/${encodeURIComponent(project)}/features`;
}
export function featurePath(project: string, name: string): string {
  return `${featuresPath(project)}/${encodeURIComponent(name)}`;
}
export function envTogglePath(project: string, name: string, env: string, on: boolean): string {
  return `${featurePath(project, name)}/environments/${encodeURIComponent(env)}/${on ? 'on' : 'off'}`;
}
export function envVariantsPath(project: string, name: string, env: string): string {
  return `${featurePath(project, name)}/environments/${encodeURIComponent(env)}/variants`;
}
export function envStrategiesPath(project: string, name: string, env: string): string {
  return `${featurePath(project, name)}/environments/${encodeURIComponent(env)}/strategies`;
}
export function strategyPath(
  project: string,
  name: string,
  env: string,
  strategyId: string,
): string {
  return `${envStrategiesPath(project, name, env)}/${encodeURIComponent(strategyId)}`;
}
