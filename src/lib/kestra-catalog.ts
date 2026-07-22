// ─── Kestra catalog — PURE, zero-IO normalizers + validators (SOLID: no fetch/env/db) ───────────
// The orchestration engine (Kestra) exposes its installed plugin ecosystem, namespaces, secret keys
// and per-namespace key/value store over a REST API. This module is the PURE layer that turns those
// raw API envelopes into typed rows the routes/UI consume, and validates the names/keys an operator
// supplies before a write is dispatched. It NEVER talks to the network — the adapter
// (src/lib/adapters/kestra-catalog.ts) does the I/O and hands raw JSON here. This keeps the shaping
// unit-testable against fixtures with no live box (mirrors etl-kestra-compile.ts).
//
// Verified LIVE against the deployed Kestra OSS API (2026-07):
//   GET /api/v1/plugins                       → PluginGroup[] (200 groups, 1235 task types)
//   GET /api/v1/plugins/{type}                → { markdown, schema:{ properties, outputs, ... } }
//   GET /api/v1/{tenant}/namespaces/search    → { results:[{id}], total }
//   GET /api/v1/{tenant}/namespaces/{ns}       → { id }
//   GET /api/v1/{tenant}/namespaces/{ns}/secrets → { readOnly:true, results:[...], total }  (READ-ONLY)
//   GET/PUT/DELETE /api/v1/{tenant}/namespaces/{ns}/kv[/{key}]                       (FULL CRUD)
// On this OSS deployment secrets AND namespace management are read-only (POST/PUT/DELETE → 405);
// the writable governed per-namespace store is the KV API. The product language never leaks "Kestra".

// ── normalized shapes the routes/UI consume ──────────────────────────────────────────────────────

// A single composable task/trigger/condition type inside a plugin group (fully-qualified class name).
export interface PluginType {
  cls: string; // e.g. io.kestra.plugin.core.log.Log
  title: string;
  description: string;
  deprecated: boolean;
}

// A plugin group as installed on the engine (Slack, HTTP, AWS, dbt, …).
export interface PluginGroup {
  group: string; // e.g. io.kestra.plugin.core
  name: string;
  title: string;
  categories: string[];
  taskCount: number;
  triggerCount: number;
  conditionCount: number;
  tasks: PluginType[];
  triggers: PluginType[];
  conditions: PluginType[];
}

// One input property of a plugin task's schema.
export interface PluginSchemaProperty {
  name: string;
  type: string; // json-schema type or 'object'/'array'/'—' when unspecified
  title: string;
  description: string;
  required: boolean;
}

// The browsable input schema of a single plugin task type.
export interface PluginSchema {
  type: string; // the fully-qualified class the schema describes
  title: string;
  description: string;
  properties: PluginSchemaProperty[];
  required: string[];
  outputs: PluginSchemaProperty[];
}

export interface NamespaceRow {
  id: string;
}

// Secret keys are surfaced by KEY only — values are never returned by the API and never shown.
export interface SecretCatalog {
  readOnly: boolean;
  keys: string[];
  total: number;
}

export interface KvRow {
  namespace: string;
  key: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

// ── small coercers (keep the normalizers terse + defensive against partial API rows) ─────────────
function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function asString(v: unknown): string {
  return v == null ? '' : String(v);
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// Kestra list envelopes are either a bare array or `{ results: [...] }`. One helper, reused.
export function unwrapResults(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const r = asRecord(raw);
  return Array.isArray(r.results) ? r.results : [];
}

// ── plugin catalog ────────────────────────────────────────────────────────────────────────────

function normalizePluginType(raw: unknown): PluginType | null {
  const r = asRecord(raw);
  const cls = asString(r.cls);
  if (!cls) return null;
  return {
    cls,
    title: asString(r.title),
    description: asString(r.description),
    deprecated: r.deprecated === true,
  };
}

function normalizeTypeList(raw: unknown): PluginType[] {
  return asArray(raw)
    .map(normalizePluginType)
    .filter((t): t is PluginType => t !== null);
}

// Normalize `GET /api/v1/plugins` → typed groups. A group with no id (`group`) is dropped; empty
// groups (no tasks/triggers/conditions) are dropped so the catalog only lists actionable plugins.
export function normalizePluginList(raw: unknown): PluginGroup[] {
  return asArray(raw)
    .map((g): PluginGroup | null => {
      const r = asRecord(g);
      const group = asString(r.group);
      if (!group) return null;
      const tasks = normalizeTypeList(r.tasks);
      const triggers = normalizeTypeList(r.triggers);
      const conditions = normalizeTypeList(r.conditions);
      if (tasks.length + triggers.length + conditions.length === 0) return null;
      const categories = asArray(r.categories).map(asString).filter(Boolean);
      return {
        group,
        name: asString(r.name) || group,
        title: asString(r.title) || asString(r.name) || group,
        categories,
        taskCount: tasks.length,
        triggerCount: triggers.length,
        conditionCount: conditions.length,
        tasks,
        triggers,
        conditions,
      };
    })
    .filter((g): g is PluginGroup => g !== null)
    .sort((a, b) => a.title.localeCompare(b.title));
}

// Aggregate totals for the catalog header (installed plugins + composable action count).
export interface PluginCatalogSummary {
  groups: number;
  tasks: number;
  triggers: number;
  conditions: number;
}
export function summarizePluginCatalog(groups: PluginGroup[]): PluginCatalogSummary {
  return groups.reduce<PluginCatalogSummary>(
    (acc, g) => ({
      groups: acc.groups + 1,
      tasks: acc.tasks + g.taskCount,
      triggers: acc.triggers + g.triggerCount,
      conditions: acc.conditions + g.conditionCount,
    }),
    { groups: 0, tasks: 0, triggers: 0, conditions: 0 },
  );
}

// Find one plugin group by its fully-qualified group id (for the group detail view).
export function findPluginGroup(groups: PluginGroup[], groupId: string): PluginGroup | null {
  return groups.find((g) => g.group === groupId) ?? null;
}

// Case-insensitive text filter over a group's identity + its task/trigger titles (catalog search).
export function pluginGroupMatches(g: PluginGroup, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (g.title.toLowerCase().includes(q)) return true;
  if (g.group.toLowerCase().includes(q)) return true;
  if (g.categories.some((c) => c.toLowerCase().includes(q))) return true;
  const inTypes = (ts: PluginType[]) =>
    ts.some((t) => t.cls.toLowerCase().includes(q) || t.title.toLowerCase().includes(q));
  return inTypes(g.tasks) || inTypes(g.triggers) || inTypes(g.conditions);
}

export function filterPluginGroups(groups: PluginGroup[], query: string): PluginGroup[] {
  return groups.filter((g) => pluginGroupMatches(g, query));
}

// ── plugin task schema ──────────────────────────────────────────────────────────────────────────

function normalizeSchemaProps(
  propsBag: Record<string, unknown>,
  required: Set<string>,
): PluginSchemaProperty[] {
  return Object.entries(propsBag)
    .map(([name, def]) => {
      const d = asRecord(def);
      const rawType = d.type;
      const type = rawType == null ? '—' : asString(rawType);
      return {
        name,
        type,
        title: asString(d.title),
        description: asString(d.description),
        required: required.has(name),
      };
    })
    .sort((a, b) => {
      // required properties first, then alphabetical — the most useful reading order for an operator.
      if (a.required !== b.required) return a.required ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

// Normalize `GET /api/v1/plugins/{type}` → a browsable schema. The raw `markdown` (a large base64
// icon + prose) is intentionally DROPPED — the UI renders the structured properties, not the blob.
export function normalizePluginSchema(cls: string, raw: unknown): PluginSchema {
  const root = asRecord(raw);
  const schema = asRecord(root.schema);
  const props = asRecord(schema.properties); // json-schema wrapper: { $schema, properties, required, title, description }
  const inputBag = asRecord(props.properties);
  const required = asArray(props.required).map(asString).filter(Boolean);
  const requiredSet = new Set(required);
  const outputWrapper = asRecord(schema.outputs);
  const outputBag = asRecord(outputWrapper.properties);
  return {
    type: cls,
    title: asString(props.title) || cls,
    description: asString(props.description),
    properties: normalizeSchemaProps(inputBag, requiredSet),
    required,
    outputs: normalizeSchemaProps(outputBag, new Set()),
  };
}

// ── namespaces ────────────────────────────────────────────────────────────────────────────────

export function normalizeNamespaceList(raw: unknown): NamespaceRow[] {
  return unwrapResults(raw)
    .map((n): NamespaceRow | null => {
      const id = asString(asRecord(n).id);
      return id ? { id } : null;
    })
    .filter((n): n is NamespaceRow => n !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ── secrets (READ-ONLY: keys only, never values) ─────────────────────────────────────────────────

export function normalizeSecretCatalog(raw: unknown): SecretCatalog {
  const r = asRecord(raw);
  const keys = unwrapResults(raw)
    .map((s) => {
      // Kestra returns either a bare string key or an object carrying a `key`.
      if (typeof s === 'string') return s;
      return asString(asRecord(s).key);
    })
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const total = typeof r.total === 'number' ? r.total : keys.length;
  return { readOnly: r.readOnly !== false, keys, total };
}

// ── key/value store (FULL CRUD) ──────────────────────────────────────────────────────────────────

export function normalizeKvList(raw: unknown): KvRow[] {
  return asArray(raw)
    .map((row): KvRow | null => {
      const r = asRecord(row);
      const key = asString(r.key);
      if (!key) return null;
      return {
        namespace: asString(r.namespace),
        key,
        version: typeof r.version === 'number' ? r.version : undefined,
        createdAt: r.creationDate != null ? asString(r.creationDate) : undefined,
        updatedAt: r.updateDate != null ? asString(r.updateDate) : undefined,
      };
    })
    .filter((r): r is KvRow => r !== null)
    .sort((a, b) => a.key.localeCompare(b.key));
}

// ── validators (guard every write BEFORE it reaches the engine) ───────────────────────────────────

export interface Valid {
  ok: boolean;
  error?: string;
}

// Namespaces are dotted identifiers (offgrid.etl). Constrain to the safe charset Kestra accepts and
// bound the length, so a malformed name can never be interpolated into an API path.
const NAMESPACE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
export function validateNamespaceName(name: unknown): Valid {
  const s = typeof name === 'string' ? name.trim() : '';
  if (!s) return { ok: false, error: 'namespace is required' };
  if (s.length > 150) return { ok: false, error: 'namespace must be 150 characters or fewer' };
  if (!NAMESPACE_RE.test(s)) {
    return {
      ok: false,
      error: 'namespace may contain only letters, digits, dot, underscore and hyphen, and must not start with a separator',
    };
  }
  return { ok: true };
}

// KV keys are single path segments; forbid path separators and the reserved charset so a key can
// never traverse the API path. Kestra keys accept letters/digits/dot/underscore/hyphen.
const KV_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
export function validateKvKey(key: unknown): Valid {
  const s = typeof key === 'string' ? key.trim() : '';
  if (!s) return { ok: false, error: 'key is required' };
  if (s.length > 200) return { ok: false, error: 'key must be 200 characters or fewer' };
  if (!KV_KEY_RE.test(s)) {
    return {
      ok: false,
      error: 'key may contain only letters, digits, dot, underscore and hyphen, and must not start with a separator',
    };
  }
  return { ok: true };
}

// A KV value must be a non-empty string (the engine stores STRING values via text/plain PUT).
export function validateKvValue(value: unknown): Valid {
  if (typeof value !== 'string') return { ok: false, error: 'value must be a string' };
  if (value.length === 0) return { ok: false, error: 'value is required' };
  if (value.length > 100_000) return { ok: false, error: 'value must be 100000 characters or fewer' };
  return { ok: true };
}

// Combined guard used by the KV write route: both key and value must pass. Returns the FIRST error.
export function validateKvWrite(key: unknown, value: unknown): Valid {
  const k = validateKvKey(key);
  if (!k.ok) return k;
  return validateKvValue(value);
}
