// @offgrid/vectordb — public entry point
//
// Plug-and-play vector DB / knowledge-base inspection + 2D visualization layer.
// Connect a store by config, list/inspect collections, sample points, and
// PCA-project embeddings to 2D for scatter-plot visualization.

export type {
  VectorDBKind,
  VectorDBConfig,
  CollectionInfo,
  VectorPoint,
} from './types.js';

export type { VectorStoreInspector } from './inspector.js';

export { qdrantInspector } from './adapters/qdrant.js';
export { lancedbInspector } from './adapters/lancedb.js';
export { unsupportedInspector } from './adapters/unsupported.js';
export { createInspector } from './factory.js';

export { project2D, project2DFromPoints } from './project.js';
export type { Point2D, ProjectedPoint } from './project.js';

export { VECTORDB_INTEGRATIONS } from './catalog.js';
export type { VectorDBIntegration, IntegrationStatus } from './catalog.js';
