// @offgrid/vectordb — inspector interface
//
// Common contract every vector-store adapter implements. This is the surface
// a UI talks to regardless of which backend is connected.

import type { CollectionInfo, VectorDBConfig, VectorPoint } from './types.js';

export interface VectorStoreInspector {
  /** The config this inspector was created with. */
  config: VectorDBConfig;

  /** True if the store is reachable / usable. Never throws. */
  ping(): Promise<boolean>;

  /** List all collections/tables with best-effort metadata. */
  listCollections(): Promise<CollectionInfo[]>;

  /** Metadata for a single collection, or null if missing/unreachable. */
  collectionInfo(name: string): Promise<CollectionInfo | null>;

  /** Pull up to `n` sample points (with vectors + payloads when available). */
  sample(name: string, n?: number): Promise<VectorPoint[]>;

  /** Total number of points in a collection (best-effort, 0 on failure). */
  count(name: string): Promise<number>;

  /** Optional nearest-neighbour search by raw vector. */
  search?(name: string, vector: number[], k?: number): Promise<VectorPoint[]>;
}
