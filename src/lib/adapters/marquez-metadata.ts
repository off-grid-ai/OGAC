// ─── Namespace ownership and tag lifecycle in the lineage catalogue (I/O bridge) ──────────────────
//
// Judgement is pure, in data-ownership-policy.ts. This reads and writes the catalogue.
//
// WHY THIS EXISTS: the catalogue already knew which jobs produced which datasets, and every namespace
// reported `ownerName: "anonymous"`. "Who owns this data?" is the first question of any governance
// review, and the answer was a placeholder that reads like an answer.
//
// The writes are deliberately narrow — set an owner, define a tag, apply or remove a tag on a dataset.
// Nothing here deletes a namespace or a dataset: lineage is an append-only record of what happened, and
// a console that can erase it is a console that can erase evidence.

import { readOwnership, summariseOwnership, type OwnershipSummary } from '@/lib/data-ownership-policy';

const BASE = () => (process.env.OFFGRID_MARQUEZ_URL ?? '').replace(/\/$/, '');

export interface CatalogueTag {
  name: string;
  description: string | null;
  /** True when nobody wrote down what the tag means — reported, because it is how tags drift. */
  undefinedMeaning: boolean;
}

export type MetadataOutcome<T> =
  | { ok: true; result: T }
  | { ok: false; reason: string };

async function mq<T>(path: string, init?: RequestInit): Promise<MetadataOutcome<T>> {
  const base = BASE();
  if (!base) return { ok: false, reason: 'The lineage catalogue is not configured on this deployment.' };
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { accept: 'application/json', 'content-type': 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, reason: `the catalogue answered ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
    }
    // 204 and empty bodies are legitimate for the write paths.
    const text = await res.text();
    return { ok: true, result: (text ? JSON.parse(text) : null) as T };
  } catch (e) {
    // A failed read must never surface as "no namespaces" — that would read as a clean, empty catalogue.
    return {
      ok: false,
      reason: `the lineage catalogue could not be reached (${(e as Error).message.slice(0, 120)})`,
    };
  }
}

/** Who owns each data area? Returns the failure rather than an empty list. */
export async function readOwnershipSummary(): Promise<MetadataOutcome<OwnershipSummary>> {
  const res = await mq<{ namespaces?: Array<{ name: string; ownerName?: string; isHidden?: boolean }> }>(
    '/api/v1/namespaces',
  );
  if (!res.ok) return res;
  // HIDDEN namespaces are excluded. The catalogue's delete is a soft hide, not a removal, so a deleted
  // data area keeps appearing — and counting it would inflate "nobody is accountable" with areas nobody
  // uses any more, making the number easy to dismiss. Found live 2026-08-05 after deleting a namespace
  // and watching it still count against the summary.
  const rows = (res.result?.namespaces ?? [])
    .filter((n) => n.isHidden !== true)
    .map((n) => readOwnership(n.name, n.ownerName));
  return { ok: true, result: summariseOwnership(rows) };
}

/**
 * Set a namespace's owner.
 *
 * The caller must have validated it with `validateOwner` first — a placeholder reaching this function
 * would write back the exact state the feature exists to fix.
 */
export async function setNamespaceOwner(
  namespace: string,
  owner: string,
  description?: string,
): Promise<MetadataOutcome<{ namespace: string; owner: string }>> {
  const res = await mq<{ name: string; ownerName?: string }>(
    `/api/v1/namespaces/${encodeURIComponent(namespace)}`,
    { method: 'PUT', body: JSON.stringify({ ownerName: owner, ...(description ? { description } : {}) }) },
  );
  if (!res.ok) return res;
  // RE-READ the owner from the response rather than echoing what we sent: the catalogue is the record,
  // and reporting our own request would claim a state it may not hold.
  const written = readOwnership(namespace, res.result?.ownerName);
  if (!written.owned) {
    return { ok: false, reason: 'the catalogue accepted the change but still reports no owner' };
  }
  return { ok: true, result: { namespace, owner: written.owner! } };
}

/** Every tag the catalogue knows, flagging the ones whose meaning nobody wrote down. */
export async function listTags(): Promise<MetadataOutcome<CatalogueTag[]>> {
  const res = await mq<{ tags?: Array<{ name: string; description?: string }> }>('/api/v1/tags');
  if (!res.ok) return res;
  return {
    ok: true,
    result: (res.result?.tags ?? []).map((t) => ({
      name: t.name,
      description: t.description?.trim() || null,
      undefinedMeaning: !t.description?.trim(),
    })),
  };
}

/** Define or redefine a tag. Validated by `validateTag` before it gets here. */
export async function upsertTag(
  name: string,
  description: string,
): Promise<MetadataOutcome<CatalogueTag>> {
  const res = await mq<{ name: string; description?: string }>(
    `/api/v1/tags/${encodeURIComponent(name)}`,
    { method: 'PUT', body: JSON.stringify({ description }) },
  );
  if (!res.ok) return res;
  return {
    ok: true,
    result: {
      name: res.result?.name ?? name,
      description: res.result?.description?.trim() || null,
      undefinedMeaning: !res.result?.description?.trim(),
    },
  };
}

/** Apply a tag to a dataset — the claim that makes a tag worth defining. */
export async function tagDataset(
  namespace: string,
  dataset: string,
  tag: string,
): Promise<MetadataOutcome<null>> {
  return mq<null>(
    `/api/v1/namespaces/${encodeURIComponent(namespace)}/datasets/${encodeURIComponent(dataset)}/tags/${encodeURIComponent(tag)}`,
    { method: 'POST' },
  );
}

/** Remove a tag from a dataset. Removing the CLAIM, not the dataset — lineage stays append-only. */
export async function untagDataset(
  namespace: string,
  dataset: string,
  tag: string,
): Promise<MetadataOutcome<null>> {
  return mq<null>(
    `/api/v1/namespaces/${encodeURIComponent(namespace)}/datasets/${encodeURIComponent(dataset)}/tags/${encodeURIComponent(tag)}`,
    { method: 'DELETE' },
  );
}
