// I/O adapter (port) for Qdrant collection + snapshot administration.
//
// The pure normalization/validation/shaping lives in `src/lib/qdrant-snapshots.ts`; this module is the
// thin shell that calls the Qdrant REST API (via `qdrant-http.ts`) and hands raw JSON to those pure
// parsers. Route handlers depend on the QdrantSnapshotsPort interface, not on fetch — so the wiring is
// swappable and the pure layer stays the thing under test.

import { qdrantFetch, qdrantFetchRaw } from '@/lib/qdrant-http';
import {
  type CollectionInfo,
  type CollectionSummary,
  type RecoverRequest,
  type SnapshotRow,
  normalizeCollectionInfo,
  normalizeCollectionNames,
  normalizeCreatedSnapshot,
  normalizeSnapshots,
  snapshotDownloadPath,
  toCollectionSummary,
} from '@/lib/qdrant-snapshots';

export interface QdrantSnapshotsPort {
  /** List collections with a best-effort status/points-count readout for each. */
  listCollections(): Promise<CollectionSummary[]>;
  getCollection(name: string): Promise<CollectionInfo>;
  listSnapshots(name: string): Promise<SnapshotRow[]>;
  createSnapshot(name: string): Promise<SnapshotRow | null>;
  deleteSnapshot(name: string, snapshot: string): Promise<void>;
  recoverSnapshot(name: string, req: RecoverRequest): Promise<void>;
  /** Raw snapshot file response, for the download proxy to stream back to the browser. */
  downloadSnapshot(name: string, snapshot: string): Promise<Response>;
  /** Relative REST path of a snapshot file (pure passthrough — no host). */
  snapshotDownloadPath(name: string, snapshot: string): string;
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

async function assertOk(res: Response, action: string): Promise<void> {
  if (res.ok) return;
  const detail = await res.text().catch(() => '');
  throw new Error(`Qdrant ${action} failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
}

// Bounded concurrency so listing a store with many collections doesn't fan out unboundedly.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export const qdrantSnapshots: QdrantSnapshotsPort = {
  async listCollections(): Promise<CollectionSummary[]> {
    const res = await qdrantFetch('/collections', 'GET');
    await assertOk(res, 'list collections');
    const names = normalizeCollectionNames(await readJson(res));
    // Enrich each name with its status/points-count. A per-collection failure degrades to an
    // unknown-status row rather than failing the whole list.
    const infos = await mapLimit(names, 5, async (name) => {
      try {
        return toCollectionSummary(await this.getCollection(name));
      } catch {
        return { name, status: 'unknown', pointsCount: null, vectorsCount: null, segmentsCount: null };
      }
    });
    return infos;
  },

  async getCollection(name: string): Promise<CollectionInfo> {
    const res = await qdrantFetch(`/collections/${encodeURIComponent(name)}`, 'GET');
    await assertOk(res, 'get collection');
    return normalizeCollectionInfo(name, await readJson(res));
  },

  async listSnapshots(name: string): Promise<SnapshotRow[]> {
    const res = await qdrantFetch(`/collections/${encodeURIComponent(name)}/snapshots`, 'GET');
    await assertOk(res, 'list snapshots');
    return normalizeSnapshots(await readJson(res));
  },

  async createSnapshot(name: string): Promise<SnapshotRow | null> {
    const res = await qdrantFetch(`/collections/${encodeURIComponent(name)}/snapshots`, 'POST');
    await assertOk(res, 'create snapshot');
    return normalizeCreatedSnapshot(await readJson(res));
  },

  async deleteSnapshot(name: string, snapshot: string): Promise<void> {
    const res = await qdrantFetch(
      `/collections/${encodeURIComponent(name)}/snapshots/${encodeURIComponent(snapshot)}`,
      'DELETE',
    );
    await assertOk(res, 'delete snapshot');
  },

  async recoverSnapshot(name: string, req: RecoverRequest): Promise<void> {
    const res = await qdrantFetch(
      `/collections/${encodeURIComponent(name)}/snapshots/recover`,
      'PUT',
      req,
    );
    await assertOk(res, 'recover snapshot');
  },

  async downloadSnapshot(name: string, snapshot: string): Promise<Response> {
    return qdrantFetchRaw(snapshotDownloadPath(name, snapshot));
  },

  snapshotDownloadPath(name: string, snapshot: string): string {
    return snapshotDownloadPath(name, snapshot);
  },
};
