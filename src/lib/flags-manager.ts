// Flag *management* facade: routes call this, not Unleash or the store directly. When Unleash is
// configured for management (URL + admin token) the console drives Unleash; otherwise — and if a
// live Unleash call fails — it falls back to the first-party Postgres store. This keeps the
// first-party DB path as a real fallback while making Unleash the source of truth when present.
//
// Flag *evaluation* (isEnabled / OFFGRID_FLAGS_OPEN) is unchanged and still lives in
// `src/lib/adapters/flags.ts` + `src/lib/store.ts` — this facade is only the write/read management
// surface behind the admin routes.

import { deleteFlag, listFlags, setFlag } from '@/lib/store';
import type { FlagDetail, VariantInput, VariantPayload } from '@/lib/unleash-admin';
import {
  archiveUnleashFlag,
  createUnleashFlag,
  getUnleashFlag,
  listUnleashFlags,
  setUnleashEnabled,
  setUnleashRollout,
  setUnleashVariants,
  unleashEnv,
  unleashManageable,
  updateUnleashDescription,
} from '@/lib/unleash-client';

export type FlagBackend = 'unleash' | 'native';

// Which backend the management surface is driving right now.
export function flagBackend(): FlagBackend {
  return unleashManageable() ? 'unleash' : 'native';
}

export interface FlagListResult {
  backend: FlagBackend;
  environment: string | null;
  data: Array<{ key: string; enabled: boolean; description: string }>;
}

export async function managedListFlags(): Promise<FlagListResult> {
  if (unleashManageable()) {
    try {
      return { backend: 'unleash', environment: unleashEnv(), data: await listUnleashFlags() };
    } catch {
      // fall through to first-party
    }
  }
  return { backend: 'native', environment: null, data: await listFlags() };
}

export async function managedGetFlag(key: string): Promise<FlagDetail | null> {
  if (unleashManageable()) {
    try {
      return await getUnleashFlag(key);
    } catch {
      // fall through
    }
  }
  const row = (await listFlags()).find((f) => f.key === key);
  if (!row) return null;
  return {
    key: row.key,
    enabled: row.enabled,
    description: row.description,
    variants: [],
    rolloutPercent: null,
    source: 'native',
  };
}

export async function managedCreateFlag(
  key: string,
  enabled: boolean,
  description: string,
): Promise<FlagBackend> {
  if (unleashManageable()) {
    try {
      await createUnleashFlag(key, enabled, description);
      return 'unleash';
    } catch {
      // fall through — record it locally so the flag still exists
    }
  }
  await setFlag(key, enabled, description);
  return 'native';
}

export async function managedSetEnabled(key: string, enabled: boolean): Promise<FlagBackend> {
  if (unleashManageable()) {
    try {
      await setUnleashEnabled(key, enabled);
      return 'unleash';
    } catch {
      // fall through
    }
  }
  await setFlag(key, enabled);
  return 'native';
}

export async function managedSetDescription(key: string, description: string): Promise<FlagBackend> {
  if (unleashManageable()) {
    try {
      await updateUnleashDescription(key, description);
      return 'unleash';
    } catch {
      // fall through
    }
  }
  // Preserve the current enabled state — a description edit must not flip the toggle.
  const current = (await listFlags()).find((f) => f.key === key);
  await setFlag(key, current?.enabled ?? true, description);
  return 'native';
}

export async function managedDeleteFlag(key: string): Promise<boolean> {
  if (unleashManageable()) {
    try {
      return await archiveUnleashFlag(key);
    } catch {
      // fall through
    }
  }
  return deleteFlag(key);
}

// ─── Variants + rollout — Unleash-only capabilities ──────────────────────────
// The first-party store has no notion of variants or gradual rollout, so these require a
// reachable Unleash. They throw when Unleash is unavailable; the route maps that to a 409.
export class UnleashRequiredError extends Error {
  constructor(message = 'variants and gradual rollout require a configured, reachable Unleash') {
    super(message);
    this.name = 'UnleashRequiredError';
  }
}

export async function managedSetVariants(
  key: string,
  variants: VariantInput[],
): Promise<VariantPayload[]> {
  if (!unleashManageable()) throw new UnleashRequiredError();
  return setUnleashVariants(key, variants);
}

export async function managedSetRollout(key: string, percent: number): Promise<number> {
  if (!unleashManageable()) throw new UnleashRequiredError();
  return setUnleashRollout(key, percent);
}
