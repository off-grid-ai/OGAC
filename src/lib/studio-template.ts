// Pure, zero-IO rules for studio-template (assistant) management: slug generation from a title,
// and shaping an untrusted edit body into a validated DB patch. Shared by the templates routes so
// slug/visibility logic lives in one tested place. No DB, no React. See test/studio-template.test.ts.

export type Visibility = 'private' | 'org' | 'public';

/** A URL-safe slug from a title plus a short random suffix, so /app/<slug> is stable & unique. */
export function slugFromTitle(title: string, suffix = Math.random().toString(36).slice(2, 6)): string {
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
  return v === 'org' ? 'org' : v === 'public' ? 'public' : 'private';
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
