// @offgrid/vectordb — core types
//
// Shared type surface for the vector-DB inspection + visualization layer.
// These describe how the UI connects to a vector store and what it reads back.

/** Supported / known vector-store kinds. Not all are implemented yet. */
export type VectorDBKind =
  | 'qdrant'
  | 'lancedb'
  | 'chroma'
  | 'pgvector'
  | 'weaviate'
  | 'milvus';

/**
 * Connection + selection config for a vector store.
 * `url` is the REST endpoint for network DBs, or a filesystem path/URI for
 * embedded stores like LanceDB. `apiKey` is optional (used as a header when set).
 */
export interface VectorDBConfig {
  kind: VectorDBKind;
  url: string;
  apiKey?: string;
  /** Optional default collection/table to operate on. */
  collection?: string;
}

/** Summary metadata about a single collection / table. */
export interface CollectionInfo {
  name: string;
  /** Number of vectors/points stored (best-effort; 0 if unknown). */
  vectors: number;
  /** Embedding dimensionality, when discoverable. */
  dim?: number;
  /** Distance metric (e.g. "Cosine", "Euclid", "Dot"), when discoverable. */
  distance?: string;
}

/** A single point/row pulled from a collection. */
export interface VectorPoint {
  id: string | number;
  vector?: number[];
  payload?: Record<string, unknown>;
}
