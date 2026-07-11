import { randomUUID } from 'node:crypto';
import * as lancedb from '@lancedb/lancedb';
import { qdrantAdd, qdrantDelete, qdrantList, qdrantSearch } from '@/lib/qdrant';
import { filterHitsByAcl, type DocAcl } from '@/lib/retrieval/acl';
import { buildLanceWhere, rrfFuse, type RetrievalOptions } from '@/lib/retrieval/query';

export type { RetrievalOptions } from '@/lib/retrieval/query';
export type { DocAcl } from '@/lib/retrieval/acl';

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
  /** Optional per-document ACL for permissions-aware retrieval. Absent → un-ACL'd (visible to all,
   *  today's behaviour). Present → only askers the ACL grants may retrieve/cite the doc. */
  acl?: DocAcl;
}

export interface BrainHit extends BrainDoc {
  score: number;
}

// LanceDB has a FIXED schema fixed by the first row. Arrays are awkward across engine versions, so
// the ACL is persisted as flat columns: owner/data_class as text, the two allowlists as JSON-string
// columns. Empty string === "no value" so an un-ACL'd doc round-trips to an empty DocAcl (visible).
interface DocRow extends BrainDoc {
  vector: number[];
  owner: string;
  allowed_roles: string; // JSON array string, '' when none
  allowed_subjects: string; // JSON array string, '' when none
  data_class: string;
}

// The flat ACL column names, in one place. A DocRow persists these four text columns in addition to
// the base BrainDoc + vector. Kept as a typed constant so the schema-reconciliation migration and
// the row-shaper can't drift apart. Empty string is the "no value" sentinel for every one of them.
const ACL_COLUMNS = ['owner', 'allowed_roles', 'allowed_subjects', 'data_class'] as const;
type AclColumn = (typeof ACL_COLUMNS)[number];

// PURE helper: DocAcl → the flat LanceDB columns. Zero I/O, unit-testable.
function aclToColumns(acl?: DocAcl): Record<AclColumn, string> {
  const arr = (v?: readonly string[] | null) => (v && v.length > 0 ? JSON.stringify(v) : '');
  return {
    owner: acl?.owner ?? '',
    allowed_roles: arr(acl?.allowed_roles),
    allowed_subjects: arr(acl?.allowed_subjects),
    data_class: acl?.data_class ?? '',
  };
}

// PURE helper: given the column names an existing table already has, return the migration needed to
// bring it up to the current DocRow schema — i.e. the ACL columns it's missing, each as an
// `addColumns` SQL transform that back-fills existing rows with the empty-string sentinel.
// Returns [] when the table is already current (no migration). This is the fix for the live 500:
// tables created before the ACL columns existed reject writes with "Found field not in schema".
export function aclColumnMigration(existing: readonly string[]): Array<{ name: string; valueSql: string }> {
  const have = new Set(existing);
  return ACL_COLUMNS.filter((c) => !have.has(c)).map((name) => ({ name, valueSql: "''" }));
}

function parseJsonArr(s: unknown): string[] | null {
  if (typeof s !== 'string' || s.trim() === '') return null;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

function aclFromRow(r: Partial<DocRow>): DocAcl {
  return {
    owner: r.owner && r.owner !== '' ? r.owner : null,
    allowed_roles: parseJsonArr(r.allowed_roles),
    allowed_subjects: parseJsonArr(r.allowed_subjects),
    data_class: r.data_class && r.data_class !== '' ? r.data_class : null,
  };
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

// I/O adapter around the pure `aclColumnMigration` rule: bring an existing table's on-disk schema
// up to the current DocRow shape. LanceDB fixes a table's schema at creation and rejects `add()`
// rows carrying fields it doesn't know ("Found field not in schema: owner") — so a table created
// before the ACL columns existed breaks every new ingest. This adds the missing columns in place
// (back-filling existing rows with the empty-string sentinel), a metadata-cheap operation. Idempotent.
async function reconcileAclColumns(tbl: lancedb.Table): Promise<void> {
  const schema = await tbl.schema();
  const migration = aclColumnMigration(schema.fields.map((f) => f.name));
  if (migration.length === 0) return;
  await tbl.addColumns(migration.map((m) => ({ name: m.name, valueSql: m.valueSql })));
}

let tablePromise: Promise<lancedb.Table> | null = null;

async function getTable(): Promise<lancedb.Table> {
  if (tablePromise) return tablePromise;
  tablePromise = (async () => {
    const db = await lancedb.connect(LANCEDB_PATH);
    const names = await db.tableNames();
    if (names.includes(TABLE)) {
      const tbl = await db.openTable(TABLE);
      await reconcileAclColumns(tbl);
      return tbl;
    }
    // Build rows from the sample SOPs (also used to define the table schema).
    const rows: DocRow[] = [];
    for (const d of SEED_DOCS) {
      rows.push({
        id: randomUUID(),
        ...d,
        vector: await embed(`${d.title}\n${d.text}`),
        ...aclToColumns(undefined), // seed docs are un-ACL'd → the ACL columns fix the schema only
      });
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
  return rows.map((r) => ({ id: r.id, title: r.title, source: r.source, text: r.text, acl: aclFromRow(r) }));
}

// A single document by id (the document inspector page).
export async function getDocument(id: string): Promise<BrainDoc | null> {
  const docs = await listDocuments();
  return docs.find((d) => d.id === id) ?? null;
}

// Thrown when the vector store genuinely can't accept a write. Carries a stable HTTP status so the
// route can surface a clear error instead of a bare 500 with an empty body.
export class BrainWriteError extends Error {
  readonly status: number;
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'BrainWriteError';
    this.status = 502; // upstream store failed, not the caller's fault
  }
}

// PURE helper: shape a BrainDoc + embedding into the persisted DocRow. No I/O — unit-testable.
function toDocRow(id: string, title: string, source: string, text: string, vector: number[], acl?: DocAcl): DocRow {
  return { id, title, source, text, vector, ...aclToColumns(acl) };
}

export async function addDocument(
  title: string,
  source: string,
  text: string,
  acl?: DocAcl,
): Promise<BrainDoc> {
  if (qdrantSelected()) return qdrantAdd(title, source, text, acl);
  let tbl: lancedb.Table;
  let vector: number[];
  try {
    tbl = await getTable();
    vector = await embed(`${title}\n${text}`);
  } catch (e) {
    throw new BrainWriteError('The knowledge store is unavailable — could not embed or open the index.', e);
  }
  const doc = toDocRow(randomUUID(), title, source, text, vector, acl);
  try {
    await tbl.add([doc] as unknown as Record<string, unknown>[]);
  } catch (e) {
    // e.g. a legacy-schema table that couldn't be reconciled. Surface a clear, actionable error
    // rather than a bare 500 — never let the raw LanceDB message escape as an empty-body crash.
    throw new BrainWriteError(
      `The knowledge store rejected the document: ${e instanceof Error ? e.message : String(e)}`,
      e,
    );
  }
  return { id: doc.id, title, source, text, acl };
}

export async function deleteDocument(id: string): Promise<boolean> {
  if (qdrantSelected()) {
    await qdrantDelete(id);
    return true;
  }
  const tbl = await getTable();
  // id is a server-generated UUID; single-quote-escape defensively before the SQL-ish filter.
  const safe = id.replaceAll("'", "''");
  await tbl.delete(`id = '${safe}'`);
  return true;
}

function rowToHit(r: DocRow & { _distance: number }): BrainHit {
  return {
    id: r.id,
    title: r.title,
    source: r.source,
    text: r.text,
    acl: aclFromRow(r),
    score: Number((1 / (1 + r._distance)).toFixed(3)),
  };
}

// LanceDB full-text (BM25) index on `text`, ensured lazily for the hybrid keyword leg. Best-effort:
// if it can't be created (older engine, empty table) hybrid degrades to vector-only.
let ftsReady: Promise<boolean> | null = null;
async function ensureFts(tbl: lancedb.Table): Promise<boolean> {
  if (!ftsReady) {
    ftsReady = tbl
      .createIndex('text', { config: lancedb.Index.fts() })
      .then(() => true)
      .catch(() => {
        ftsReady = null; // allow a later retry once the table has rows/index support
        return false;
      });
  }
  return ftsReady;
}

/**
 * Semantic retrieval over the Brain, with optional metadata filtering and a hybrid (keyword +
 * vector) mode. Backward compatible: `searchDocuments(query, k)` behaves exactly as before —
 * a pure filtered-nothing vector search on whichever backend is selected.
 *
 * - opts.filter → LanceDB `.where(...)` / Qdrant `filter.must[]` (threaded down, no behaviour
 *   change when absent).
 * - opts.mode === 'hybrid' → fuse a full-text (BM25) ranking with the vector ranking by RRF.
 * - opts.asker → permissions-aware retrieval: hits are post-filtered by the pure ACL rule
 *   (docVisibleTo) so only docs the asker may see are returned. Un-ACL'd docs stay visible. Runs
 *   BEFORE the top-k cut so an asker still gets up to k results they're allowed to see. Composes
 *   with filter + hybrid: it's the last, authoritative pass over the fused rows.
 */
export async function searchDocuments(
  query: string,
  k = 5,
  opts: RetrievalOptions = {},
): Promise<BrainHit[]> {
  if (qdrantSelected()) return qdrantSearch(query, k, opts);
  const tbl = await getTable();
  const vector = await embed(query);
  const where = buildLanceWhere(opts.filter);

  // ACL post-filter over rows, applied before the top-k cut. When no asker is supplied this is the
  // identity function (byte-identical to today). Over-fetch so filtering still fills k allowed hits.
  const aclPass = (rows: Array<DocRow & { _distance: number }>) =>
    opts.asker ? filterHitsByAcl(opts.asker, rows, aclFromRow) : rows;
  // Over-fetch when an ACL applies (or hybrid) so filtered results still reach k.
  const overFetch = opts.mode === 'hybrid' || Boolean(opts.asker);
  const vLimit = overFetch ? Math.max(k * 4, 20) : k;
  let vq = tbl.search(vector).limit(vLimit);
  if (where) vq = vq.where(where);
  const vRows = (await vq.toArray()) as Array<DocRow & { _distance: number }>;

  if (opts.mode !== 'hybrid') {
    return aclPass(vRows).slice(0, k).map(rowToHit);
  }

  // Keyword leg — LanceDB full-text search over `text`. If the FTS index can't be built, fall back
  // to vector-only (still correct, just not fused).
  const rowById = new Map<string, DocRow & { _distance: number }>();
  for (const r of vRows) rowById.set(r.id, r);

  let kwIds: string[] = [];
  if (await ensureFts(tbl).catch(() => false)) {
    try {
      let fq = tbl.search(query, 'fts', 'text').limit(vLimit);
      if (where) fq = fq.where(where);
      const fRows = (await fq.toArray()) as Array<DocRow & { _distance?: number }>;
      kwIds = fRows.map((r) => r.id);
      for (const r of fRows) if (!rowById.has(r.id)) rowById.set(r.id, { ...r, _distance: 1 });
    } catch {
      kwIds = [];
    }
  }

  if (kwIds.length === 0) return aclPass(vRows).slice(0, k).map(rowToHit);

  const vIds = vRows.map((r) => r.id);
  const fusedIds = rrfFuse([vIds, kwIds]);
  const fusedRows = fusedIds
    .map((id) => rowById.get(id))
    .filter((r): r is DocRow & { _distance: number } => Boolean(r));
  return aclPass(fusedRows).slice(0, k).map(rowToHit);
}
