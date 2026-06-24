import { isEnabled as dbIsEnabled } from '@/lib/store';
import type { FlagsPort } from './types';

// Feature-flag backends behind the FlagsPort. The first-party store (Postgres, edited in the
// admin UI) is the always-on default; Unleash queries a central flag service so flags can be
// governed org-wide. Unleash falls back to the first-party store if it's unreachable, so the flag
// check always returns and selecting Unleash is never a hard dependency.
const UNLEASH_URL = process.env.OFFGRID_UNLEASH_URL;
const UNLEASH_TOKEN = process.env.OFFGRID_UNLEASH_TOKEN; // client/frontend API token
const UNLEASH_ENV = process.env.OFFGRID_UNLEASH_ENV ?? 'development';

export const nativeFlags: FlagsPort = {
  meta: {
    id: 'native',
    capability: 'flags',
    vendor: 'Off Grid flags',
    license: 'first-party',
    render: 'native',
    description: 'Module/capability enablement via the in-console flag store + env (default).',
  },
  isEnabled: (key, fallback = false) => dbIsEnabled(key, fallback),
  health: () => Promise.resolve(true),
};

interface UnleashFeature {
  name: string;
  enabled: boolean;
}

interface UnleashResponse {
  features?: UnleashFeature[];
}

async function unleashEnabled(key: string, fallback: boolean): Promise<boolean> {
  // Frontend (proxy) API returns only enabled toggles for the environment.
  const res = await fetch(`${UNLEASH_URL}/api/frontend/features`, {
    headers: { authorization: UNLEASH_TOKEN ?? '', 'x-environment': UNLEASH_ENV },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error('unleash unavailable');
  const data = (await res.json()) as UnleashResponse;
  const feature = data.features?.find((f) => f.name === key);
  return feature ? feature.enabled : fallback;
}

export const unleashFlags: FlagsPort = {
  meta: {
    id: 'unleash',
    capability: 'flags',
    vendor: 'Unleash',
    license: 'Apache-2.0',
    render: 'embed',
    embedUrl: UNLEASH_URL,
    description: 'Feature-flag service — the backbone of modular control at scale.',
  },
  async isEnabled(key, fallback = false) {
    if (!UNLEASH_URL) return dbIsEnabled(key, fallback);
    try {
      return await unleashEnabled(key, fallback);
    } catch {
      return dbIsEnabled(key, fallback); // fall back to the first-party store
    }
  },
  async health() {
    if (!UNLEASH_URL) return false;
    try {
      const res = await fetch(`${UNLEASH_URL}/health`, { signal: AbortSignal.timeout(2500) });
      return res.ok;
    } catch {
      return false;
    }
  },
};

export const FLAGS_PORTS: FlagsPort[] = [nativeFlags, unleashFlags];
