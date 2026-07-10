// @offgrid/vectordb — placeholder adapter for not-yet-implemented backends.
//
// Returns a fully-typed inspector whose reads are empty and whose ping is
// false, so callers can treat "planned" backends uniformly without special-casing.

import type { VectorStoreInspector } from '../inspector.js';
import type { CollectionInfo, VectorDBConfig, VectorPoint } from '../types.js';

export function unsupportedInspector(cfg: VectorDBConfig): VectorStoreInspector {
  const note = `[vectordb] backend "${cfg.kind}" is not yet supported`;
  return {
    config: cfg,
    async ping(): Promise<boolean> {
      console.warn(note);
      return false;
    },
    async listCollections(): Promise<CollectionInfo[]> {
      return [];
    },
    async collectionInfo(): Promise<CollectionInfo | null> {
      return null;
    },
    async sample(): Promise<VectorPoint[]> {
      return [];
    },
    async count(): Promise<number> {
      return 0;
    },
  };
}
