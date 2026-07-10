// Pure, zero-IO rule for serving a DEPLOYED app at /app/<slug>. The public surface must reveal an
// app ONLY when it is genuinely PUBLISHED and carries a slug — the exact same gate the run endpoint
// enforces (POST /api/v1/app/<slug>/run checks app.published). Kept here, dependency-free, so the
// "is this app publicly servable?" decision lives in one tested place instead of being re-derived
// inline in the page. See test/deployed-app.test.ts.

// The minimal shape the /app/<slug> page needs from an AppSpec. A structural subset so this stays
// import-free (no coupling to apps-store / app-model): any object with these fields satisfies it.
export interface DeployableApp {
  title: string;
  summary?: string;
  slug?: string | null;
  published: boolean;
}

// What the page renders once the gate passes: a non-null slug (safe to embed in the run URL) plus
// display text. Null title/summary are normalized so the page never renders "null".
export interface ResolvedDeployedApp {
  title: string;
  summary: string;
  slug: string;
}

/**
 * Resolve an app row into the public deployed-app view, or null (→ 404). Serves the app ONLY when
 * it is published AND has a non-empty slug; an unpublished app, a published-but-slugless row, or a
 * missing app (null) all yield null so the page 404s. This does NOT weaken the gate to show
 * unpublished apps — publishing (apps-store.publishApp) is what mints the slug + sets published.
 */
export function resolveDeployedApp(app: DeployableApp | null | undefined): ResolvedDeployedApp | null {
  if (!app || !app.published) return null;
  const slug = typeof app.slug === 'string' ? app.slug.trim() : '';
  if (!slug) return null;
  return {
    title: app.title?.trim() || slug,
    summary: (app.summary ?? '').trim(),
    slug,
  };
}
