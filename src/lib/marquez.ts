// Marquez read-back. Run events are emitted as OpenLineage via the lineage adapter
// (src/lib/adapters/lineage.ts → POST /api/v1/lineage). This reads the resulting graph back
// through Marquez's REST API so the Lineage page can show the *server-sourced* job→dataset graph,
// not just a reconstruction from the local audit trail.
//   OFFGRID_MARQUEZ_URL — e.g. http://127.0.0.1:9000
import {
  type DatasetDetailView,
  type LineageView,
  type RawDatasetDetail,
  normalizeDatasetDetail,
  normalizeLineage,
} from './lineage-view';

const BASE = process.env.OFFGRID_MARQUEZ_URL;

export function marquezConfigured(): boolean {
  return Boolean(BASE);
}

async function mqGet<T>(path: string): Promise<T> {
  if (!BASE) throw new Error('Marquez not configured');
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Marquez ${res.status}`);
  return (await res.json()) as T;
}

export interface MarquezNamespace {
  name: string;
  ownerName?: string;
}

export interface MarquezJob {
  id?: { namespace: string; name: string };
  name: string;
  type?: string;
  namespace?: string;
  latestRun?: { state?: string } | null;
  inputs?: { namespace: string; name: string }[];
  outputs?: { namespace: string; name: string }[];
}

export interface MarquezDataset {
  id?: { namespace: string; name: string };
  name: string;
  type?: string;
  namespace?: string;
}

// The distilled graph the Lineage page renders: jobs, their datasets, and the edges between them.
export interface LineageGraph {
  configured: boolean;
  namespace: string | null;
  jobs: MarquezJob[];
  datasets: MarquezDataset[];
  edges: { from: string; to: string; kind: 'input' | 'output' }[];
  error?: string;
}

async function listNamespaces(): Promise<MarquezNamespace[]> {
  const json = await mqGet<{ namespaces?: MarquezNamespace[] }>('/api/v1/namespaces');
  return json.namespaces ?? [];
}

// Pick the console's namespace if present, else the first non-default one, else the first.
function chooseNamespace(nss: MarquezNamespace[]): string | null {
  if (!nss.length) return null;
  const want = process.env.OFFGRID_LINEAGE_NAMESPACE ?? 'offgrid-console';
  return (
    nss.find((n) => n.name === want)?.name ??
    nss.find((n) => n.name !== 'default')?.name ??
    nss[0].name
  );
}

// eslint-disable-next-line complexity
export async function fetchLineageGraph(): Promise<LineageGraph> {
  if (!BASE) return { configured: false, namespace: null, jobs: [], datasets: [], edges: [] };
  try {
    const ns = chooseNamespace(await listNamespaces());
    if (!ns) return { configured: true, namespace: null, jobs: [], datasets: [], edges: [] };
    const enc = encodeURIComponent(ns);
    const [jobsRes, dsRes] = await Promise.all([
      mqGet<{ jobs?: MarquezJob[] }>(`/api/v1/namespaces/${enc}/jobs?limit=100`),
      mqGet<{ datasets?: MarquezDataset[] }>(`/api/v1/namespaces/${enc}/datasets?limit=100`),
    ]);
    const jobs = jobsRes.jobs ?? [];
    const datasets = dsRes.datasets ?? [];
    const edges: LineageGraph['edges'] = [];
    for (const j of jobs) {
      for (const i of j.inputs ?? []) edges.push({ from: i.name, to: j.name, kind: 'input' });
      for (const o of j.outputs ?? []) edges.push({ from: j.name, to: o.name, kind: 'output' });
    }
    return { configured: true, namespace: ns, jobs, datasets, edges };
  } catch (e) {
    return {
      configured: true,
      namespace: null,
      jobs: [],
      datasets: [],
      edges: [],
      error: (e as Error).message,
    };
  }
}

// Thin best-effort reader → normalized display model. Reads all namespaces plus the chosen
// namespace's jobs & datasets, then hands the raw JSON to the pure normalizer. Never throws:
// returns { data, error } so the read-back page can render reachability without try/catch.
export async function readLineageView(): Promise<{
  configured: boolean;
  data: LineageView;
  error: string | null;
}> {
  const empty = normalizeLineage(null);
  if (!BASE) return { configured: false, data: empty, error: null };
  try {
    const namespaces = await listNamespaces();
    const ns = chooseNamespace(namespaces);
    if (!ns) return { configured: true, data: normalizeLineage({ namespaces }), error: null };
    const enc = encodeURIComponent(ns);
    const [jobsRes, dsRes] = await Promise.all([
      mqGet<{ jobs?: MarquezJob[] }>(`/api/v1/namespaces/${enc}/jobs?limit=100`),
      mqGet<{ datasets?: MarquezDataset[] }>(`/api/v1/namespaces/${enc}/datasets?limit=100`),
    ]);
    const data = normalizeLineage({
      namespaces,
      namespace: ns,
      jobs: jobsRes.jobs ?? [],
      datasets: dsRes.datasets ?? [],
    });
    return { configured: true, data, error: null };
  } catch (e) {
    return { configured: true, data: empty, error: (e as Error).message };
  }
}

// Read ONE dataset's schema + facets + tags: GET /api/v1/namespaces/{ns}/datasets/{ds}. Drives
// the dataset detail panel (?dataset=). Best-effort: never throws — returns { configured, data,
// error } so the panel renders a note when Marquez is unreachable or the dataset is absent.
export async function readDataset(
  namespace: string,
  dataset: string,
): Promise<{ configured: boolean; data: DatasetDetailView | null; error: string | null }> {
  if (!BASE) return { configured: false, data: null, error: null };
  const ns = namespace.trim();
  const ds = dataset.trim();
  if (!ns || !ds) return { configured: true, data: null, error: 'namespace and dataset required' };
  try {
    const raw = await mqGet<RawDatasetDetail>(
      `/api/v1/namespaces/${encodeURIComponent(ns)}/datasets/${encodeURIComponent(ds)}`,
    );
    return { configured: true, data: normalizeDatasetDetail(raw), error: null };
  } catch (e) {
    return { configured: true, data: null, error: (e as Error).message };
  }
}
