// I/O bridge to the object store's master status. All judgement is pure, in object-topology.ts.
//
// The master URL is env-configured with a loopback default, matching how the S3 endpoint resolves — the
// store runs beside the console on the audited deployment and reaches the master through the same
// forward. There is no discovery and no probing of other hosts.

import { readTopology, type RawTopology, type TopologyView } from '@/lib/object-topology';

const MASTER = (process.env.OFFGRID_SEAWEEDFS_MASTER_URL || 'http://127.0.0.1:9333').replace(/\/$/, '');

export type TopologyOutcome =
  | { ok: true; view: TopologyView }
  | { ok: false; reason: string };

/**
 * Read the store's topology.
 *
 * THROWS NOTHING and returns no partial view: a failure is `{ ok: false }` with the reason, because a
 * zeroed TopologyView would render as a store with no nodes and no redundancy — alarming for the wrong
 * reason, and indistinguishable from a store that genuinely has none.
 */
export async function readObjectTopology(timeoutMs = 5_000): Promise<TopologyOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${MASTER}/dir/status`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, reason: `the object store's coordinator answered ${res.status}` };
    return { ok: true, view: readTopology((await res.json()) as RawTopology) };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `the object store's coordinator could not be reached (${detail.slice(0, 140)})` };
  } finally {
    clearTimeout(timer);
  }
}
