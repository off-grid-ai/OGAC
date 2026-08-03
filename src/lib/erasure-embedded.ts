import { extractSubjects, type SubjectType } from '@/lib/subject-index';
import { eraseSubjectFromChunks, findChunksForSubject } from '@/lib/subject-index-store';

// ─── The copies that are not rows ──────────────────────────────────────────────────────────────────
//
// Row-level erasure clears records KEYED BY a person. It never touched where the personal data
// actually accumulates: the retrieval chunks built from documents, and the run records that quote
// them. Both routes need that half, so it lives here once rather than being pasted into each.
//
// The identifier must be TYPED by the same rules the index used when writing it — an email searched
// as a free-text reference matches nothing and would wrongly report "no copies found".
export function typeSubject(subject: string): { type: SubjectType; value: string }[] {
  const typed = extractSubjects(subject);
  return typed.length ? typed : [{ type: 'REFERENCE' as SubjectType, value: subject }];
}

export interface EmbeddedFound {
  type: string;
  masked: string;
  chunks: number;
  runs: number;
}

export interface EmbeddedErased {
  type: string;
  matched: number;
  chunksDeleted: number;
  runsRedacted: number;
  /** Re-queried AFTER the deletion. Non-zero means the erasure is not complete, whatever ran. */
  remaining: number;
}

/** Look, touch nothing. Used by the find step so a DPO reviews before anything is destroyed. */
export async function findEmbeddedCopies(orgId: string, subject: string): Promise<EmbeddedFound[]> {
  const found: EmbeddedFound[] = [];
  for (const t of typeSubject(subject)) {
    const matches = await findChunksForSubject(orgId, t.type, t.value).catch(() => []);
    if (!matches.length) continue;
    found.push({
      type: t.type,
      masked: matches[0].masked,
      chunks: matches.filter((m) => m.source !== 'run').length,
      runs: new Set(matches.filter((m) => m.source === 'run').map((m) => m.containerId)).size,
    });
  }
  return found;
}

/** Delete the chunks, redact the runs. Each result carries the re-queried `remaining` as its proof. */
export async function eraseEmbeddedCopies(orgId: string, subject: string): Promise<EmbeddedErased[]> {
  const erased: EmbeddedErased[] = [];
  for (const t of typeSubject(subject)) {
    const r = await eraseSubjectFromChunks(orgId, t.type, t.value).catch(() => null);
    if (r && r.matched > 0) erased.push({ type: t.type, ...r });
  }
  return erased;
}

/**
 * The single honest verdict. An erasure is proven only when NOTHING is left — and a store we could
 * not reach means we cannot claim completeness whatever the row counts say.
 */
export function erasureProven(embedded: EmbeddedErased[], deferred: string[]): boolean {
  return embedded.every((e) => e.remaining === 0) && deferred.length === 0;
}
