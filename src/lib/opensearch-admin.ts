// PURE response shaping for the OpenSearch INDEX-ADMIN + SECURITY-ANALYTICS surfaces. Zero I/O —
// fully unit-testable in isolation. The thin network shell that GETs these against OpenSearch's
// `_index_template`, `_alias`, and `_plugins/_security_analytics/*` APIs lives in
// `adapters/opensearch-admin.ts`; this file never fetches.
//
// It complements `opensearch-alerting-shape.ts` (monitors + ISM policies): that file OWNS the
// writable lifecycle policy; this file adds the READ-ONLY index-lifecycle context around it —
// index TEMPLATES (what mappings/settings/rollover-alias a new audit index inherits) and ALIASES
// (which physical index the write-alias currently points at) — plus SECURITY-ANALYTICS DETECTORS
// (native threat detection over the audit/gateway indices) and their firing state (active alerts).
//
// The plugin-availability probe (`isPluginUnsupported`) is REUSED from opensearch-alerting-shape so
// the "honest not-enabled" contract is defined once (DRY).
import { isPluginUnsupported } from '@/lib/opensearch-alerting-shape';

export { isPluginUnsupported };

// ── shared tiny helpers ────────────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Coerce a setting that OpenSearch may return as a number OR a numeric string; null when absent. */
function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** epoch-ms (number or numeric string) → ISO string; null when absent/unparseable. */
export function epochMsToIso(v: unknown): string | null {
  const n = numOrNull(v);
  if (n == null || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── index templates ──────────────────────────────────────────────────────────────────────────────

/** A composable/index template as read back from `GET _index_template` (flattened for display). */
export interface IndexTemplateSummary {
  name: string;
  indexPatterns: string[];
  priority: number | null;
  numberOfShards: number | null;
  numberOfReplicas: number | null;
  /** Count of top-level mapping properties defined on the template (0 when none). */
  mappedFields: number;
  /** Component templates this one composes, in order. */
  composedOf: string[];
  /** The ISM rollover_alias bound in settings, if any — ties the template to a retention policy. */
  rolloverAlias: string | null;
  /** Whether the template backs a data stream. */
  dataStream: boolean;
}

/**
 * Read a settings value that OpenSearch may return either NESTED (`index.number_of_shards`) or as a
 * FLATTENED dotted key (`"index.number_of_shards"`). Tries the flattened key first, then walks the
 * nested path. Returns undefined when neither is present.
 */
function readSetting(settings: Record<string, unknown>, path: string): unknown {
  if (path in settings) return settings[path];
  let cur: unknown = settings;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function flattenTemplate(name: string, tpl: Record<string, unknown>): IndexTemplateSummary {
  const template = (tpl.template ?? {}) as Record<string, unknown>;
  const settings = (template.settings ?? {}) as Record<string, unknown>;
  const mappings = (template.mappings ?? {}) as Record<string, unknown>;
  const props = (mappings.properties ?? {}) as Record<string, unknown>;
  const patterns = Array.isArray(tpl.index_patterns)
    ? tpl.index_patterns.map((p) => str(p)).filter(Boolean)
    : [];
  const composed = Array.isArray(tpl.composed_of)
    ? tpl.composed_of.map((c) => str(c)).filter(Boolean)
    : [];
  const rollover = readSetting(
    settings,
    'index.plugins.index_state_management.rollover_alias',
  );
  return {
    name,
    indexPatterns: patterns,
    priority: numOrNull(tpl.priority),
    numberOfShards: numOrNull(readSetting(settings, 'index.number_of_shards')),
    numberOfReplicas: numOrNull(readSetting(settings, 'index.number_of_replicas')),
    mappedFields: Object.keys(props).length,
    composedOf: composed,
    rolloverAlias: str(rollover) || null,
    dataStream: tpl.data_stream != null,
  };
}

/** Parse a `GET _index_template` response into flat summaries, name-sorted. */
export function parseIndexTemplates(
  json: { index_templates?: { name?: string; index_template?: Record<string, unknown> }[] } | null | undefined,
): IndexTemplateSummary[] {
  const list = Array.isArray(json?.index_templates) ? json.index_templates : [];
  return list
    .map((e) => flattenTemplate(str(e?.name), (e?.index_template ?? {}) as Record<string, unknown>))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── aliases ────────────────────────────────────────────────────────────────────────────────────

/** One physical index that an alias points at. */
export interface AliasMember {
  index: string;
  isWriteIndex: boolean;
}

/** An alias as read back from `GET _alias` (inverted from index→aliases to alias→indices). */
export interface AliasSummary {
  alias: string;
  members: AliasMember[];
  /** True when the alias name begins with '.' (an OpenSearch system alias). */
  system: boolean;
}

/**
 * Parse a `GET _alias` response. OpenSearch returns `{ <index>: { aliases: { <alias>: {...} } } }`;
 * we INVERT it to `alias → [{ index, isWriteIndex }]` so the operator sees, per alias, which physical
 * indices back it and which is the current write target. Indices with no aliases are skipped.
 */
export function parseAliases(
  json: Record<string, { aliases?: Record<string, { is_write_index?: unknown }> }> | null | undefined,
): AliasSummary[] {
  const byAlias = new Map<string, AliasMember[]>();
  for (const [index, body] of Object.entries(json ?? {})) {
    const aliases = body?.aliases ?? {};
    for (const [alias, meta] of Object.entries(aliases)) {
      const members = byAlias.get(alias) ?? [];
      members.push({ index, isWriteIndex: meta?.is_write_index === true });
      byAlias.set(alias, members);
    }
  }
  return [...byAlias.entries()]
    .map(([alias, members]) => ({
      alias,
      members: members.sort((a, b) => a.index.localeCompare(b.index)),
      system: alias.startsWith('.'),
    }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}

// ── security-analytics detectors ─────────────────────────────────────────────────────────────────

/** A threat-detection detector as read back from `_plugins/_security_analytics/detectors/_search`. */
export interface DetectorSummary {
  id: string;
  name: string;
  enabled: boolean;
  detectorType: string;
  /** Indices (or patterns) the detector monitors. */
  indices: string[];
  customRuleCount: number;
  prePackagedRuleCount: number;
  triggerCount: number;
  lastUpdate: string | null;
  /** Firing state — active alert count for this detector, merged from the alerts API (0 by default). */
  activeAlerts: number;
  acknowledgedAlerts: number;
}

interface RawDetectorHit {
  _id?: string;
  _source?: Record<string, unknown>;
}

function flattenDetector(hit: RawDetectorHit): DetectorSummary {
  const s = hit._source ?? {};
  const inputs = Array.isArray(s.inputs) ? (s.inputs as Record<string, unknown>[]) : [];
  const di = (inputs[0]?.detector_input ?? {}) as Record<string, unknown>;
  const indices = Array.isArray(di.indices) ? di.indices.map((i) => str(i)).filter(Boolean) : [];
  const custom = Array.isArray(di.custom_rules) ? di.custom_rules.length : 0;
  const prePackaged = Array.isArray(di.pre_packaged_rules) ? di.pre_packaged_rules.length : 0;
  const triggers = Array.isArray(s.triggers) ? s.triggers.length : 0;
  return {
    id: str(hit._id),
    name: str(s.name),
    enabled: s.enabled === true,
    detectorType: str(s.detector_type),
    indices,
    customRuleCount: custom,
    prePackagedRuleCount: prePackaged,
    triggerCount: triggers,
    lastUpdate: epochMsToIso(s.last_update_time),
    activeAlerts: 0,
    acknowledgedAlerts: 0,
  };
}

/** Parse a detector `_search` response (hits envelope) into flat summaries, name-sorted. */
export function parseDetectors(
  json: { hits?: { hits?: RawDetectorHit[] } } | null | undefined,
): DetectorSummary[] {
  const hits = json?.hits?.hits ?? [];
  return hits.map(flattenDetector).sort((a, b) => a.name.localeCompare(b.name));
}

/** Per-detector alert tally recovered from the alerts API. */
export interface DetectorAlertCounts {
  active: number;
  acknowledged: number;
}

interface RawAlert {
  detector_id?: unknown;
  detectorId?: unknown;
  state?: unknown;
}

/**
 * Parse a `_plugins/_security_analytics/alerts` response into a per-detector tally. An alert's state
 * is `ACTIVE` / `ACKNOWLEDGED` / `COMPLETED` / `ERROR`; we count ACTIVE and ACKNOWLEDGED (the two an
 * operator acts on). Keyed by `detector_id` (OpenSearch also uses camelCase `detectorId` in places).
 */
export function parseDetectorAlerts(
  json: { alerts?: RawAlert[] } | null | undefined,
): Map<string, DetectorAlertCounts> {
  const out = new Map<string, DetectorAlertCounts>();
  const alerts = Array.isArray(json?.alerts) ? json.alerts : [];
  for (const a of alerts) {
    const id = str(a.detector_id) || str(a.detectorId);
    if (!id) continue;
    const state = str(a.state).toUpperCase();
    const cur = out.get(id) ?? { active: 0, acknowledged: 0 };
    if (state === 'ACTIVE') cur.active += 1;
    else if (state === 'ACKNOWLEDGED') cur.acknowledged += 1;
    out.set(id, cur);
  }
  return out;
}

/** Merge alert counts into detector summaries (pure join on detector id). Non-mutating. */
export function mergeDetectorAlerts(
  detectors: DetectorSummary[],
  counts: Map<string, DetectorAlertCounts>,
): DetectorSummary[] {
  return detectors.map((d) => {
    const c = counts.get(d.id);
    return c ? { ...d, activeAlerts: c.active, acknowledgedAlerts: c.acknowledged } : d;
  });
}
