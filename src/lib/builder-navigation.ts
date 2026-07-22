export const BUILDER_MODES = ['chat', 'build'] as const;
export type BuilderMode = (typeof BUILDER_MODES)[number];

export const FORGE_PREVIEWS = ['app', 'flow', 'governance'] as const;
export type ForgePreview = (typeof FORGE_PREVIEWS)[number];

type QueryReader = Pick<URLSearchParams, 'get'>;

export function builderModeFromQuery(query: QueryReader): BuilderMode {
  return query.get('mode') === 'chat' ? 'chat' : 'build';
}

export function forgePreviewFromQuery(query: QueryReader): ForgePreview {
  const preview = query.get('preview');
  return preview === 'flow' || preview === 'governance' ? preview : 'app';
}

function href(pathname: string, query: URLSearchParams): string {
  const value = query.toString();
  return value ? `${pathname}?${value}` : pathname;
}

export function builderModeHref(pathname: string, currentQuery: string, mode: BuilderMode): string {
  const query = new URLSearchParams(currentQuery);
  query.set('mode', mode);
  if (mode === 'build') query.delete('preview');
  return href(pathname, query);
}

export function forgePreviewHref(
  pathname: string,
  currentQuery: string,
  preview: ForgePreview,
): string {
  const query = new URLSearchParams(currentQuery);
  query.set('mode', 'chat');
  query.set('preview', preview);
  return href(pathname, query);
}
