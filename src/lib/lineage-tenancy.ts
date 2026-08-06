// ─── Who owns a node in the lineage graph (PURE, zero-IO) ─────────────────────────────────────────
//
// CROSS-TENANT LEAK, found 2026-08-05 in the read-only demo audit and verified live: the bank's
// `bhcon_corebank:claims` dataset and a "Credit card upsell policy" job both rendered on the
// INSURER's /data/lineage/graph. The lineage store is a single shared Marquez namespace
// (`offgrid-console`) with no tenant dimension, and the reader fetched all of it.
//
// WHY THIS IS NOT JUST "FILTER ON AN ORG FIELD". Marquez datasets and jobs carry no owner marker —
// measured on the live graph, every dataset returns `tags: []` and no facets. Ownership has to be
// RESOLVED from the name, against our own tables. The names fall into a small number of shapes:
//
//   225 datasets: 172 `run_<id>`, 13 `chatrun_<id>`, ~10 `<connector>:<table>`
//                 (bhcon_corebank, surcon_coreins, surcon_policyadmin, con_f5c959…),
//                 plus a handful of prose names ("Credit card upsell policy", "SOP").
//    55 jobs:     41 `agent:<id>`, 9 `chat:<id>`, 4 `brain:*`, 1 `retrieval.*`
//
// The prose-named ones are the leak the audit actually saw, and they are exactly the ones that cannot
// be attributed — so they are shown to nobody, per the rule the other six fixes follow. Everything
// with a resolvable id keeps working, which is what stops this from emptying a graph the audit called
// genuinely strong (55 jobs / 225 datasets / 160 edges) in order to fix it.
//
// Pure: the caller resolves which ids an org owns (lineage-ownership.ts) and passes them in.

/** What a lineage node's name refers to, once parsed. */
export type LineageRefKind = 'run' | 'chatrun' | 'agent' | 'chat' | 'connector' | 'unknown';

export interface LineageRef {
  kind: LineageRefKind;
  /** The id to look up in our tables. Empty when `kind` is 'unknown'. */
  id: string;
}

/** A dataset or job as the graph reader sees it — only the name matters for ownership. */
export interface LineageNode {
  name?: string;
}

const UNKNOWN: LineageRef = { kind: 'unknown', id: '' };

/**
 * Parse a Marquez dataset or job name into the entity it refers to.
 *
 * Deliberately strict. A name that does not match a known shape is `unknown`, never a guess — a
 * wrong guess here does not fail loudly, it shows one tenant another tenant's data.
 */
export function lineageRef(name: string | undefined | null): LineageRef {
  const raw = (name ?? '').trim();
  if (!raw) return UNKNOWN;

  // `agent:agent_c6ac38cb`, `chat:conv_proof_msektf9o` — a job namespaced by entity kind.
  const colon = raw.indexOf(':');
  if (colon > 0) {
    const prefix = raw.slice(0, colon);
    const rest = raw.slice(colon + 1).trim();
    if (!rest) return UNKNOWN;
    if (prefix === 'agent') return { kind: 'agent', id: rest };
    if (prefix === 'chat') return { kind: 'chat', id: rest };
    // `<connector>:<table>` — the connector id owns the dataset. Matched on the id SHAPE rather than
    // a tenant-specific prefix list: `bhcon_`/`surcon_` happen to be this deployment's connectors, and
    // hard-coding them would silently stop scoping the moment a third tenant is added.
    if (/^[a-z0-9]+con_[a-z0-9_]+$/i.test(prefix) || /^con_[a-z0-9]+$/i.test(prefix)) {
      return { kind: 'connector', id: prefix };
    }
    return UNKNOWN;
  }

  // Bare run ids produced by governed runs and chat.
  if (/^run_[a-z0-9]+$/i.test(raw)) return { kind: 'run', id: raw };
  if (/^chatrun_[a-z0-9]+$/i.test(raw)) return { kind: 'chatrun', id: raw };

  // Prose names ("Credit card upsell policy", "SOP", "Knowledge base (Brain)") and anything else.
  return UNKNOWN;
}

/** The ids an org owns, grouped by the kind of thing they name. */
export interface OwnedLineageKeys {
  runs: ReadonlySet<string>;
  chatRuns: ReadonlySet<string>;
  agents: ReadonlySet<string>;
  chats: ReadonlySet<string>;
  connectors: ReadonlySet<string>;
}

export const NO_LINEAGE_KEYS: OwnedLineageKeys = {
  runs: new Set(),
  chatRuns: new Set(),
  agents: new Set(),
  chats: new Set(),
  connectors: new Set(),
};

/** Does this org own the entity a lineage node names? Unknown shapes belong to nobody. */
export function ownsLineageNode(name: string | undefined | null, owned: OwnedLineageKeys): boolean {
  const ref = lineageRef(name);
  switch (ref.kind) {
    case 'run':
      return owned.runs.has(ref.id);
    case 'chatrun':
      return owned.chatRuns.has(ref.id);
    case 'agent':
      return owned.agents.has(ref.id);
    case 'chat':
      return owned.chats.has(ref.id);
    case 'connector':
      return owned.connectors.has(ref.id);
    default:
      return false;
  }
}

/** Keep only the nodes this org owns. */
export function filterLineageNodes<T extends LineageNode>(
  nodes: readonly T[],
  owned: OwnedLineageKeys,
): T[] {
  return nodes.filter((n) => ownsLineageNode(n.name, owned));
}

export interface LineageEdge {
  from: string;
  to: string;
  kind: 'input' | 'output';
}

/**
 * Drop every edge that touches a node the org cannot see.
 *
 * This matters as much as filtering the nodes: an edge naming `bhcon_corebank:claims` discloses that
 * dataset's existence even when the dataset itself was filtered out, and the graph would render a
 * dangling label pointing at another tenant's table.
 */
export function filterLineageEdges(
  edges: readonly LineageEdge[],
  visibleNames: ReadonlySet<string>,
): LineageEdge[] {
  return edges.filter((e) => visibleNames.has(e.from) && visibleNames.has(e.to));
}
