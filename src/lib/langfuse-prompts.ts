// PURE prompt-management logic for the Langfuse-native prompt registry — ZERO imports, ZERO I/O.
//
// This is the brain behind the Langfuse prompt adapter (`src/lib/adapters/langfuse-prompts.ts`): it
// validates operator input (prompt name / label rules, chat-message shape), shapes request bodies for
// the Langfuse public API (`POST /api/public/v2/prompts`, the version-label PATCH), builds the
// selector query for `GET /api/public/v2/prompts/{name}`, and normalizes the API's JSON into stable
// display models. No fetch lives here — one rule, one place, fully unit-testable with no network.
//
// Langfuse prompt model (v2 public API): a prompt is a NAME with N integer versions; each version is
// either a `text` prompt (a string body) or a `chat` prompt (an ordered list of {role,content}). Zero
// or more deployment LABELS point at exactly one version each (unique across versions); `production`
// is the conventional live label. `latest` is reserved + managed by Langfuse — never settable.

// ── Types (public contract) ────────────────────────────────────────────────────────────────────
export type PromptType = 'text' | 'chat';

/** A chat message as the operator enters / the API returns it. */
export interface ChatMessage {
  role: string;
  content: string;
}

/** Reserved labels Langfuse manages itself — an operator may never set these. */
export const RESERVED_LABELS = ['latest'] as const;

/** The conventional "this version is live" deployment label. */
export const PRODUCTION_LABEL = 'production';

const MAX_NAME_LEN = 255;
const MAX_LABEL_LEN = 100;
// Langfuse label rule: lowercase alphanumerics + `.`/`-`/`_`, must start alphanumeric. Deterministic
// so the console rejects a bad label BEFORE a round-trip that would 400.
const LABEL_RE = /^[a-z0-9][a-z0-9._-]*$/;
// Control characters (U+0000–U+001F) are never valid in a prompt name.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f]/;

// ── Raw API shapes (mirror the Langfuse OpenAPI) ─────────────────────────────────────────────────
export interface RawPromptMeta {
  name?: string | null;
  type?: string | null;
  versions?: number[] | null;
  labels?: string[] | null;
  tags?: string[] | null;
  lastUpdatedAt?: string | null;
  lastConfig?: unknown;
}

export interface RawPrompt {
  name?: string | null;
  version?: number | null;
  type?: string | null;
  /** text prompts: a string; chat prompts: an array of {role,content}. */
  prompt?: unknown;
  config?: unknown;
  labels?: string[] | null;
  tags?: string[] | null;
  commitMessage?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

// ── Display models ───────────────────────────────────────────────────────────────────────────────
export interface PromptListRow {
  name: string;
  type: PromptType;
  latestVersion: number | null;
  versionCount: number;
  labels: string[];
  tags: string[];
  updatedAt: string;
}

export interface PromptVersionView {
  name: string;
  version: number;
  type: PromptType;
  labels: string[];
  tags: string[];
  commitMessage: string;
  isProduction: boolean;
  /** For text prompts: the body string. Empty for chat prompts. */
  text: string;
  /** For chat prompts: the ordered messages. Empty for text prompts. */
  messages: ChatMessage[];
  config: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface PromptMetaView {
  name: string;
  type: PromptType;
  latestVersion: number | null;
  versions: number[];
  labels: string[];
  tags: string[];
  updatedAt: string;
}

// A discriminated validation result reused across every validator here.
export type Valid<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): Valid<T> {
  return { ok: true, value };
}
function err<T>(error: string): Valid<T> {
  return { ok: false, error };
}

// ── Validation ─────────────────────────────────────────────────────────────────────────────────
/**
 * Validate a prompt name (pure). Non-empty after trim, ≤255 chars, no control characters. Folder
 * paths ("team/summarizer") are allowed — Langfuse treats `/` as a folder separator. Returns the
 * trimmed name on success.
 */
export function validatePromptName(raw: string | null | undefined): Valid<string> {
  const name = (raw ?? '').trim();
  if (!name) return err('Prompt name is required');
  if (name.length > MAX_NAME_LEN) return err(`Prompt name must be ≤ ${MAX_NAME_LEN} characters`);
  if (CONTROL_RE.test(name)) return err('Prompt name contains control characters');
  return ok(name);
}

/**
 * Validate ONE deployment label (pure). Rejects the reserved `latest`, enforces the lowercase
 * alnum/-/_ rule and length. Returns the label unchanged on success.
 */
export function validateLabel(raw: string | null | undefined): Valid<string> {
  const label = (raw ?? '').trim();
  if (!label) return err('Label is required');
  if (label.length > MAX_LABEL_LEN) return err(`Label must be ≤ ${MAX_LABEL_LEN} characters`);
  if ((RESERVED_LABELS as readonly string[]).includes(label))
    return err(`"${label}" is a reserved label managed by Langfuse`);
  if (!LABEL_RE.test(label)) return err('Label must be lowercase alphanumeric, may contain . _ -');
  return ok(label);
}

/**
 * Validate + normalize a set of labels (pure): trims, drops blanks, de-duplicates (order-preserving),
 * and fails on the first invalid label. Returns the clean list (possibly empty).
 */
export function validateLabels(raw: unknown): Valid<string[]> {
  if (raw == null) return ok([]);
  if (!Array.isArray(raw)) return err('labels must be an array');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const label = typeof item === 'string' ? item.trim() : '';
    if (!label) continue;
    const v = validateLabel(label);
    if (!v.ok) return err(v.error);
    if (!seen.has(v.value)) {
      seen.add(v.value);
      out.push(v.value);
    }
  }
  return ok(out);
}

/** Normalize a free-form tag list (pure): trim, drop blanks, de-dup. Tags are unconstrained text. */
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const t = typeof item === 'string' ? item.trim() : '';
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Validate chat messages (pure). Requires a non-empty array where each entry has a non-empty role
 * and a string content. Returns the cleaned messages (roles trimmed).
 */
export function validateChatMessages(raw: unknown): Valid<ChatMessage[]> {
  if (!Array.isArray(raw) || raw.length === 0)
    return err('A chat prompt needs at least one message');
  const out: ChatMessage[] = [];
  for (const [i, m] of raw.entries()) {
    const msg = m as { role?: unknown; content?: unknown };
    const role = typeof msg?.role === 'string' ? msg.role.trim() : '';
    if (!role) return err(`Message ${i + 1}: role is required`);
    if (typeof msg?.content !== 'string') return err(`Message ${i + 1}: content must be a string`);
    out.push({ role, content: msg.content });
  }
  return ok(out);
}

// ── Request-body shaping ───────────────────────────────────────────────────────────────────────
export interface CreatePromptInput {
  name?: string | null;
  type?: string | null;
  /** text prompt body */
  text?: string | null;
  /** chat prompt messages */
  messages?: unknown;
  labels?: unknown;
  tags?: unknown;
  config?: unknown;
  commitMessage?: string | null;
}

/** The exact body `POST /api/public/v2/prompts` accepts (text or chat variant). */
export type CreatePromptBody =
  | {
      type: 'text';
      name: string;
      prompt: string;
      labels: string[];
      tags: string[];
      config?: unknown;
      commitMessage?: string;
    }
  | {
      type: 'chat';
      name: string;
      prompt: ChatMessage[];
      labels: string[];
      tags: string[];
      config?: unknown;
      commitMessage?: string;
    };

/**
 * Validate + shape a create-prompt request body (pure). Creating with an existing name creates a NEW
 * VERSION — the console surfaces both as "save". Validates name, type, the body for the type, and the
 * labels; normalizes tags; passes config through untouched. Returns the API-ready body or an error.
 */
export function buildCreatePromptBody(input: CreatePromptInput): Valid<CreatePromptBody> {
  const nameV = validatePromptName(input.name);
  if (!nameV.ok) return err(nameV.error);

  const type = (input.type ?? 'text') as PromptType;
  if (type !== 'text' && type !== 'chat') return err('type must be "text" or "chat"');

  const labelsV = validateLabels(input.labels);
  if (!labelsV.ok) return err(labelsV.error);
  const tags = normalizeTags(input.tags);
  const commitMessage = (input.commitMessage ?? '').trim() || undefined;

  const base = {
    name: nameV.value,
    labels: labelsV.value,
    tags,
    ...(input.config !== undefined && input.config !== null ? { config: input.config } : {}),
    ...(commitMessage ? { commitMessage } : {}),
  };

  if (type === 'text') {
    const text = input.text ?? '';
    if (typeof text !== 'string' || text.trim() === '')
      return err('A text prompt needs a non-empty body');
    return ok({ type: 'text', prompt: text, ...base });
  }

  const msgsV = validateChatMessages(input.messages);
  if (!msgsV.ok) return err(msgsV.error);
  return ok({ type: 'chat', prompt: msgsV.value, ...base });
}

/**
 * Shape the version-label PATCH body (pure). `PATCH /api/public/v2/prompts/{name}/versions/{version}`
 * takes `{ newLabels }` and SETS that version's labels (Langfuse moves a label off other versions
 * automatically since labels are unique). Validates + de-dups the labels.
 */
export function buildLabelUpdateBody(raw: unknown): Valid<{ newLabels: string[] }> {
  const v = validateLabels(raw);
  if (!v.ok) return err(v.error);
  return ok({ newLabels: v.value });
}

/**
 * Compute the new label set for a version when an operator ADDS a label (pure). Used by the
 * "promote to <label>" action: union the version's current labels with the added one, de-duped.
 * Because Langfuse enforces label uniqueness across versions server-side, sending this set to the
 * target version's PATCH moves the label there. Validates the added label.
 */
export function addLabelToSet(current: unknown, add: string): Valid<string[]> {
  const addV = validateLabel(add);
  if (!addV.ok) return err(addV.error);
  const currentV = validateLabels(current);
  if (!currentV.ok) return err(currentV.error);
  const set = currentV.value.includes(addV.value)
    ? currentV.value
    : [...currentV.value, addV.value];
  return ok(set);
}

/** Compute a version's labels with `remove` taken out (pure). For the "unset label" action. */
export function removeLabelFromSet(current: unknown, remove: string): string[] {
  const v = validateLabels(current);
  const list = v.ok ? v.value : [];
  return list.filter((l) => l !== remove.trim());
}

// ── Selector query (GET a specific version) ──────────────────────────────────────────────────────
/**
 * Build the query string for `GET /api/public/v2/prompts/{name}` (pure). A specific `version` wins;
 * else a `label`; else nothing (Langfuse defaults to the `production` label). Returns a query string
 * WITHOUT the leading `?` (empty when neither is set).
 */
export function buildPromptSelectorQuery(selector?: {
  version?: number | string | null;
  label?: string | null;
}): string {
  const qs = new URLSearchParams();
  const version = selector?.version;
  if (version !== undefined && version !== null && `${version}`.trim() !== '') {
    const n = Number(version);
    if (Number.isInteger(n) && n > 0) qs.set('version', String(n));
  } else if (selector?.label && selector.label.trim()) {
    qs.set('label', selector.label.trim());
  }
  return qs.toString();
}

// ── Delete selector ──────────────────────────────────────────────────────────────────────────────
/**
 * Build the query string for `DELETE /api/public/v2/prompts/{name}` (pure). With no version/label it
 * deletes ALL versions; a version deletes just that version; a label deletes versions with that label.
 * Returns the query string without a leading `?`.
 */
export function buildPromptDeleteQuery(selector?: {
  version?: number | string | null;
  label?: string | null;
}): string {
  const qs = new URLSearchParams();
  const version = selector?.version;
  if (version !== undefined && version !== null && `${version}`.trim() !== '') {
    const n = Number(version);
    if (Number.isInteger(n) && n > 0) qs.set('version', String(n));
  }
  if (selector?.label && selector.label.trim()) qs.set('label', selector.label.trim());
  return qs.toString();
}

// ── Normalization (API JSON → display models) ────────────────────────────────────────────────────
function coerceType(raw: unknown): PromptType {
  return raw === 'chat' ? 'chat' : 'text';
}

function strList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Shape prompt-registry list rows into a stable display model, newest-updated first (pure). Tolerant
 * of nulls — Langfuse omits labels/tags on bare prompts. `latestVersion` is the max version number.
 */
export function shapePromptList(rows: RawPromptMeta[]): PromptListRow[] {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => {
      const versions = (r.versions ?? []).filter((v): v is number => typeof v === 'number');
      return {
        name: (r.name ?? '').trim() || 'unnamed',
        type: coerceType(r.type),
        latestVersion: versions.length ? Math.max(...versions) : null,
        versionCount: versions.length,
        labels: strList(r.labels),
        tags: strList(r.tags),
        updatedAt: (r.lastUpdatedAt ?? '').trim(),
      };
    })
    .sort((a, b) => {
      if (a.updatedAt < b.updatedAt) return 1;
      if (a.updatedAt > b.updatedAt) return -1;
      return a.name.localeCompare(b.name);
    });
}

/** Shape ONE prompt-registry meta row into the detail-header view (pure). Versions sorted desc. */
export function shapePromptMeta(row: RawPromptMeta | null | undefined): PromptMetaView | null {
  if (!row) return null;
  const versions = (row.versions ?? [])
    .filter((v): v is number => typeof v === 'number')
    .sort((a, b) => b - a);
  return {
    name: (row.name ?? '').trim() || 'unnamed',
    type: coerceType(row.type),
    latestVersion: versions.length ? versions[0] : null,
    versions,
    labels: strList(row.labels),
    tags: strList(row.tags),
    updatedAt: (row.lastUpdatedAt ?? '').trim(),
  };
}

/**
 * Normalize a single prompt VERSION (the `GET /prompts/{name}` response) into a display view (pure).
 * Splits the body by type: text → `text`, chat → `messages`. `isProduction` reflects the labels.
 */
export function shapePromptVersion(raw: RawPrompt | null | undefined): PromptVersionView | null {
  if (!raw) return null;
  const type = coerceType(raw.type);
  const labels = strList(raw.labels);
  let text = '';
  let messages: ChatMessage[] = [];
  if (type === 'chat' && Array.isArray(raw.prompt)) {
    messages = raw.prompt
      .map((m) => {
        const msg = m as { role?: unknown; content?: unknown };
        return {
          role: typeof msg?.role === 'string' ? msg.role : '',
          content: typeof msg?.content === 'string' ? msg.content : '',
        };
      })
      .filter((m) => m.role || m.content);
  } else if (typeof raw.prompt === 'string') {
    text = raw.prompt;
  }
  return {
    name: (raw.name ?? '').trim() || 'unnamed',
    version: typeof raw.version === 'number' ? raw.version : 0,
    type,
    labels,
    tags: strList(raw.tags),
    commitMessage: (raw.commitMessage ?? '').trim(),
    isProduction: labels.includes(PRODUCTION_LABEL),
    text,
    messages,
    config: raw.config ?? null,
    createdAt: (raw.createdAt ?? '').trim(),
    updatedAt: (raw.updatedAt ?? '').trim(),
  };
}
