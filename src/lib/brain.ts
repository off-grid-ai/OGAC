import { randomUUID } from 'crypto';
import * as lancedb from '@lancedb/lancedb';
import { qdrantAdd, qdrantDelete, qdrantList, qdrantSearch } from '@/lib/qdrant';

// The Brain — the ingestion→retrieval (RAG) pipeline. LanceDB (embedded, on-disk) is the default
// store; Qdrant is the server-scale swap-in, selected with OFFGRID_ADAPTER_RETRIEVAL=qdrant — the
// public functions delegate to it without changing any caller. Embeddings come through the
// inference port (gateway by default, deterministic fallback offline), so swapping the model
// endpoint never touches this file. One dimension throughout.
const LANCEDB_PATH = process.env.LANCEDB_PATH ?? './.lancedb';
const TABLE = 'documents';

// Retrieval backend selection — mirrors the registry's OFFGRID_ADAPTER_<CAP> convention so the
// Brain honours the same swap as the adapters surface. Default (unset / 'lancedb') = LanceDB.
function qdrantSelected(): boolean {
  return process.env.OFFGRID_ADAPTER_RETRIEVAL === 'qdrant';
}

export interface BrainDoc {
  id: string;
  title: string;
  source: string;
  text: string;
}

export interface BrainHit extends BrainDoc {
  score: number;
}

interface DocRow extends BrainDoc {
  vector: number[];
}

// Embeddings go through the inference port — gateway when reachable, deterministic otherwise.
// The registry import is lazy (dynamic) ON PURPOSE: brain ← registry ← adapters/evals ← brain is a
// circular dependency. A top-level import lets webpack bundle the cycle into one chunk whose
// evaluation order trips a TDZ ("Cannot access 'x' before initialization") on Node 22 during the
// build's collect-page-data pass. Loading the port lazily at call time breaks the import cycle.
async function embed(text: string): Promise<number[]> {
  const { getInference } = await import('@/lib/adapters/registry');
  return getInference().embed(text);
}

const SEED_DOCS: ReadonlyArray<Omit<BrainDoc, 'id'>> = [
  {
    title: 'FNOL intake — death claim',
    source: 'SOP · Claims',
    text: 'On first notice of loss for a death claim, capture policy number, claimant relationship, date and cause of death, and the death certificate. Verify the policy is in force and past the contestability window. Flag for investigation if within two years of issue.',
  },
  {
    title: 'KYC verification steps',
    source: 'SOP · Onboarding',
    text: 'Collect a government photo ID and proof of address. Run PAN and Aadhaar verification. Match the name and date of birth across documents. Escalate mismatches to manual review. Never store raw Aadhaar in plain text.',
  },
  {
    title: 'Objection handling — term life',
    source: 'Playbook · Distribution',
    text: 'When a prospect says term insurance is a waste because there is no payout if they survive, reframe around protection cost versus investment. Compare premium to monthly expenses. Offer a return-of-premium variant only if affordability is the real objection.',
  },
];

let tablePromise: Promise<lancedb.Table> | null = null;

async function getTable(): Promise<lancedb.Table> {
  if (tablePromise) return tablePromise;
  tablePromise = (async () => {
    const db = await lancedb.connect(LANCEDB_PATH);
    const names = await db.tableNames();
    if (names.includes(TABLE)) return db.openTable(TABLE);
    // Build rows from the sample SOPs (also used to define the table schema).
    const rows: DocRow[] = [];
    for (const d of SEED_DOCS) {
      rows.push({ id: randomUUID(), ...d, vector: await embed(`${d.title}\n${d.text}`) });
    }
    // Demo seed OFF by default — a real deployment's Brain starts EMPTY (real docs come from
    // ingestion / addDocument). We still create the table from a sample row to fix the schema,
    // then clear it, so RAG returns real results only. Opt in with OFFGRID_SEED_DEMO=1.
    if (process.env.OFFGRID_SEED_DEMO === '1') {
      return db.createTable(TABLE, rows as unknown as Record<string, unknown>[]);
    }
    const t = await db.createTable(TABLE, [rows[0]] as unknown as Record<string, unknown>[]);
    await t.delete('true'); // remove the placeholder → empty table, correct schema
    return t;
  })();
  return tablePromise;
}

export async function listDocuments(): Promise<BrainDoc[]> {
  if (qdrantSelected()) return qdrantList();
  const tbl = await getTable();
  const rows = (await tbl.query().limit(1000).toArray()) as DocRow[];
  return rows.map((r) => ({ id: r.id, title: r.title, source: r.source, text: r.text }));
}

// A single document by id (the document inspector page).
export async function getDocument(id: string): Promise<BrainDoc | null> {
  const docs = await listDocuments();
  return docs.find((d) => d.id === id) ?? null;
}

export async function addDocument(title: string, source: string, text: string): Promise<BrainDoc> {
  if (qdrantSelected()) return qdrantAdd(title, source, text);
  const tbl = await getTable();
  const doc: DocRow = {
    id: randomUUID(),
    title,
    source,
    text,
    vector: await embed(`${title}\n${text}`),
  };
  await tbl.add([doc] as unknown as Record<string, unknown>[]);
  return { id: doc.id, title, source, text };
}

export async function deleteDocument(id: string): Promise<boolean> {
  if (qdrantSelected()) {
    await qdrantDelete(id);
    return true;
  }
  const tbl = await getTable();
  // id is a server-generated UUID; single-quote-escape defensively before the SQL-ish filter.
  const safe = id.replace(/'/g, "''");
  await tbl.delete(`id = '${safe}'`);
  return true;
}

export async function searchDocuments(query: string, k = 5): Promise<BrainHit[]> {
  if (qdrantSelected()) return qdrantSearch(query, k);
  const tbl = await getTable();
  const vector = await embed(query);
  const rows = (await tbl.search(vector).limit(k).toArray()) as Array<
    DocRow & { _distance: number }
  >;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    source: r.source,
    text: r.text,
    score: Number((1 / (1 + r._distance)).toFixed(3)),
  }));
}
