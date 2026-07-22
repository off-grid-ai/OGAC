// Pure, zero-IO rules for studio-template (assistant) management: slug generation from a title,
// and shaping an untrusted edit body into a validated DB patch. Shared by the templates routes so
// slug/visibility logic lives in one tested place. No DB, no React. See test/studio-template.test.ts.

import type { TemplateVar, TemplateVarSchema, TemplateVarType } from '@/lib/app-template-vars';
import { randomToken } from '@/lib/rand';

export type Visibility = 'private' | 'org' | 'public';

/** A URL-safe slug from a title plus a short random suffix, so /app/<slug> is stable & unique. */
export function slugFromTitle(title: string, suffix = randomToken(4)): string {
  const base =
    (title || 'app')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'app';
  return `${base}-${suffix}`;
}

/** Coerce an arbitrary visibility value to the allowed set (default 'private'). */
export function normalizeVisibility(v: unknown): Visibility {
  if (v === 'org') return 'org';
  if (v === 'public') return 'public';
  return 'private';
}

export interface TemplatePatch {
  title?: string;
  summary?: string;
  visibility?: Visibility;
  published?: boolean;
  slug?: string;
}

/**
 * Shape an untrusted PATCH body into a DB patch: only present keys are written. Returns null if a
 * provided title is blank (title, when edited, must be non-empty). When `published` flips true and
 * the row has no slug yet, a slug is minted and visibility is forced to 'public'; unpublishing
 * clears `published` but keeps the slug (so re-publishing keeps the same link).
 */
export function parseTemplatePatch(
  body: Record<string, unknown> | null,
  current: { slug: string | null; title: string },
): TemplatePatch | null {
  const b = body ?? {};
  const patch: TemplatePatch = {};

  if ('title' in b) {
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!title) return null;
    patch.title = title;
  }
  if ('summary' in b) {
    patch.summary = typeof b.summary === 'string' ? b.summary.trim() : '';
  }
  if ('visibility' in b) {
    patch.visibility = normalizeVisibility(b.visibility);
  }
  if ('published' in b) {
    const published = b.published === true;
    patch.published = published;
    if (published) {
      patch.visibility = 'public';
      if (!current.slug) patch.slug = slugFromTitle(patch.title ?? current.title);
    }
  }
  return patch;
}

// ─── parseTemplateVarSchema — shape an untrusted `vars` body into a TemplateVarSchema (PURE) ────────
// The publish-as-template route accepts a raw JSON `vars` array from the client; this coerces it to
// the typed schema shape ONCE, defensively (unknown types fall back to 'text', options/default only
// kept for select, required/description normalized). It does NOT decide coherence — validateVarSchema
// (in app-template-vars.ts) owns that rule, run inside the store on publish. DRY: the parsing lives
// here, the validity rule lives there, neither duplicates the other.
const VAR_TYPES: readonly TemplateVarType[] = ['text', 'number', 'boolean', 'select'];

export function parseTemplateVarSchema(raw: unknown): TemplateVarSchema {
  const list = Array.isArray(raw) ? raw : [];
  const vars: TemplateVar[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name) continue;
    const type: TemplateVarType = VAR_TYPES.includes(o.type as TemplateVarType)
      ? (o.type as TemplateVarType)
      : 'text';
    const v: TemplateVar = { name, type };
    if (typeof o.description === 'string' && o.description.trim()) {
      v.description = o.description.trim();
    }
    if (typeof o.default === 'string' && o.default !== '') v.default = o.default;
    if (o.required === true) v.required = true;
    if (type === 'select' && Array.isArray(o.options)) {
      const options = o.options.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
      if (options.length) v.options = options;
    }
    vars.push(v);
  }
  return { vars };
}

// ─── parseProvidedVars — shape an untrusted variable-values body into a string map (PURE) ──────────
// The "Use this template" adoption form sends { values: { name: value } }. Coerce every value to a
// string (the substitution engine binds strings), dropping non-string-coercible entries. Keeps the
// route thin and the coercion rule in one tested place.
export function parseProvidedVars(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!k) continue;
    if (typeof val === 'string') out[k] = val;
    else if (typeof val === 'number' || typeof val === 'boolean') out[k] = String(val);
  }
  return out;
}
