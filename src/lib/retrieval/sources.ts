import { searchDocuments } from '@/lib/brain';
import { listDatasets, listTools } from '@/lib/store';
import { connectorSource } from './connector-source';
import type { RetrievalHit, RetrievalSource } from './types';

// The three retrieval destinations the router can route to. Each is independent and pluggable —
// the router only knows the RetrievalSource interface, never these implementations.

function tokenOverlap(query: string, text: string): number {
  const q = new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const t = new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  if (q.size === 0) return 0;
  let hits = 0;
  for (const w of q) if (t.has(w)) hits += 1;
  return Number((hits / q.size).toFixed(3));
}

// KB → the Brain (vector retrieval over LanceDB, embeddings via the gateway). Carries the doc id.
export const kbSource: RetrievalSource = {
  id: 'kb',
  kind: 'kb',
  label: 'Knowledge base (Brain)',
  describe: 'Vector retrieval over ingested documents/SOPs, with citations.',
  async search(query, k, opts) {
    const hits = await searchDocuments(query, k, opts);
    return hits.map((h) => ({
      sourceId: 'kb',
      sourceKind: 'kb',
      title: h.title,
      snippet: h.text.slice(0, 200),
      ref: `doc:${h.id}`,
      score: h.score,
    }));
  },
};

// DATABASE → the structured data plane. Today: searches dataset catalog metadata; the same
// source would back a text-to-SQL query when wired to a live warehouse.
export const databaseSource: RetrievalSource = {
  id: 'database',
  kind: 'database',
  label: 'Structured database',
  describe: 'The data-plane catalog (datasets, classifications); text-to-SQL when wired live.',
  async search(query, k, _opts, context) {
    const datasets = await listDatasets(context?.orgId);
    return datasets
      .map((d) => ({
        sourceId: 'database',
        sourceKind: 'database' as const,
        title: d.name,
        snippet: `${d.rows.toLocaleString()} rows · ${d.classification} · ${d.source}`,
        ref: `dataset:${d.id}`,
        score: tokenOverlap(query, `${d.name} ${d.source} ${d.classification}`),
      }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  },
};

// TOOL → the tool registry (HTTP/MCP tools an operator configured). Intent is matched against
// each tool's name + "when to use" description, so registering a tool wires it into routing.
export const toolSource: RetrievalSource = {
  id: 'tool',
  kind: 'tool',
  label: 'Tools & services',
  describe: 'Configured HTTP / MCP tools the router can invoke (the tool registry).',
  async search(query, k, _opts, context) {
    const tools = (await listTools(context?.orgId)).filter((t) => t.enabled);
    return tools
      .map((t) => ({
        sourceId: 'tool',
        sourceKind: 'tool' as const,
        title: t.name,
        snippet: `${t.type} · ${t.description || t.endpoint}`,
        ref: `tool:${t.id}`,
        score: tokenOverlap(query, `${t.name} ${t.description} ${t.type}`),
      }))
      .filter((h: RetrievalHit) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  },
};

// CONNECTOR → declared data-domains routed to their bound connector, read live (Builder Epic 1B).
// Appended by the connector rule engine phase; contributes nothing unless a query names/implies a
// declared domain (deterministic, no-guess) — see connector-source.ts.
export const SOURCES: RetrievalSource[] = [kbSource, databaseSource, toolSource, connectorSource];
