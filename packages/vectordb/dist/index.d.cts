/** Supported / known vector-store kinds. Not all are implemented yet. */
type VectorDBKind = 'qdrant' | 'lancedb' | 'chroma' | 'pgvector' | 'weaviate' | 'milvus';
/**
 * Connection + selection config for a vector store.
 * `url` is the REST endpoint for network DBs, or a filesystem path/URI for
 * embedded stores like LanceDB. `apiKey` is optional (used as a header when set).
 */
interface VectorDBConfig {
    kind: VectorDBKind;
    url: string;
    apiKey?: string;
    /** Optional default collection/table to operate on. */
    collection?: string;
}
/** Summary metadata about a single collection / table. */
interface CollectionInfo {
    name: string;
    /** Number of vectors/points stored (best-effort; 0 if unknown). */
    vectors: number;
    /** Embedding dimensionality, when discoverable. */
    dim?: number;
    /** Distance metric (e.g. "Cosine", "Euclid", "Dot"), when discoverable. */
    distance?: string;
}
/** A single point/row pulled from a collection. */
interface VectorPoint {
    id: string | number;
    vector?: number[];
    payload?: Record<string, unknown>;
}

interface VectorStoreInspector {
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

declare function qdrantInspector(cfg: VectorDBConfig): VectorStoreInspector;

declare function lancedbInspector(cfg: VectorDBConfig): VectorStoreInspector;

declare function unsupportedInspector(cfg: VectorDBConfig): VectorStoreInspector;

/** Create an inspector for the given config. Implemented: qdrant, lancedb. */
declare function createInspector(cfg: VectorDBConfig): VectorStoreInspector;

interface Point2D {
    x: number;
    y: number;
}
interface ProjectedPoint extends Point2D {
    id: VectorPoint['id'];
    payload?: Record<string, unknown>;
}
/**
 * Project N vectors to 2D via PCA (top-2 principal components).
 *
 * Edge cases:
 *  - 0 vectors → []
 *  - 1 vector  → [{x:0,y:0}]
 *  - dim < 2 or degenerate second component → falls back to using the
 *    raw first dimension / zero for the missing axis.
 */
declare function project2D(vectors: number[][]): Point2D[];
/**
 * Project VectorPoints (pulling `.vector`) and re-attach id + payload.
 * Points without a vector are skipped.
 */
declare function project2DFromPoints(points: VectorPoint[]): ProjectedPoint[];

type IntegrationStatus = 'available' | 'planned';
interface VectorDBIntegration {
    id: VectorDBKind;
    name: string;
    category: 'vectordb';
    /** Config field keys the UI should collect (subset of VectorDBConfig). */
    configFields: Array<'url' | 'apiKey' | 'collection'>;
    status: IntegrationStatus;
}
declare const VECTORDB_INTEGRATIONS: VectorDBIntegration[];

export { type CollectionInfo, type IntegrationStatus, type Point2D, type ProjectedPoint, VECTORDB_INTEGRATIONS, type VectorDBConfig, type VectorDBIntegration, type VectorDBKind, type VectorPoint, type VectorStoreInspector, createInspector, lancedbInspector, project2D, project2DFromPoints, qdrantInspector, unsupportedInspector };
