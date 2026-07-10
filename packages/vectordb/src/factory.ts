// @offgrid/vectordb — inspector factory
//
// Dispatches a VectorDBConfig to the right adapter.

import { lancedbInspector } from './adapters/lancedb.js';
import { qdrantInspector } from './adapters/qdrant.js';
import { unsupportedInspector } from './adapters/unsupported.js';
import type { VectorStoreInspector } from './inspector.js';
import type { VectorDBConfig } from './types.js';

/** Create an inspector for the given config. Implemented: qdrant, lancedb. */
export function createInspector(cfg: VectorDBConfig): VectorStoreInspector {
  switch (cfg.kind) {
    case 'qdrant':
      return qdrantInspector(cfg);
    case 'lancedb':
      return lancedbInspector(cfg);
    case 'chroma':
    case 'pgvector':
    case 'weaviate':
    case 'milvus':
      return unsupportedInspector(cfg);
    default: {
      // Exhaustiveness guard — if a new kind is added the compiler flags this.
      const _exhaustive: never = cfg.kind;
      return unsupportedInspector({ ...cfg, kind: _exhaustive });
    }
  }
}
