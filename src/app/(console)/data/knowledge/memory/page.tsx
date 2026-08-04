import { PageFrame } from '@/components/PageFrame';
import { BrainAccessAbsent, BrainAccessCard } from '@/components/brain/BrainAccessCard';
import { MemorySearch } from '@/components/brain/MemorySearch';
import {
  capabilityRows,
  describeBrainAccess,
  parseBrainGrants,
} from '@/lib/brain-access-view';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

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
  const orgId = await currentOrgId();

  // WHO MAY USE THIS. Enforcement was already in the run path; the missing half was visibility — a reader
  // refused here had nowhere to see who is allowed, or to check the grant is as narrow as intended.
  // Read-only: the policy is a deployment env var, and editing memory access from a web form would be a way
  // to widen it by accident.
  const rawPolicy = process.env.OFFGRID_ORGANIZATIONAL_BRAIN_ACCESS_POLICY;
  let parsed: ReturnType<typeof parseBrainGrants> | null = null;
  if (rawPolicy?.trim()) {
    try {
      parsed = parseBrainGrants(JSON.parse(rawPolicy), orgId);
    } catch {
      // Unparseable policy is NOT "no access" — it is a broken control, and parseBrainGrants' own
      // `dropped` path words that. An empty array here would claim the policy grants nothing.
      parsed = { grants: [], dropped: 1 };
    }
  }
  const rows = parsed ? capabilityRows(parsed.grants) : [];

  return (
    <PageFrame>
      <div className="w-full space-y-4">
        <MemorySearch />
        {/* After the search: you come here to ask a question, and only wonder about permission when you are
            refused — or when you are auditing who can read the organisation's memory. */}
        {parsed ? (
          <BrainAccessCard
            rows={rows}
            grants={parsed.grants}
            sentence={describeBrainAccess(rows, parsed.grants, parsed.dropped)}
          />
        ) : (
          <BrainAccessAbsent />
        )}
      </div>
    </PageFrame>
  );
}
