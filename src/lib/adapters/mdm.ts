import {
  type DeviceCommand,
  type DeviceCommandResult,
  deviceCommandBody,
  deviceCommandPath,
  FLEET_API,
  type FleetPolicy,
  type FleetPolicyInput,
  fleetHeaders,
  type LiveQueryResult,
  mapDeviceCommand,
  mapPolicies,
  mapPolicy,
  mapQueryReport,
  mapSoftware,
  policyBody,
  runCampaignBody,
  saveQueryBody,
  type SoftwareInventory,
} from '@/lib/fleetdm';
import { getServiceCredential, invalidateServiceCredential } from '@/lib/service-credentials';
import { chooseFleetToken } from '@/lib/service-credentials-lib';
import { listDevices } from '@/lib/store';
import type { MdmDevice, MdmPort } from './types';

// MDM / device-management backends behind the Fleet Control port. The first-party registry is the
// always-on default (the nodes enrolled in this console). FleetDM is the production swap-in — an
// osquery-based, cross-platform MDM reached over its REST API; we use the MIT-licensed Fleet Free
// tier (Fleet Premium is paid and NOT required). FleetDM falls back to the first-party registry if
// unreachable, so the swap is never a hard dependency.
//
// The network lives here (thin) — request/response *shaping* is the zero-import, unit-tested
// `src/lib/fleetdm.ts`. This keeps the SOLID split the console mandates.
const FLEET_URL = process.env.OFFGRID_FLEET_URL ?? process.env.FLEET_URL;
const FLEET_TOKEN = process.env.OFFGRID_FLEET_TOKEN ?? process.env.FLEET_TOKEN;

// Phase 4.10-B: the Fleet API token now flows through the service-token broker
// (`getServiceCredential('fleet')`). The broker's per-service plan classifies fleet as 'native-bearer',
// so it returns FleetDM's OWN API token (from `secret/fleet/api-token` in OpenBao) as a
// `{ kind:'bearer' }` — NOT a Keycloak JWT (FleetDM's REST API validates its own token, a KC JWT would
// 401). When provisioned it's preferred; until then the broker returns `kind:'none'` and we fall back
// to the legacy static `FLEET_TOKEN` UNCHANGED — byte-identical to today. Selection is the pure,
// unit-tested `chooseFleetToken`.
async function fleetToken(): Promise<string | undefined> {
  const cred = await getServiceCredential('fleet');
  return chooseFleetToken(cred, FLEET_TOKEN);
}

// Tenant-scoped (SECURITY WAVE 1): passes `orgId` through to the store so the native registry only
// ever surfaces the caller's org's devices. `undefined` ⇒ listDevices defaults to DEFAULT_ORG.
async function firstPartyDevices(orgId?: string): Promise<MdmDevice[]> {
  const rows = await listDevices(orgId);
  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    os: d.os,
    status: d.status,
    lastSeen: d.lastSeen,
    source: 'native',
  }));
}

export const nativeMdm: MdmPort = {
  meta: {
    id: 'native',
    capability: 'mdm',
    vendor: 'Off Grid AI device registry',
    license: 'first-party',
    render: 'native',
    description: 'The nodes enrolled in this console — provision, policy, audit, kill-switch (default).',
  },
  listDevices: firstPartyDevices,
  supportsFleet: false, // no osquery agent — the deep methods are FleetDM-only
  health: () => Promise.resolve(true),
};

interface FleetHost {
  id: number;
  hostname?: string;
  computer_name?: string;
  display_name?: string;
  platform?: string;
  os_version?: string;
  status?: string;
  seen_time?: string;
}

// One place to build a FleetDM URL + auth headers, with a hard timeout. Throws on non-2xx so the
// callers can uniformly fall back / surface an error. Auth comes from the broker (with legacy
// fallback); on a 401 against a BROKERED token we invalidate + re-mint + retry once (spec B3). A 401
// on the legacy static token is a real config error — surfaced, not retried.
async function fleetFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<unknown> {
  const token = await fleetToken();
  const doFetch = (t: string | undefined) =>
    fetch(`${FLEET_URL}${path}`, {
      ...init,
      headers: fleetHeaders(t, {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...((init.headers as Record<string, string>) ?? {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

  let res = await doFetch(token);
  // Only retry when the token we used came from the broker (a brokered Bearer differs from the static
  // env token). Invalidate the cache, re-mint, retry once.
  if (res.status === 401 && token && token !== FLEET_TOKEN) {
    invalidateServiceCredential('fleet');
    res = await doFetch(await fleetToken());
  }
  if (!res.ok) throw new Error(`fleet ${res.status}`);
  if (res.status === 204) return {};
  return res.json();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Issue one FleetDM MDM command against a host and normalize the response. Thin: path/body/mapping
// are the pure `fleetdm.ts` helpers; only the fetch lives here.
async function runDeviceCommand(
  command: DeviceCommand,
  hostId: number,
): Promise<DeviceCommandResult> {
  const body = deviceCommandBody(command);
  const data = await fleetFetch(deviceCommandPath(hostId, command), {
    method: 'POST',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return mapDeviceCommand(hostId, command, data);
}

export const fleetDmMdm: MdmPort = {
  meta: {
    id: 'fleetdm',
    capability: 'mdm',
    vendor: 'FleetDM (osquery)',
    license: 'MIT (Fleet Free; Premium is paid, not required)',
    render: 'embed',
    embedUrl: FLEET_URL,
    description:
      'Cross-platform osquery MDM (macOS/Windows/Linux/iOS/Android) over its REST API — inventory, live query, software/CVEs, policies. Falls back to the first-party registry if unreachable.',
  },
  supportsFleet: true,
  async listDevices(orgId?: string) {
    if (!FLEET_URL) return firstPartyDevices(orgId);
    try {
      const data = (await fleetFetch(`${FLEET_API}/hosts`, {}, 5000)) as { hosts?: FleetHost[] };
      return (data.hosts ?? []).map((h) => ({
        id: String(h.id),
        name: h.display_name || h.computer_name || h.hostname || `host-${h.id}`,
        os: [h.platform, h.os_version].filter(Boolean).join(' ') || 'unknown',
        status: h.status ?? 'unknown',
        lastSeen: h.seen_time ?? 'never',
        source: 'fleetdm',
      }));
    } catch {
      return firstPartyDevices(orgId); // never a hard dependency
    }
  },

  // osquery live query: save the query, launch a campaign against the hosts, then poll the report
  // until every targeted host reports or we run out of attempts (osquery is push-then-collect).
  async liveQuery(sql: string, hostIds: number[]): Promise<LiveQueryResult> {
    const name = `offgrid-live-${Date.now().toString(36)}`;
    const saved = (await fleetFetch(`${FLEET_API}/queries`, {
      method: 'POST',
      body: JSON.stringify(saveQueryBody(name, sql)),
    })) as { query?: { id?: number } };
    const queryId = saved.query?.id;
    if (!queryId) throw new Error('fleet: query not created');
    try {
      await fleetFetch(`${FLEET_API}/queries/${queryId}/run`, {
        method: 'POST',
        body: JSON.stringify(runCampaignBody(hostIds)),
      });
      // Poll the aggregated report; live results land within a few seconds of the agents checking in.
      let result = mapQueryReport(queryId, sql, {}, hostIds.length);
      for (let i = 0; i < 8; i++) {
        await sleep(1500);
        const report = await fleetFetch(`${FLEET_API}/queries/${queryId}/report`, {}, 5000);
        result = mapQueryReport(queryId, sql, report as object, hostIds.length);
        if (result.status === 'complete') break;
      }
      return result;
    } finally {
      // Clean up the ephemeral query object; best-effort.
      await fleetFetch(`${FLEET_API}/queries/id/${queryId}`, { method: 'DELETE' }).catch(() => {});
    }
  },

  async hostSoftware(hostId: number): Promise<SoftwareInventory> {
    const data = await fleetFetch(`${FLEET_API}/hosts/${hostId}/software`, {}, 8000);
    return mapSoftware(hostId, data);
  },

  async listPolicies(): Promise<FleetPolicy[]> {
    const data = await fleetFetch(`${FLEET_API}/global/policies`);
    return mapPolicies(data);
  },

  async createPolicy(input: FleetPolicyInput): Promise<FleetPolicy> {
    const data = (await fleetFetch(`${FLEET_API}/global/policies`, {
      method: 'POST',
      body: JSON.stringify(policyBody(input)),
    })) as { policy?: object };
    return mapPolicy(data.policy ?? {});
  },

  async updatePolicy(id: number, input: Partial<FleetPolicyInput>): Promise<FleetPolicy> {
    const data = (await fleetFetch(`${FLEET_API}/global/policies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(policyBody(input)),
    })) as { policy?: object };
    return mapPolicy(data.policy ?? {});
  },

  async deletePolicy(id: number): Promise<void> {
    // FleetDM deletes global policies by id list.
    await fleetFetch(`${FLEET_API}/global/policies/delete`, {
      method: 'POST',
      body: JSON.stringify({ ids: [id] }),
    });
  },

  // Destructive MDM commands — POST to the per-host command endpoint and normalize the echo. lock,
  // unlock and wipe carry an optional body (only wipe uses one, for a Windows wipe type); refetch is
  // a bodyless POST. Shaping (path + body + response) is the pure `src/lib/fleetdm.ts`.
  lockHost: (hostId) => runDeviceCommand('lock', hostId),
  unlockHost: (hostId) => runDeviceCommand('unlock', hostId),
  wipeHost: (hostId) => runDeviceCommand('wipe', hostId),
  refetchHost: (hostId) => runDeviceCommand('refetch', hostId),

  async health() {
    if (!FLEET_URL) return false;
    try {
      // /healthz is unauthenticated and available pre-setup; the hosts API needs setup + a token.
      const res = await fetch(`${FLEET_URL}/healthz`, { signal: AbortSignal.timeout(2500) });
      return res.ok;
    } catch {
      return false;
    }
  },
};

export const MDM_PORTS: MdmPort[] = [nativeMdm, fleetDmMdm];
