// ─── What the object store's own topology means for the data in it — PURE, zero-IO ───────────────
//
// The store reports its shape: data centres, racks, nodes, volume counts, and a replication code per
// collection. The capability gap here was that the console only PROBED the endpoint — it could say the
// store was up, which is the least interesting thing about it.
//
// The question an operator actually has is not "is it up" but "if a disk dies, what do I lose?" On the
// audited deployment the answer is everything on that disk: the replication code is `000`, meaning one
// copy. A surface that renders that as a green tick is worse than no surface, because the operator then
// believes something untrue about a private, on-premises product whose whole promise is that the data
// lives on their own hardware.
//
// So this module turns the raw report into that answer, in those words.

/** The subset of the master's status report this module reads. */
export interface RawTopology {
  Topology?: {
    Max?: number;
    Free?: number;
    DataCenters?: Array<{
      Id?: string;
      Racks?: Array<{
        Id?: string;
        DataNodes?: Array<{ Url?: string; Volumes?: number; Max?: number; EcShards?: number }>;
      }>;
    }>;
    Layouts?: Array<{ replication?: string; collection?: string; diskType?: string }>;
  };
  Version?: string;
}

export interface NodeView {
  url: string;
  volumes: number;
  max: number;
  /** Erasure-coded shards, which ARE redundancy even when the replication code says none. */
  ecShards: number;
}

/**
 * How many copies of each file exist.
 *
 * SeaweedFS encodes replication as three digits — copies on other data centres, other racks, and other
 * nodes in the same rack. `000` is one copy in one place. Parsed rather than pattern-matched against a
 * list of known codes, so an unfamiliar code is read correctly instead of being reported as safe.
 */
export interface ReplicationView {
  code: string;
  /** Total copies of each file, including the original. 1 means no redundancy at all. */
  copies: number;
  otherDataCentres: number;
  otherRacks: number;
  sameRack: number;
}

export function parseReplication(code: string): ReplicationView | null {
  const trimmed = (code ?? '').trim();
  if (!/^\d{3}$/.test(trimmed)) return null;
  const [dc, rack, same] = trimmed.split('').map(Number);
  return {
    code: trimmed,
    copies: 1 + dc + rack + same,
    otherDataCentres: dc,
    otherRacks: rack,
    sameRack: same,
  };
}

export type DurabilityRisk = 'no-redundancy' | 'same-rack-only' | 'across-racks' | 'across-sites' | 'unknown';

export interface TopologyView {
  version: string;
  dataCentres: number;
  racks: number;
  nodes: NodeView[];
  volumesUsed: number;
  volumesMax: number;
  /** Remaining volume slots. Running out stops WRITES, which is a different outage to being down. */
  volumesFree: number;
  /** Worst replication across collections — the weakest guarantee is the one that matters. */
  replication: ReplicationView | null;
  risk: DurabilityRisk;
  /** True when erasure coding is present, which is redundancy the replication code does not show. */
  erasureCoded: boolean;
}

export function readTopology(raw: RawTopology): TopologyView {
  const t = raw.Topology ?? {};
  const dcs = t.DataCenters ?? [];
  const racks = dcs.flatMap((d) => d.Racks ?? []);
  const nodes: NodeView[] = racks.flatMap((r) =>
    (r.DataNodes ?? []).map((n) => ({
      url: n.Url ?? 'unknown',
      volumes: n.Volumes ?? 0,
      max: n.Max ?? 0,
      ecShards: n.EcShards ?? 0,
    })),
  );

  // The WEAKEST replication across collections governs the answer. Reporting the best one would let a
  // single unreplicated collection hide behind a replicated neighbour.
  const parsed = (t.Layouts ?? [])
    .map((l) => parseReplication(l.replication ?? ''))
    .filter((r): r is ReplicationView => r !== null);
  const replication = parsed.length
    ? parsed.reduce((a, b) => (a.copies <= b.copies ? a : b))
    : null;

  const erasureCoded = nodes.some((n) => n.ecShards > 0);
  const volumesMax = t.Max ?? nodes.reduce((n, x) => n + x.max, 0);
  const volumesUsed = nodes.reduce((n, x) => n + x.volumes, 0);

  return {
    version: raw.Version ?? 'unknown',
    dataCentres: dcs.length,
    racks: racks.length,
    nodes,
    volumesUsed,
    volumesMax,
    volumesFree: t.Free ?? Math.max(0, volumesMax - volumesUsed),
    replication,
    risk: riskOf(replication, erasureCoded),
    erasureCoded,
  };
}

function riskOf(r: ReplicationView | null, erasureCoded: boolean): DurabilityRisk {
  if (!r) return 'unknown';
  // Erasure coding survives a disk loss even at one replica, so it is not "no redundancy".
  if (r.copies <= 1) return erasureCoded ? 'same-rack-only' : 'no-redundancy';
  if (r.otherDataCentres > 0) return 'across-sites';
  if (r.otherRacks > 0) return 'across-racks';
  return 'same-rack-only';
}

/**
 * The durability answer, in the words of the question being asked.
 *
 * `unknown` is stated as unknown. A store whose replication we could not read is not a store we can
 * call safe, and the honest sentence is the one that says we do not know.
 */
export function describeDurability(view: TopologyView): string {
  switch (view.risk) {
    case 'no-redundancy':
      return 'There is ONE copy of every file. If the disk holding a file fails, that file is gone — nothing else has it.';
    case 'same-rack-only':
      return view.erasureCoded
        ? 'Files are split across this machine with recovery data, so a single disk failure can be repaired — but losing the machine loses them.'
        : `Every file is kept ${view.replication?.copies}× on the same rack. A disk failure is survivable; losing the rack is not.`;
    case 'across-racks':
      return `Every file is kept ${view.replication?.copies}× across different racks, so losing one rack does not lose data.`;
    case 'across-sites':
      return `Every file is kept ${view.replication?.copies}× across different sites, so losing a whole site does not lose data.`;
    case 'unknown':
      return 'How many copies of each file exist could not be read, so durability here is UNKNOWN — not confirmed safe.';
  }
}

/**
 * Capacity, as the thing it actually causes: running out of volume slots stops WRITES while every
 * health check still says the store is up. That is a different outage from being down, and it is the
 * one nobody expects.
 */
export function describeCapacity(view: TopologyView): string {
  if (view.volumesMax <= 0) return 'How much room is left could not be read.';
  const pct = Math.round((view.volumesUsed / view.volumesMax) * 100);
  const head = `${view.volumesUsed} of ${view.volumesMax} storage slots in use (${pct}%).`;
  if (view.volumesFree === 0) return `${head} There is no room left — new files will be REFUSED even though the store is running.`;
  if (pct >= 90) return `${head} Nearly full: when the last slot goes, new files are refused while everything still reports healthy.`;
  return head;
}

/** Should this be surfaced as something to act on? Capacity and durability, not liveness. */
export function topologyNeedsAttention(view: TopologyView): boolean {
  if (view.risk === 'no-redundancy' || view.risk === 'unknown') return true;
  if (view.volumesMax > 0 && view.volumesUsed / view.volumesMax >= 0.9) return true;
  return false;
}
