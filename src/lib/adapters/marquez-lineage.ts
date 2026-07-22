// Marquez run-history + governance READ/WRITE adapter (the I/O half of the seam).
//
// Reads the endpoints the proven graph reader (src/lib/marquez.ts) skips — a job's FULL run
// history with real state + timing + the NominalTimeRunFacet, the job list, detailed namespaces
// (owner + description), and declared tags with descriptions. Writes namespace OWNERSHIP and TAG
// governance. All shaping is delegated to the PURE normalizer (src/lib/marquez-lineage.ts); all
// request building for writes is delegated to the PURE builders in src/lib/lineage-writer.ts
// (DRY — one place shapes a Marquez request). This file only does fetch + envelope, never throws.
//
// Dependency-injected `fetcher` + `baseUrl` make every path unit-testable with a fake network
// boundary (no live Marquez, no mocks of our own code). The default singleton reads the env.
import {
  type MarquezRequest,
  buildDatasetTagRequest,
  buildDatasetUntagRequest,
  buildJobTagRequest,
  buildNamespaceRequest,
  buildTagRequest,
} from '@/lib/lineage-writer';
import {
  type JobRefView,
  type NamespaceOwnershipView,
  type RawJobRef,
  type RawMarquezRun,
  type RawNamespaceOwnership,
  type RawTag,
  type RunHistoryView,
  type TagView,
  normalizeJobList,
  normalizeNamespaceList,
  normalizeRunHistory,
  normalizeTagList,
} from '@/lib/marquez-lineage';

export interface ReadEnvelope<T> {
  configured: boolean;
  data: T;
  error: string | null;
}

export interface WriteResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface MarquezLineageReaderConfig {
  baseUrl?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export interface MarquezLineageReader {
  configured(): boolean;
  listNamespaces(): Promise<ReadEnvelope<NamespaceOwnershipView[]>>;
  listJobs(namespace: string, limit?: number): Promise<ReadEnvelope<JobRefView[]>>;
  readRunHistory(
    namespace: string,
    job: string,
    limit?: number,
  ): Promise<ReadEnvelope<RunHistoryView | null>>;
  listTags(): Promise<ReadEnvelope<TagView[]>>;
  setNamespaceOwner(input: {
    name: string;
    ownerName: string;
    description?: string;
  }): Promise<WriteResult>;
  declareTag(input: { name: string; description?: string }): Promise<WriteResult>;
  tagDataset(input: { namespace: string; dataset: string; tag: string }): Promise<WriteResult>;
  untagDataset(input: { namespace: string; dataset: string; tag: string }): Promise<WriteResult>;
  tagJob(input: { namespace: string; job: string; tag: string }): Promise<WriteResult>;
}

export function createMarquezLineageReader(
  config: MarquezLineageReaderConfig = {},
): MarquezLineageReader {
  const fetcher = config.fetcher ?? fetch;
  const timeoutMs = config.timeoutMs ?? 6000;
  const base = () => (config.baseUrl ?? process.env.OFFGRID_MARQUEZ_URL ?? '').replace(/\/$/, '');

  async function getJson<T>(path: string): Promise<{ configured: boolean; json: T | null; error: string | null }> {
    const url = base();
    if (!url) return { configured: false, json: null, error: null };
    try {
      const res = await fetcher(`${url}${path}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { configured: true, json: null, error: `Marquez ${res.status}` };
      return { configured: true, json: (await res.json()) as T, error: null };
    } catch (e) {
      return { configured: true, json: null, error: (e as Error).message };
    }
  }

  async function send(reqShape: MarquezRequest): Promise<WriteResult> {
    const url = base();
    if (!url) return { ok: false, error: 'Marquez not configured' };
    try {
      const res = await fetcher(`${url}${reqShape.path}`, {
        method: reqShape.method,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: reqShape.body ? JSON.stringify(reqShape.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { ok: false, status: res.status, error: `Marquez ${res.status}` };
      return { ok: true, status: res.status };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  // Wrap a pure builder call so an invalid-input throw becomes an honest {ok:false} instead of a 500.
  async function build(fn: () => MarquezRequest): Promise<WriteResult> {
    let shape: MarquezRequest;
    try {
      shape = fn();
    } catch (e) {
      return { ok: false, status: 400, error: (e as Error).message };
    }
    return send(shape);
  }

  return {
    configured: () => Boolean(base()),

    async listNamespaces() {
      const r = await getJson<{ namespaces?: RawNamespaceOwnership[] }>('/api/v1/namespaces');
      return { configured: r.configured, data: normalizeNamespaceList(r.json?.namespaces), error: r.error };
    },

    async listJobs(namespace, limit = 100) {
      const enc = encodeURIComponent(namespace);
      const r = await getJson<{ jobs?: RawJobRef[] }>(
        `/api/v1/namespaces/${enc}/jobs?limit=${limit}`,
      );
      return { configured: r.configured, data: normalizeJobList(r.json?.jobs), error: r.error };
    },

    async readRunHistory(namespace, job, limit = 50) {
      const enc = encodeURIComponent(namespace);
      const encJob = encodeURIComponent(job);
      const r = await getJson<{ runs?: RawMarquezRun[] }>(
        `/api/v1/namespaces/${enc}/jobs/${encJob}/runs?limit=${limit}`,
      );
      if (!r.configured) return { configured: false, data: null, error: null };
      if (r.error) return { configured: true, data: null, error: r.error };
      return {
        configured: true,
        data: normalizeRunHistory({ namespace, job, runs: r.json?.runs }),
        error: null,
      };
    },

    async listTags() {
      const r = await getJson<{ tags?: RawTag[] }>('/api/v1/tags');
      return { configured: r.configured, data: normalizeTagList(r.json?.tags), error: r.error };
    },

    setNamespaceOwner: (input) => build(() => buildNamespaceRequest(input)),
    declareTag: (input) => build(() => buildTagRequest(input)),
    tagDataset: (input) => build(() => buildDatasetTagRequest(input)),
    untagDataset: (input) => build(() => buildDatasetUntagRequest(input)),
    tagJob: (input) => build(() => buildJobTagRequest(input)),
  };
}

export const marquezLineageReader = createMarquezLineageReader();
