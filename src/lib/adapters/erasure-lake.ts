// DSAR propagation — external DATA LAKE (SeaweedFS/S3) adapter. Thin I/O: delete every object in the
// media bucket owned by the erasure subject. Reuses the ONE file-storage seam (src/lib/files.ts) so
// the deletes go through the same SigV4/anonymous path and the same bucket the console reads from —
// no parallel S3 client, no second source of truth.
//
// Objects carry an `x-amz-meta-owner` set at upload (saveFile). We list the bucket, HEAD-resolve each
// object's owner, and delete the ones owned by the subject (admin delete — DSAR is an operator action
// that bypasses per-owner guards). If the bucket is unreachable, `isLakeConfigured()` returns false so
// the planner defers this target honestly rather than reporting a fake success.
//
// SOLID: no rule here — the pure planner decided this runs and gave us the subjectKey. This file only
// talks to the file store.

import { deleteFile, getFileMeta, listFiles } from '@/lib/files';

const S3 = (process.env.OFFGRID_SEAWEEDFS_URL || 'http://127.0.0.1:8333').replace(/\/$/, '');
const BUCKET = process.env.OFFGRID_SEAWEEDFS_BUCKET || 'media';

/**
 * Is the data lake reachable? A quick HEAD on the bucket — the planner uses this to decide whether the
 * lake target is a step or a deferred `not-configured`. Never throws.
 */
export async function isLakeConfigured(): Promise<boolean> {
  try {
    const res = await fetch(`${S3}/${BUCKET}`, { method: 'HEAD', signal: AbortSignal.timeout(2500) });
    // 200/403 = bucket endpoint answered (reachable); non-response/network error → not configured.
    return res.ok || res.status === 403 || res.status === 404;
  } catch {
    return false;
  }
}

export interface LakeEraseResult {
  ok: boolean;
  /** Objects deleted. */
  removed: number;
  error: string | null;
}

// Owner metadata is written URL-encoded (saveFile encodeURIComponent's it); compare case-insensitively
// against the subject key so `Alice@Corp.in` matches `alice@corp.in`.
function ownerMatches(owner: string, subjectKey: string): boolean {
  return owner.trim().toLowerCase() === subjectKey;
}

/**
 * Delete every lake object owned by the subject. Lists the bucket, resolves each object's owner via a
 * HEAD, and admin-deletes the matches. Returns an honest count; on a listing/network failure returns
 * `ok:false` with an error so the orchestrator defers it (never counted as erased). A per-object delete
 * failure is tolerated (counted only on success) but flips `ok` to false so the report stays honest.
 */
export async function eraseSubjectLakeObjects(subjectKey: string): Promise<LakeEraseResult> {
  try {
    const files = await listFiles('');
    let removed = 0;
    let anyFailed = false;
    for (const f of files) {
      // listFiles derives owner as '' (cheap listing), so HEAD each to read the real owner metadata.
      const meta = await getFileMeta(f.id);
      if (!meta || !meta.owner || !ownerMatches(meta.owner, subjectKey)) continue;
      const ok = await deleteFile(f.id, '', true); // admin delete — DSAR bypasses per-owner guard
      if (ok) removed += 1;
      else anyFailed = true;
    }
    return { ok: !anyFailed, removed, error: anyFailed ? 'one or more object deletes failed' : null };
  } catch (e) {
    return { ok: false, removed: 0, error: e instanceof Error ? e.message : 'lake erase failed' };
  }
}
