// @offgrid/vectordb — integration catalog
//
// UI-facing directory of known vector-store backends: which config fields each
// needs and whether the adapter is implemented ("available") or "planned".

import type { VectorDBKind } from './types.js';

export type IntegrationStatus = 'available' | 'planned';

export interface VectorDBIntegration {
  id: VectorDBKind;
  name: string;
  category: 'vectordb';
  /** Config field keys the UI should collect (subset of VectorDBConfig). */
  configFields: Array<'url' | 'apiKey' | 'collection'>;
  status: IntegrationStatus;
}

export const VECTORDB_INTEGRATIONS: VectorDBIntegration[] = [
  { id: 'qdrant', name: 'Qdrant', category: 'vectordb', configFields: ['url', 'apiKey'], status: 'available' },
  { id: 'lancedb', name: 'LanceDB', category: 'vectordb', configFields: ['url'], status: 'available' },
  { id: 'chroma', name: 'Chroma', category: 'vectordb', configFields: ['url', 'apiKey'], status: 'planned' },
  { id: 'pgvector', name: 'pgvector', category: 'vectordb', configFields: ['url'], status: 'planned' },
  { id: 'weaviate', name: 'Weaviate', category: 'vectordb', configFields: ['url', 'apiKey'], status: 'planned' },
  { id: 'milvus', name: 'Milvus', category: 'vectordb', configFields: ['url', 'apiKey'], status: 'planned' },
];
