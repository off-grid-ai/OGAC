// ─── Kestra catalog adapter (I/O only) ───────────────────────────────────────────────────────────
// Reaches Kestra's plugin/namespace/secret/KV REST API and hands raw JSON to the PURE normalizers in
// src/lib/kestra-catalog.ts. All shaping/validation is pure and unit-tested there; this file only
// does fetch/timeout/IO via the shared kestra-http primitives (same base-URL/auth contract as the
// proven-live kestra.ts flow adapter). Graceful by design: an unreachable or not-yet-provisioned
// engine returns an empty list / a "not configured" result rather than throwing, so the console
// renders an honest state and never fakes success.
//
// Endpoint surface verified LIVE (2026-07) — see kestra-catalog.ts header for the full map:
//   plugins            /api/v1/plugins  +  /api/v1/plugins/{type}        (NOT tenant-scoped)
//   namespaces/secrets/kv are tenant-scoped: /api/v1/{tenant}/namespaces/...
// On this OSS deployment secrets + namespace management are READ-ONLY (405 on writes); the KV API is
// the writable governed per-namespace store, so create/update/delete land there.

import {
  describeKestraError,
  kestraConfigured,
  kestraReq,
  kestraTenant,
} from './kestra-http';
import {
  normalizeKvList,
  normalizeNamespaceList,
  normalizePluginList,
  normalizePluginSchema,
  normalizeSecretCatalog,
  type KvRow,
  type NamespaceRow,
  type PluginGroup,
  type PluginSchema,
  type SecretCatalog,
} from '../kestra-catalog';

// Write envelope so routes can render an honest outcome (mirrors kestra.ts's OrchResult).
export type CatalogResult<T> =
  | { ok: true; value: T }
  | { ok: false; configured: boolean; error: string };

const ns = (n: string) => `/api/v1/${kestraTenant()}/namespaces/${encodeURIComponent(n)}`;

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface KestraCatalogPort {
  configured(): boolean;
  listPlugins(): Promise<PluginGroup[]>;
  getPluginSchema(type: string): Promise<PluginSchema | null>;
  listNamespaces(): Promise<NamespaceRow[]>;
  getNamespace(id: string): Promise<NamespaceRow | null>;
  listSecrets(namespace: string): Promise<SecretCatalog>;
  listKv(namespace: string): Promise<KvRow[]>;
  putKv(namespace: string, key: string, value: string): Promise<CatalogResult<{ key: string }>>;
  deleteKv(namespace: string, key: string): Promise<CatalogResult<{ key: string }>>;
}

export const kestraCatalog: KestraCatalogPort = {
  configured() {
    return kestraConfigured();
  },

  async listPlugins() {
    try {
      const r = await kestraReq('GET', '/api/v1/plugins');
      if (!r.ok) return [];
      return normalizePluginList(parse(r.text));
    } catch (err) {
      console.warn('[orchestration] kestra listPlugins failed:', describeKestraError(err));
      return [];
    }
  },

  async getPluginSchema(type: string) {
    try {
      const r = await kestraReq('GET', `/api/v1/plugins/${encodeURIComponent(type)}`);
      if (!r.ok) return null;
      const body = parse(r.text);
      if (!body) return null;
      return normalizePluginSchema(type, body);
    } catch (err) {
      console.warn('[orchestration] kestra getPluginSchema failed:', describeKestraError(err));
      return null;
    }
  },

  async listNamespaces() {
    try {
      const r = await kestraReq('GET', `/api/v1/${kestraTenant()}/namespaces/search?size=200`);
      if (!r.ok) return [];
      return normalizeNamespaceList(parse(r.text));
    } catch (err) {
      console.warn('[orchestration] kestra listNamespaces failed:', describeKestraError(err));
      return [];
    }
  },

  async getNamespace(id: string) {
    try {
      const r = await kestraReq('GET', ns(id));
      if (!r.ok) return null;
      const rows = normalizeNamespaceList([parse(r.text)]);
      return rows[0] ?? null;
    } catch (err) {
      console.warn('[orchestration] kestra getNamespace failed:', describeKestraError(err));
      return null;
    }
  },

  async listSecrets(namespace: string) {
    try {
      const r = await kestraReq('GET', `${ns(namespace)}/secrets`);
      if (!r.ok) return { readOnly: true, keys: [], total: 0 };
      return normalizeSecretCatalog(parse(r.text));
    } catch (err) {
      console.warn('[orchestration] kestra listSecrets failed:', describeKestraError(err));
      return { readOnly: true, keys: [], total: 0 };
    }
  },

  async listKv(namespace: string) {
    try {
      const r = await kestraReq('GET', `${ns(namespace)}/kv`);
      if (!r.ok) return [];
      return normalizeKvList(parse(r.text));
    } catch (err) {
      console.warn('[orchestration] kestra listKv failed:', describeKestraError(err));
      return [];
    }
  },

  // KV values are stored as STRING via a text/plain PUT (verified live — application/json 415s).
  async putKv(namespace: string, key: string, value: string) {
    try {
      const r = await kestraReq('PUT', `${ns(namespace)}/kv/${encodeURIComponent(key)}`, {
        body: value,
        contentType: 'text/plain',
      });
      if (!r.ok) {
        return {
          ok: false as const,
          configured: true,
          error: `engine ${r.status}${r.text ? `: ${r.text.slice(0, 200)}` : ''}`,
        };
      }
      return { ok: true as const, value: { key } };
    } catch (err) {
      return { ok: false as const, configured: false, error: describeKestraError(err) };
    }
  },

  async deleteKv(namespace: string, key: string) {
    try {
      const r = await kestraReq('DELETE', `${ns(namespace)}/kv/${encodeURIComponent(key)}`);
      // 404 = already gone; idempotent delete treats that as success.
      if (!r.ok && r.status !== 404) {
        return {
          ok: false as const,
          configured: true,
          error: `engine ${r.status}${r.text ? `: ${r.text.slice(0, 200)}` : ''}`,
        };
      }
      return { ok: true as const, value: { key } };
    } catch (err) {
      return { ok: false as const, configured: false, error: describeKestraError(err) };
    }
  },
};
