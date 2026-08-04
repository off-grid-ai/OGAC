import { PageFrame } from '@/components/PageFrame';
import { MemorySearch } from '@/components/brain/MemorySearch';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// ─── Search the organisation's memory, directly ────────────────────────────────────────────────────
//
// Closes the capability-map gap on organizational-memory search: "Retrieval is API/tool-first; there is no
// operator-facing memory-search console page yet — add a governed search surface so operators can query
// memory directly, not only via an agent."
//
// It lives under /data/knowledge — the CANONICAL route; /workspace/knowledge redirects here, so a page
// authored under the old path is reachable only through a redirect that strips it. (I put it there first
// and the screenshot caught it: the route resolved to /data/knowledge/memory and 404'd.)
//
// It calls the SAME governed search route an agent's tool call uses — if the two could diverge, this page
// would be a second opinion about the org's memory rather than a window onto it.
export default async function OrganizationalMemoryPage() {
  // Same module gate as the rest of Knowledge: authorization for the search itself is enforced again in
  // the route, so this is defence in depth rather than the only check.
  await requireModuleForUser('knowledge');
  return (
    <PageFrame>
      <MemorySearch />
    </PageFrame>
  );
}
