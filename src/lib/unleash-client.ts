// Thin I/O adapter for the Unleash *Admin* API. All request/response *shaping* lives in the pure
// `unleash-admin.ts` (unit-tested); this file only reads env, does fetch, and composes those
// builders. It exposes a small management surface (list/get/create/update/archive, env on/off,
// variants CRUD, gradual rollout) that the flag routes call when Unleash is configured.
//
// Auth: the Admin API needs an *admin* token — read OFFGRID_UNLEASH_ADMIN_TOKEN, falling back to
// OFFGRID_UNLEASH_TOKEN. (The frontend/client token used for evaluation cannot write.)

import {
  buildCreateFeaturePayload,
  buildRolloutStrategy,
  buildVariantsPayload,
  DEFAULT_PROJECT,
  envStrategiesPath,
  envTogglePath,
  envVariantsPath,
  featurePath,
  featuresPath,
  findRolloutStrategyId,
  strategyPath,
  toFlagDetail,
  toFlagList,
  type FlagDetail,
  type UnleashFeatureDetail,
  type UnleashFeatureListItem,
  type VariantInput,
  type VariantPayload,
} from '@/lib/unleash-admin';

const UNLEASH_URL = process.env.OFFGRID_UNLEASH_URL;
const ADMIN_TOKEN = process.env.OFFGRID_UNLEASH_ADMIN_TOKEN ?? process.env.OFFGRID_UNLEASH_TOKEN;
const PROJECT = process.env.OFFGRID_UNLEASH_PROJECT ?? DEFAULT_PROJECT;
const ENV = process.env.OFFGRID_UNLEASH_ENV ?? 'development';

// Unleash is *usable for management* only when both a base URL and an admin token are present.
// Callers gate on this to decide whether to drive Unleash or fall back to the first-party DB.
export function unleashManageable(): boolean {
  return Boolean(UNLEASH_URL && ADMIN_TOKEN);
}

export function unleashEnv(): string {
  return ENV;
}

class UnleashError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'UnleashError';
  }
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  if (!UNLEASH_URL || !ADMIN_TOKEN) throw new UnleashError(503, 'unleash admin not configured');
  const res = await fetch(`${UNLEASH_URL}${path}`, {
    ...init,
    headers: {
      authorization: ADMIN_TOKEN,
      'content-type': 'application/json',
      accept: 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new UnleashError(res.status, `unleash ${init.method ?? 'GET'} ${path} → ${res.status} ${body.slice(0, 200)}`);
  }
  return res;
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// ─── Read ────────────────────────────────────────────────────────────────────
export async function listUnleashFlags(): Promise<
  Array<{ key: string; enabled: boolean; description: string }>
> {
  const res = await api(featuresPath(PROJECT));
  const data = await json<{ features?: UnleashFeatureListItem[] }>(res);
  return toFlagList(data.features ?? [], ENV);
}

export async function getUnleashFlag(name: string): Promise<FlagDetail | null> {
  const res = await api(featurePath(PROJECT, name));
  if (res.status === 404) return null;
  const feature = await json<UnleashFeatureDetail>(res);
  return toFlagDetail(feature, ENV);
}

// ─── Create / update / archive ─────────────────────────────────────────────
// Create the toggle then set its enabled state for the current environment. Unleash creates toggles
// disabled-per-env by default, so we flip the env on/off to match the caller's intent.
export async function createUnleashFlag(
  name: string,
  enabled: boolean,
  description = '',
): Promise<void> {
  await api(featuresPath(PROJECT), {
    method: 'POST',
    body: JSON.stringify(buildCreateFeaturePayload(name, description)),
  });
  await setUnleashEnabled(name, enabled);
}

export async function updateUnleashDescription(name: string, description: string): Promise<void> {
  await api(featurePath(PROJECT, name), {
    method: 'PUT',
    body: JSON.stringify({ description }),
  });
}

// Enable/disable the toggle in the current environment.
export async function setUnleashEnabled(name: string, enabled: boolean): Promise<void> {
  await api(envTogglePath(PROJECT, name, ENV, enabled), { method: 'POST' });
}

// Archive (soft-delete) the toggle. DELETE on the feature archives it in Unleash.
export async function archiveUnleashFlag(name: string): Promise<boolean> {
  const res = await api(featurePath(PROJECT, name), { method: 'DELETE' });
  return res.status !== 404;
}

// ─── Variants ─────────────────────────────────────────────────────────────
export async function setUnleashVariants(name: string, variants: VariantInput[]): Promise<VariantPayload[]> {
  const payload = buildVariantsPayload(variants);
  await api(envVariantsPath(PROJECT, name, ENV), {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return payload;
}

// ─── Gradual rollout (flexibleRollout) ───────────────────────────────────────
// Set the rollout percentage. If a flexibleRollout strategy already exists in the env we PUT-update
// it in place (preserving its groupId); otherwise we POST a fresh one seeded with the flag name.
export async function setUnleashRollout(name: string, percent: number): Promise<number> {
  const existing = await getFeatureRaw(name);
  const environment = existing?.environments?.find((e) => e.name === ENV);
  const existingId = findRolloutStrategyId(environment?.strategies);
  const existingGroupId = environment?.strategies?.find((s) => s.name === 'flexibleRollout')?.parameters
    ?.groupId;

  const body = buildRolloutStrategy(percent, { groupId: existingGroupId || name });

  if (existingId) {
    await api(strategyPath(PROJECT, name, ENV, existingId), {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  } else {
    await api(envStrategiesPath(PROJECT, name, ENV), {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  return Number(body.parameters.rollout);
}

async function getFeatureRaw(name: string): Promise<UnleashFeatureDetail | null> {
  const res = await api(featurePath(PROJECT, name));
  if (res.status === 404) return null;
  return json<UnleashFeatureDetail>(res);
}

export { UnleashError };
