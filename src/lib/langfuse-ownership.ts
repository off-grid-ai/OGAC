// ─── Ownership guards for the Langfuse-native prompt/dataset management routes (thin I/O) ─────────
//
// Seven API routes under /api/v1/admin/observability/{prompts,datasets} read and mutate records in a
// store shared by every tenant, and none of them checked whose record it was. Two consequences, both
// live on 2026-08-05:
//
//   • READ — opening the prompt from the Suraksha Life (insurer) console returned Bharat Union Bank's
//     system prompt body. Confirmed on the public demo links.
//   • WRITE — the boundary was equally absent on DELETE/PATCH/POST, so a writer in one tenant could
//     have edited or deleted another tenant's prompt. Nobody had looked, because the read leak was the
//     one you could see on a screen.
//
// A third, subtler hole: the prompt LIST route forwarded a caller-supplied `?tag=` straight to the
// store. Since ownership is expressed as the tag `org:<orgId>`, that parameter let a caller simply ask
// for another tenant's prompts by name. The fix is not to validate that parameter — it is to stop
// taking the org from the request at all and take it from the session's tenant binding.
//
// The ownership DECISION is pure and lives in langfuse-tenancy.ts. This module only performs the lookup.

import { langfuseDatasets } from '@/lib/adapters/langfuse-datasets';
import { langfusePrompts } from '@/lib/adapters/langfuse-prompts';
import { orgTag, promptOrg } from '@/lib/langfuse-tenancy';

/**
 * Does this prompt belong to this org?
 *
 * Asks the store for the prompt BY NAME and BY the org's ownership tag together, then confirms the
 * returned row really is that name. Fails CLOSED: an unreachable store, an unknown prompt, or an
 * untagged one all yield false, so the caller 404s rather than serving a record whose owner it could
 * not establish.
 */
export async function promptBelongsToOrg(name: string, orgId: string): Promise<boolean> {
  if (!name.trim() || !orgId.trim()) return false;
  try {
    const rows = await langfusePrompts.list({ name, tag: orgTag(orgId), limit: 100 });
    // The upstream `name` filter is a match, not an exact equality, so re-check the name here and
    // re-check the tag locally rather than trusting the remote filter to have applied it.
    return rows.some((r) => r.name === name && promptOrg(r) === orgId);
  } catch {
    return false;
  }
}

/**
 * Does this dataset belong to this org? Reads the dataset and compares its `metadata.org`.
 * Fails closed, for the same reason as above.
 */
export async function datasetBelongsToOrg(name: string, orgId: string): Promise<boolean> {
  if (!name.trim() || !orgId.trim()) return false;
  try {
    const detail = await langfuseDatasets.detail(name, 1);
    return detail?.dataset?.org === orgId;
  } catch {
    return false;
  }
}
