// ─── Langfuse prompt-management adapter — the I/O port behind an interface ──────────────────────────
//
// The ONLY impure seam for Langfuse-native PROMPT management. It calls the public REST API through the
// shared `langfuse-http` transport and delegates ALL validation/shaping to the pure `langfuse-prompts`
// layer — no rules live here (DRY). Routes/tests depend on the `LangfusePromptsPort` interface;
// `langfusePrompts` is the live implementation. Tests inject a fake port to exercise routes offline.
//
// Wired endpoints:
//   list    → GET    /api/public/v2/prompts?limit=&page=&name=&label=&tag=
//   getMeta → GET    /api/public/v2/prompts?name=<name>&limit=1        (versions + labels for a name)
//   get     → GET    /api/public/v2/prompts/{name}[?version=|?label=]  (one version's body)
//   create  → POST   /api/public/v2/prompts                            (new prompt OR new version)
//   label   → PATCH  /api/public/v2/prompts/{name}/versions/{version}  ({ newLabels })
//   delete  → DELETE /api/public/v2/prompts/{name}[?version=|?label=]
import { langfuseConfigured, langfuseRequest } from '@/lib/langfuse-http';
import {
  type CreatePromptBody,
  type PromptListRow,
  type PromptMetaView,
  type PromptVersionView,
  type RawPrompt,
  type RawPromptMeta,
  buildPromptDeleteQuery,
  buildPromptSelectorQuery,
  shapePromptList,
  shapePromptMeta,
  shapePromptVersion,
} from '@/lib/langfuse-prompts';

interface Paged<T> {
  data: T[];
}

// The detail view a route hands the UI: the name's meta (all versions + labels) + one selected
// version's full body (production/latest/explicit).
export interface PromptDetail {
  meta: PromptMetaView;
  selected: PromptVersionView | null;
}

export interface LangfusePromptsPort {
  /** Env-derived "is Langfuse configured?" — never throws. */
  configured(): boolean;
  /** List prompts (registry index). Optional name/label/tag filters. */
  list(opts?: { limit?: number; name?: string; label?: string; tag?: string }): Promise<PromptListRow[]>;
  /** One prompt's detail: meta + a selected version's body. Returns null meta when the prompt is unknown. */
  detail(name: string, selector?: { version?: number | string | null; label?: string | null }): Promise<PromptDetail | null>;
  /** Create a prompt or a new version (Langfuse upserts by name). Returns the created version. */
  create(body: CreatePromptBody): Promise<PromptVersionView | null>;
  /** Set the labels on a specific version. Returns the updated version. */
  setVersionLabels(name: string, version: number, newLabels: string[]): Promise<PromptVersionView | null>;
  /** Delete a prompt (all versions), one version, or all versions with a label. */
  remove(name: string, selector?: { version?: number | string | null; label?: string | null }): Promise<void>;
}

const enc = encodeURIComponent;

async function fetchMeta(name: string): Promise<RawPromptMeta | null> {
  const json = await langfuseRequest<Paged<RawPromptMeta>>({
    method: 'GET',
    path: `/api/public/v2/prompts?name=${enc(name)}&limit=1`,
  });
  return json.data?.[0] ?? null;
}

export const langfusePrompts: LangfusePromptsPort = {
  configured: () => langfuseConfigured(),

  async list(opts) {
    const qs = new URLSearchParams({ limit: String(Math.min(opts?.limit ?? 100, 100)) });
    if (opts?.name) qs.set('name', opts.name);
    if (opts?.label) qs.set('label', opts.label);
    if (opts?.tag) qs.set('tag', opts.tag);
    const json = await langfuseRequest<Paged<RawPromptMeta>>({
      method: 'GET',
      path: `/api/public/v2/prompts?${qs.toString()}`,
    });
    return shapePromptList(json.data ?? []);
  },

  async detail(name, selector) {
    const metaRaw = await fetchMeta(name);
    const meta = shapePromptMeta(metaRaw);
    if (!meta) return null;
    const query = buildPromptSelectorQuery(selector);
    let selected: PromptVersionView | null = null;
    try {
      const raw = await langfuseRequest<RawPrompt>({
        method: 'GET',
        path: `/api/public/v2/prompts/${enc(name)}${query ? `?${query}` : ''}`,
      });
      selected = shapePromptVersion(raw);
    } catch {
      // A name with versions but no matching production/selected label still renders its meta; the
      // body is simply absent (the UI prompts to pick a version).
      selected = null;
    }
    return { meta, selected };
  },

  async create(body) {
    const raw = await langfuseRequest<RawPrompt>({
      method: 'POST',
      path: '/api/public/v2/prompts',
      body,
    });
    return shapePromptVersion(raw);
  },

  async setVersionLabels(name, version, newLabels) {
    const raw = await langfuseRequest<RawPrompt>({
      method: 'PATCH',
      path: `/api/public/v2/prompts/${enc(name)}/versions/${version}`,
      body: { newLabels },
    });
    return shapePromptVersion(raw);
  },

  async remove(name, selector) {
    const query = buildPromptDeleteQuery(selector);
    await langfuseRequest<null>({
      method: 'DELETE',
      path: `/api/public/v2/prompts/${enc(name)}${query ? `?${query}` : ''}`,
    });
  },
};
