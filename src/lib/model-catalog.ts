// ─── Curated MODEL SPEC CATALOG (Task #128) — PURE, zero-IO ───────────────────────────────────────
//
// Model-routing rules used to free-type a model id (any string). That's error-prone: a typo routes
// nowhere, and an operator has no way to know a model's context window / modality / family before
// picking it. This catalog is the connector-catalog pattern (connector-catalog.ts / mcp-catalog.ts)
// applied to MODELS: a static, curated set of real model SPECS the routing-rule picker chooses from
// instead of a raw text field.
//
// It holds NO I/O. The picker UI (a thin client component) consumes it; the routing rule is written
// through the EXISTING create route (POST /api/v1/admin/routing → createRoutingRule). The catalog
// just supplies the chosen model id — we never duplicate routing storage here.
//
// ── HONESTY BAR (non-negotiable) ──────────────────────────────────────────────────────────────────
// Context windows and families are REAL published specs, not guesses. Where a spec is genuinely
// unknown or not publicly fixed, `contextWindow` is `null` — NEVER a fabricated number. `paramsB`
// (parameter count in billions) and `license` are likewise null when not cleanly known.
//
// ── FLEET-SERVED (servedOnFleet) ────────────────────────────────────────────────────────────────
// The fleet's actually-served models come from the DB SSOT (`fleet_nodes.model` — the routing tag).
// The static catalog marks the models we KNOW the fleet serves (per deploy/onprem/SERVER_STATE.md +
// SERVICE_MAP: qwythos-9b, gemma-4-e4b, qwen3-vl-8b chat/vision; juggernaut-xl for image) with
// `servedOnFleet: true`. But the LIVE truth is the DB, so `mergeFleetServed()` reconciles the static
// catalog against the real fleet routing tags: a catalog entry whose id matches a live tag is marked
// served; a live tag with no catalog entry is surfaced as a minimal "served, unknown-spec" entry so
// the picker never hides a model the fleet actually routes to.

// ─── Modality — what kind of I/O the model handles ────────────────────────────────────────────────
export type Modality = 'text' | 'vision' | 'image' | 'embedding';

export const MODALITIES: Modality[] = ['text', 'vision', 'image', 'embedding'];

// ─── Family — the model lineage, for grouping in the picker ─────────────────────────────────────
export type ModelFamily =
  | 'Qwen'
  | 'Llama'
  | 'Gemma'
  | 'Mistral'
  | 'DeepSeek'
  | 'Phi'
  | 'SDXL'
  | 'Off Grid'
  | 'Other';

export const MODEL_FAMILIES: ModelFamily[] = [
  'Qwen',
  'Llama',
  'Gemma',
  'Mistral',
  'DeepSeek',
  'Phi',
  'SDXL',
  'Off Grid',
  'Other',
];

// ─── ModelSpec — one catalog entry ────────────────────────────────────────────────────────────────
export interface ModelSpec {
  /** The routing tag / id the gateway speaks and `createRoutingRule({model})` stores. */
  id: string;
  /** Human display name. */
  name: string;
  /** Lineage, for grouping. */
  family: ModelFamily;
  /** Published max context window in tokens. `null` when genuinely unknown — never fabricated. */
  contextWindow: number | null;
  /** Primary modality. A vision model also does text; `vision` marks multimodal image+text in. */
  modality: Modality;
  /** Parameter count in billions, when cleanly known. `null` otherwise. */
  paramsB: number | null;
  /** SPDX-ish license string when known, else `null`. */
  license: string | null;
  /** True when this model is served by the on-prem fleet (per the SSOT). */
  servedOnFleet: boolean;
  /** Optional one-line note (e.g. why a spec is null, or fleet placement). */
  note?: string;
}

// ─── The curated catalog ────────────────────────────────────────────────────────────────────────
// (a) Fleet-served models (servedOnFleet: true) — grounded in deploy/onprem/SERVER_STATE.md +
//     SERVICE_MAP.md. (b) Common known models an operator might route to (LiteLLM-style): the
//     Llama / Qwen / Gemma / Mistral / DeepSeek / Phi families + the OpenAI-compatible names the
//     gateway speaks (embeddings). Specs are real published values; unknown → null.
export const MODEL_CATALOG: ModelSpec[] = [
  // ── Fleet-served (SSOT: SERVER_STATE.md / SERVICE_MAP.md) ──────────────────────────────────────
  {
    // The fleet's routing tag. Underlying HF release is 9B (no sub-9B qwythos exists — SERVER_STATE).
    id: 'qwythos-9b',
    name: 'Qwythos 9B',
    family: 'Qwen', // Qwen-derived fine-tune served on the fleet
    contextWindow: null, // community fine-tune; no single published context window → honest null
    modality: 'vision', // fleet runs it text + vision (SERVICE_MAP: "text + vision")
    paramsB: 9,
    license: null,
    servedOnFleet: true,
    note: 'Fleet chat/vision model (g1). Qwen-derived fine-tune; context window not publicly fixed.',
  },
  {
    id: 'gemma-4-e4b',
    name: 'Gemma 4 E4B',
    family: 'Gemma',
    contextWindow: 32768, // Gemma-3n/E-series serve at 32K on the fleet's llama.cpp config
    modality: 'vision', // fleet serves text + vision
    paramsB: 4,
    license: 'Gemma',
    servedOnFleet: true,
    note: 'Fleet chat/vision model (g2, g5).',
  },
  {
    id: 'qwen3-vl-8b',
    name: 'Qwen3-VL 8B Instruct',
    family: 'Qwen',
    contextWindow: 262144, // Qwen3-VL-8B-Instruct published 256K context
    modality: 'vision',
    paramsB: 8,
    license: 'Apache-2.0',
    servedOnFleet: true,
    note: 'Fleet vision-language model (g4, g7). Qwen/Qwen3-VL-8B-Instruct-GGUF.',
  },
  {
    id: 'juggernaut-xl',
    name: 'Juggernaut XL v9',
    family: 'SDXL',
    contextWindow: null, // diffusion image model — no token context window
    modality: 'image',
    paramsB: null,
    license: 'CreativeML-OpenRAIL-M',
    servedOnFleet: true,
    note: 'Fleet image model (g3). SDXL fine-tune; no token context window.',
  },

  // ── Common known models operators might route to (curated, LiteLLM-style) ─────────────────────
  // Qwen
  {
    id: 'qwen2.5-7b-instruct',
    name: 'Qwen2.5 7B Instruct',
    family: 'Qwen',
    contextWindow: 131072, // Qwen2.5 published 128K context
    modality: 'text',
    paramsB: 7,
    license: 'Apache-2.0',
    servedOnFleet: false,
  },
  {
    id: 'qwen2.5-72b-instruct',
    name: 'Qwen2.5 72B Instruct',
    family: 'Qwen',
    contextWindow: 131072,
    modality: 'text',
    paramsB: 72,
    license: 'Qwen',
    servedOnFleet: false,
  },
  {
    id: 'qwen3-8b',
    name: 'Qwen3 8B',
    family: 'Qwen',
    contextWindow: 131072, // Qwen3 dense models published 128K (with YaRN)
    modality: 'text',
    paramsB: 8,
    license: 'Apache-2.0',
    servedOnFleet: false,
  },
  // Llama
  {
    id: 'llama-3.1-8b-instruct',
    name: 'Llama 3.1 8B Instruct',
    family: 'Llama',
    contextWindow: 131072, // Llama 3.1 published 128K context
    modality: 'text',
    paramsB: 8,
    license: 'Llama-3.1',
    servedOnFleet: false,
  },
  {
    id: 'llama-3.1-70b-instruct',
    name: 'Llama 3.1 70B Instruct',
    family: 'Llama',
    contextWindow: 131072,
    modality: 'text',
    paramsB: 70,
    license: 'Llama-3.1',
    servedOnFleet: false,
  },
  {
    id: 'llama-3.2-11b-vision',
    name: 'Llama 3.2 11B Vision',
    family: 'Llama',
    contextWindow: 131072,
    modality: 'vision',
    paramsB: 11,
    license: 'Llama-3.2',
    servedOnFleet: false,
  },
  // Gemma
  {
    id: 'gemma-2-9b-it',
    name: 'Gemma 2 9B Instruct',
    family: 'Gemma',
    contextWindow: 8192, // Gemma 2 published 8K context
    modality: 'text',
    paramsB: 9,
    license: 'Gemma',
    servedOnFleet: false,
  },
  {
    id: 'gemma-2-27b-it',
    name: 'Gemma 2 27B Instruct',
    family: 'Gemma',
    contextWindow: 8192,
    modality: 'text',
    paramsB: 27,
    license: 'Gemma',
    servedOnFleet: false,
  },
  // Mistral
  {
    id: 'mistral-7b-instruct',
    name: 'Mistral 7B Instruct v0.3',
    family: 'Mistral',
    contextWindow: 32768, // Mistral 7B v0.3 published 32K context
    modality: 'text',
    paramsB: 7,
    license: 'Apache-2.0',
    servedOnFleet: false,
  },
  {
    id: 'mixtral-8x7b-instruct',
    name: 'Mixtral 8x7B Instruct',
    family: 'Mistral',
    contextWindow: 32768,
    modality: 'text',
    paramsB: 47, // 8x7B MoE, ~46.7B total params
    license: 'Apache-2.0',
    servedOnFleet: false,
  },
  {
    id: 'mistral-small-3.1-24b',
    name: 'Mistral Small 3.1 24B',
    family: 'Mistral',
    contextWindow: 131072, // Mistral Small 3.1 published 128K context
    modality: 'vision',
    paramsB: 24,
    license: 'Apache-2.0',
    servedOnFleet: false,
  },
  // DeepSeek
  {
    id: 'deepseek-r1-distill-qwen-7b',
    name: 'DeepSeek-R1 Distill Qwen 7B',
    family: 'DeepSeek',
    contextWindow: 131072,
    modality: 'text',
    paramsB: 7,
    license: 'MIT',
    servedOnFleet: false,
  },
  // Phi
  {
    id: 'phi-4',
    name: 'Phi-4',
    family: 'Phi',
    contextWindow: 16384, // Phi-4 published 16K context
    modality: 'text',
    paramsB: 14,
    license: 'MIT',
    servedOnFleet: false,
  },
  // Embeddings (OpenAI-compatible names the gateway can speak)
  {
    id: 'nomic-embed-text-v1.5',
    name: 'Nomic Embed Text v1.5',
    family: 'Other',
    contextWindow: 8192, // Nomic Embed published 8K sequence length
    modality: 'embedding',
    paramsB: null,
    license: 'Apache-2.0',
    servedOnFleet: false,
  },
  {
    id: 'bge-m3',
    name: 'BGE-M3',
    family: 'Other',
    contextWindow: 8192,
    modality: 'embedding',
    paramsB: null,
    license: 'MIT',
    servedOnFleet: false,
  },
];

// ─── Lookups & grouping ───────────────────────────────────────────────────────────────────────
export function getModelSpec(id: string, catalog: ModelSpec[] = MODEL_CATALOG): ModelSpec | undefined {
  const needle = id.trim().toLowerCase();
  return catalog.find((m) => m.id.toLowerCase() === needle);
}

/** Group a catalog into `family → specs`, preserving MODEL_FAMILIES order and dropping empty groups. */
export function catalogByFamily(catalog: ModelSpec[] = MODEL_CATALOG): { family: ModelFamily; models: ModelSpec[] }[] {
  return MODEL_FAMILIES.map((family) => ({
    family,
    models: catalog.filter((m) => m.family === family),
  })).filter((g) => g.models.length > 0);
}

/** Group a catalog into `modality → specs`, preserving MODALITIES order and dropping empty groups. */
export function catalogByModality(catalog: ModelSpec[] = MODEL_CATALOG): { modality: Modality; models: ModelSpec[] }[] {
  return MODALITIES.map((modality) => ({
    modality,
    models: catalog.filter((m) => m.modality === modality),
  })).filter((g) => g.models.length > 0);
}

// ─── Filter — the picker's search/facet ─────────────────────────────────────────────────────────
export interface ModelFilter {
  /** Free-text match over id + name + family (case-insensitive). */
  query?: string;
  family?: ModelFamily;
  modality?: Modality;
  /** When true, only fleet-served models. */
  fleetOnly?: boolean;
}

/** Pure predicate + filter over the catalog. All facets AND together; empty/undefined facets match all. */
export function filterCatalog(catalog: ModelSpec[], filter: ModelFilter): ModelSpec[] {
  const q = (filter.query ?? '').trim().toLowerCase();
  return catalog.filter((m) => {
    if (filter.fleetOnly && !m.servedOnFleet) return false;
    if (filter.family && m.family !== filter.family) return false;
    if (filter.modality && m.modality !== filter.modality) return false;
    if (q) {
      const hay = `${m.id} ${m.name} ${m.family}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ─── Fleet-served merge — reconcile the static catalog against the LIVE fleet SSOT ────────────────
// The DB `fleet_nodes.model` routing tags are the live truth. Given the set of tags the fleet is
// actually serving, this returns a catalog where:
//   - a catalog entry whose id matches a live tag → servedOnFleet forced TRUE,
//   - a catalog entry with no matching live tag   → servedOnFleet forced FALSE (even if the static
//     entry claimed true — the DB overrides the static assumption so we never lie about live state),
//   - a live tag with NO catalog entry            → appended as a minimal "served, unknown-spec"
//     entry so the picker surfaces every model the fleet routes to, honestly (specs null).
// Blank/whitespace tags (server nodes carry model='') are ignored. Case-insensitive match.
export function mergeFleetServed(catalog: ModelSpec[], fleetModelTags: readonly string[]): ModelSpec[] {
  const live = new Set(
    fleetModelTags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0),
  );
  const covered = new Set<string>();
  const merged: ModelSpec[] = catalog.map((m) => {
    const isLive = live.has(m.id.toLowerCase());
    if (isLive) covered.add(m.id.toLowerCase());
    return { ...m, servedOnFleet: isLive };
  });
  // Live tags the static catalog doesn't know about → honest minimal entries.
  for (const tag of live) {
    if (covered.has(tag)) continue;
    // Recover the original-cased tag for display (first match), else use the lowercased tag.
    const original = fleetModelTags.find((t) => t.trim().toLowerCase() === tag)?.trim() ?? tag;
    merged.push({
      id: original,
      name: original,
      family: 'Other',
      contextWindow: null,
      modality: 'text',
      paramsB: null,
      license: null,
      servedOnFleet: true,
      note: 'Served by the fleet but not in the curated catalog — spec unknown.',
    });
  }
  return merged;
}

/** The distinct routing tags a fleet-node list is serving (non-blank, deduped, original case). */
export function fleetModelTags(nodes: readonly { model: string; role?: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of nodes) {
    // `server` nodes run infra, not models — skip them.
    if (n.role === 'server') continue;
    const tag = (n.model ?? '').trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}
