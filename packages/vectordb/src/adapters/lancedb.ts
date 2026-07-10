// @offgrid/vectordb — LanceDB adapter
//
// LanceDB is embedded (not a REST service), so this adapter dynamically imports
// the optional peer dependency `@lancedb/lancedb`. If the dep is not installed
// the inspector degrades gracefully: ping() is false and every read returns
// empty. Nothing here hard-imports the module, so the build/typecheck stays
// green without it present.

import type { VectorStoreInspector } from '../inspector.js';
import type { CollectionInfo, VectorDBConfig, VectorPoint } from '../types.js';

/**
 * Minimal structural view of the parts of `@lancedb/lancedb` we use. We keep
 * this local (rather than importing its types) so the package typechecks
 * whether or not the optional dep is installed.
 */
interface LanceTableLike {
  countRows(): Promise<number>;
  query(): {
    limit(n: number): { toArray(): Promise<Record<string, unknown>[]> };
  };
}
interface LanceConnectionLike {
  tableNames(): Promise<string[]>;
  openTable(name: string): Promise<LanceTableLike>;
}
interface LanceModuleLike {
  connect(uri: string): Promise<LanceConnectionLike>;
}

/** Attempt to load the optional dependency. Returns null when unavailable. */
async function loadLance(): Promise<LanceModuleLike | null> {
  try {
    // Indirection via a variable specifier keeps bundlers from trying to
    // resolve the optional dep at build time.
    const specifier = '@lancedb/lancedb';
    const mod = (await import(/* @vite-ignore */ specifier)) as unknown;
    return mod as LanceModuleLike;
  } catch {
    return null;
  }
}

/** Open a connection to the configured LanceDB path/URI, or null on failure. */
async function connect(cfg: VectorDBConfig): Promise<LanceConnectionLike | null> {
  const lance = await loadLance();
  if (!lance) return null;
  try {
    return await lance.connect(cfg.url);
  } catch {
    return null;
  }
}

/** Turn one LanceDB row into a VectorPoint (vector column is usually "vector"). */
function rowToPoint(row: Record<string, unknown>, index: number): VectorPoint {
  const rawId = row['id'] ?? row['_rowid'] ?? index;
  const id = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : index;

  const point: VectorPoint = { id };

  const vec = row['vector'];
  if (Array.isArray(vec) && vec.every((v) => typeof v === 'number')) {
    point.vector = vec as number[];
  } else if (vec != null && typeof (vec as { length?: unknown }).length === 'number') {
    // Handles typed arrays / Arrow-backed vectors.
    const arr = Array.from(vec as ArrayLike<number>);
    if (arr.every((v) => typeof v === 'number')) point.vector = arr;
  }

  // Everything except the vector column becomes payload.
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'vector') continue;
    payload[k] = v;
  }
  if (Object.keys(payload).length > 0) point.payload = payload;

  return point;
}

export function lancedbInspector(cfg: VectorDBConfig): VectorStoreInspector {
  return {
    config: cfg,

    async ping(): Promise<boolean> {
      const conn = await connect(cfg);
      if (!conn) return false;
      try {
        await conn.tableNames();
        return true;
      } catch {
        return false;
      }
    },

    async listCollections(): Promise<CollectionInfo[]> {
      const conn = await connect(cfg);
      if (!conn) return [];
      try {
        const names = await conn.tableNames();
        return Promise.all(
          names.map(async (name) => {
            const info = await this.collectionInfo(name);
            return info ?? { name, vectors: 0 };
          }),
        );
      } catch {
        return [];
      }
    },

    async collectionInfo(name: string): Promise<CollectionInfo | null> {
      const conn = await connect(cfg);
      if (!conn) return null;
      try {
        const table = await conn.openTable(name);
        const vectors = await table.countRows();
        // Sample one row to discover dimensionality.
        const rows = await table.query().limit(1).toArray();
        let dim: number | undefined;
        const first = rows[0]?.['vector'];
        if (Array.isArray(first)) dim = first.length;
        else if (first != null && typeof (first as { length?: unknown }).length === 'number') {
          dim = (first as ArrayLike<number>).length;
        }
        return { name, vectors, dim };
      } catch {
        return null;
      }
    },

    async sample(name: string, n = 20): Promise<VectorPoint[]> {
      const conn = await connect(cfg);
      if (!conn) return [];
      try {
        const table = await conn.openTable(name);
        const rows = await table.query().limit(n).toArray();
        return rows.map(rowToPoint);
      } catch {
        return [];
      }
    },

    async count(name: string): Promise<number> {
      const conn = await connect(cfg);
      if (!conn) return 0;
      try {
        const table = await conn.openTable(name);
        return await table.countRows();
      } catch {
        return 0;
      }
    },
  };
}
