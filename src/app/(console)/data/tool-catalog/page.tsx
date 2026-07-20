import { redirect } from 'next/navigation';

// ─── Legacy Data catalog route → canonical Solutions / Tools / Catalog ───────────────────────────
// The MCP catalog used to live orphaned here under Data. The three scattered tool surfaces — the
// registry (Brain), this catalog, and the builder picker — are now unified under ONE Tools home in
// Solutions. This route remains only so old links and bookmarks never 404.
export const dynamic = 'force-dynamic';

export default function ToolCatalogRedirect() {
  redirect('/solutions/tools/catalog');
}
