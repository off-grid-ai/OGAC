import { redirect } from 'next/navigation';

// ─── /tool-catalog → /tools?tab=catalog (Builder Epic #121) ───────────────────────────────────────
// The MCP catalog used to live orphaned here under Data. The three scattered tool surfaces — the
// registry (Brain), this catalog, and the builder picker — are now unified under ONE Tools home in
// the Build group. This route is kept only as a permanent redirect so old links / bookmarks / the
// legacy URL never 404; the real content lives in the Catalog tab of /tools.
export const dynamic = 'force-dynamic';

export default function ToolCatalogRedirect() {
  redirect('/build/tools?tab=catalog');
}
