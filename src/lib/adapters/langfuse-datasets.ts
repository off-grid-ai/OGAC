// ─── Langfuse dataset-management adapter — the I/O port behind an interface ─────────────────────────
//
// The ONLY impure seam for Langfuse-native DATASET management. Calls the public REST API via the
// shared `langfuse-http` transport; ALL validation/shaping lives in the pure `langfuse-datasets`
// layer (DRY). Routes/tests depend on `LangfuseDatasetsPort`; `langfuseDatasets` is the live impl.
//
// Wired endpoints:
//   list       → GET    /api/public/v2/datasets?limit=&page=
//   get        → GET    /api/public/v2/datasets/{name}
//   create     → POST   /api/public/v2/datasets                       ({ name, description?, metadata? })
//   items      → GET    /api/public/dataset-items?datasetName=&limit=
//   createItem → POST   /api/public/dataset-items                     (upsert by id)
//   deleteItem → DELETE /api/public/dataset-items/{id}
//   runs       → GET    /api/public/datasets/{name}/runs?limit=
import { langfuseConfigured, langfuseRequest } from '@/lib/langfuse-http';
import {
  type CreateDatasetBody,
  type CreateItemBody,
  type DatasetItemView,
  type DatasetRow,
  type DatasetRunView,
  type RawDataset,
  type RawDatasetItem,
  type RawDatasetRun,
  shapeDataset,
  shapeDatasetItems,
  shapeDatasetRuns,
  shapeDatasets,
} from '@/lib/langfuse-datasets';

interface Paged<T> {
  data: T[];
}

// The detail view a route hands the UI: the dataset + its items + its experiment runs.
export interface DatasetDetail {
  dataset: DatasetRow;
  items: DatasetItemView[];
  runs: DatasetRunView[];
}

export interface LangfuseDatasetsPort {
  configured(): boolean;
  list(limit?: number): Promise<DatasetRow[]>;
  detail(name: string, limit?: number): Promise<DatasetDetail | null>;
  create(body: CreateDatasetBody): Promise<DatasetRow | null>;
  createItem(body: CreateItemBody): Promise<DatasetItemView | null>;
  removeItem(id: string): Promise<void>;
}

const enc = encodeURIComponent;
const capped = (n: number | undefined) => String(Math.min(n ?? 100, 100));

export const langfuseDatasets: LangfuseDatasetsPort = {
  configured: () => langfuseConfigured(),

  async list(limit) {
    const json = await langfuseRequest<Paged<RawDataset>>({
      method: 'GET',
      path: `/api/public/v2/datasets?limit=${capped(limit)}`,
    });
    return shapeDatasets(json.data ?? []);
  },

  async detail(name, limit) {
    const dsRaw = await langfuseRequest<RawDataset>({
      method: 'GET',
      path: `/api/public/v2/datasets/${enc(name)}`,
    });
    const dataset = shapeDataset(dsRaw);
    if (!dataset) return null;
    // Items + runs are independent — one failing endpoint shouldn't blank the other.
    const [items, runs] = await Promise.allSettled([
      langfuseRequest<Paged<RawDatasetItem>>({
        method: 'GET',
        path: `/api/public/dataset-items?datasetName=${enc(name)}&limit=${capped(limit)}`,
      }),
      langfuseRequest<Paged<RawDatasetRun>>({
        method: 'GET',
        path: `/api/public/datasets/${enc(name)}/runs?limit=${capped(limit)}`,
      }),
    ]);
    return {
      dataset,
      items: items.status === 'fulfilled' ? shapeDatasetItems(items.value.data ?? []) : [],
      runs: runs.status === 'fulfilled' ? shapeDatasetRuns(runs.value.data ?? []) : [],
    };
  },

  async create(body) {
    const raw = await langfuseRequest<RawDataset>({
      method: 'POST',
      path: '/api/public/v2/datasets',
      body,
    });
    return shapeDataset(raw);
  },

  async createItem(body) {
    const raw = await langfuseRequest<RawDatasetItem>({
      method: 'POST',
      path: '/api/public/dataset-items',
      body,
    });
    return shapeDatasetItems(raw ? [raw] : [])[0] ?? null;
  },

  async removeItem(id) {
    await langfuseRequest<{ message?: string }>({
      method: 'DELETE',
      path: `/api/public/dataset-items/${enc(id)}`,
    });
  },
};
