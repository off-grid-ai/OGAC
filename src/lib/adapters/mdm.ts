import { listDevices } from '@/lib/store';
import type { MdmDevice, MdmPort } from './types';

// MDM / device-management backends behind the Fleet Control port. The first-party registry is the
// always-on default (the nodes enrolled in this console). FleetDM is the production swap-in — an
// osquery-based, cross-platform MDM reached over its REST API; we use the MIT-licensed Fleet Free
// tier (Fleet Premium is paid and NOT required). FleetDM falls back to the first-party registry if
// unreachable, so the swap is never a hard dependency.
const FLEET_URL = process.env.OFFGRID_FLEET_URL;
const FLEET_TOKEN = process.env.OFFGRID_FLEET_TOKEN;

async function firstPartyDevices(): Promise<MdmDevice[]> {
  const rows = await listDevices();
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
    vendor: 'Off Grid device registry',
    license: 'first-party',
    render: 'native',
    description: 'The nodes enrolled in this console — provision, policy, audit, kill-switch (default).',
  },
  listDevices: firstPartyDevices,
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

export const fleetDmMdm: MdmPort = {
  meta: {
    id: 'fleetdm',
    capability: 'mdm',
    vendor: 'FleetDM (osquery)',
    license: 'MIT (Fleet Free; Premium is paid, not required)',
    render: 'embed',
    embedUrl: FLEET_URL,
    description:
      'Cross-platform osquery MDM (macOS/Windows/Linux/iOS/Android) over its REST API — inventory, policies, GitOps. Falls back to the first-party registry if unreachable.',
  },
  async listDevices() {
    if (!FLEET_URL) return firstPartyDevices();
    try {
      const res = await fetch(`${FLEET_URL}/api/v1/fleet/hosts`, {
        headers: FLEET_TOKEN ? { authorization: `Bearer ${FLEET_TOKEN}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`fleet ${res.status}`);
      const data = (await res.json()) as { hosts?: FleetHost[] };
      return (data.hosts ?? []).map((h) => ({
        id: String(h.id),
        name: h.display_name || h.computer_name || h.hostname || `host-${h.id}`,
        os: [h.platform, h.os_version].filter(Boolean).join(' ') || 'unknown',
        status: h.status ?? 'unknown',
        lastSeen: h.seen_time ?? 'never',
        source: 'fleetdm',
      }));
    } catch {
      return firstPartyDevices(); // never a hard dependency
    }
  },
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
