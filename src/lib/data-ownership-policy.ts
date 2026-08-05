// ─── Who owns this data? — PURE, zero-IO ──────────────────────────────────────────────────────────
//
// The lineage catalogue knows which jobs produced which datasets. What it did not carry is the one
// thing a governance review always asks: WHO OWNS IT. Every namespace on the deployment reports
// `ownerName: "anonymous"`, which is not an owner — it is the absence of one wearing a plausible word.
//
// That distinction is the whole module. "anonymous" reads like a value in a table and answers nothing,
// so an unowned namespace has to be reported as unowned rather than shown as owned-by-anonymous.
//
// The tags half is the same idea one level down: a tag like PII or SENSITIVE is a CLAIM about a
// dataset, so it needs a description saying what it means. A tag whose meaning nobody wrote down gets
// applied inconsistently, and then it is worse than no tag because reports start relying on it.

/** Names Marquez itself uses for "nobody has said". Treated as absence, never as an owner. */
const PLACEHOLDER_OWNERS = new Set(['', 'anonymous', 'unknown', 'none', 'n/a', 'null', 'undefined']);

export interface NamespaceOwnership {
  namespace: string;
  /** The owner as recorded, or null when what is recorded means nobody. */
  owner: string | null;
  owned: boolean;
  sentence: string;
}

export function readOwnership(
  namespace: string,
  rawOwner: string | null | undefined,
): NamespaceOwnership {
  const owner = (rawOwner ?? '').trim();
  if (PLACEHOLDER_OWNERS.has(owner.toLowerCase())) {
    return {
      namespace,
      owner: null,
      owned: false,
      sentence: `Nobody owns “${namespace}”. The catalogue records “${owner || 'nothing'}”, which answers the question only in appearance — if something here is wrong, there is no one to tell.`,
    };
  }
  return {
    namespace,
    owner,
    owned: true,
    sentence: `“${namespace}” is owned by ${owner}.`,
  };
}

export type OwnerProblem = 'owner-missing' | 'owner-placeholder' | 'owner-invalid';

export type OwnerResult =
  | { ok: true; owner: string }
  | { ok: false; problem: OwnerProblem; sentence: string };

/** Control characters, written as escapes rather than literal bytes — a file containing the raw bytes
 *  reads as BINARY to grep and rg, which made another module in this repo invisible to code search. */
const CONTROL = /[\u0000-\u001f]/;

/**
 * Validate a proposed owner.
 *
 * A placeholder is REFUSED rather than stored: writing "anonymous" into the owner field is how the
 * current state came about, and accepting it would let someone tick the box without answering.
 */
export function validateOwner(raw: unknown): OwnerResult {
  const owner = typeof raw === 'string' ? raw.trim() : '';
  if (!owner) {
    return {
      ok: false,
      problem: 'owner-missing',
      sentence:
        'Name the person or team accountable for this data. A blank owner is what we already have.',
    };
  }
  if (PLACEHOLDER_OWNERS.has(owner.toLowerCase())) {
    return {
      ok: false,
      problem: 'owner-placeholder',
      sentence: `“${owner}” is not an owner. Name a person or a team, so there is somebody to ask when this data is wrong.`,
    };
  }
  if (owner.length > 255 || CONTROL.test(owner)) {
    return {
      ok: false,
      problem: 'owner-invalid',
      sentence: 'An owner must be plain text under 255 characters.',
    };
  }
  return { ok: true, owner };
}

export type TagProblem = 'name-missing' | 'name-invalid' | 'description-missing';

export type TagResult =
  | { ok: true; name: string; description: string }
  | { ok: false; problem: TagProblem; sentence: string };

/** Marquez tag names are uppercase tokens; keeping that rule here means a rejection is readable. */
const TAG_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Validate a tag.
 *
 * The DESCRIPTION IS REQUIRED, and that is deliberate. A tag like PII is a claim about data; without a
 * written meaning it gets applied inconsistently by different people, and a report that then relies on
 * it is worse than one that never had the tag at all.
 */
export function validateTag(rawName: unknown, rawDescription: unknown): TagResult {
  const name = typeof rawName === 'string' ? rawName.trim().toUpperCase() : '';
  const description = typeof rawDescription === 'string' ? rawDescription.trim() : '';
  if (!name) {
    return { ok: false, problem: 'name-missing', sentence: 'Give the tag a name.' };
  }
  if (!TAG_NAME.test(name)) {
    return {
      ok: false,
      problem: 'name-invalid',
      sentence:
        'A tag name uses capital letters, numbers and underscores, and starts with a letter — for example PII or RETAIN_7Y.',
    };
  }
  if (!description) {
    return {
      ok: false,
      problem: 'description-missing',
      sentence: `Say what “${name}” means. A tag without a written meaning gets applied inconsistently, and reports that rely on it inherit the inconsistency.`,
    };
  }
  return { ok: true, name, description: description.slice(0, 1000) };
}

export interface OwnershipSummary {
  namespaces: NamespaceOwnership[];
  owned: number;
  unowned: number;
  sentence: string;
}

/** How much of the catalogue has somebody accountable for it? */
export function summariseOwnership(rows: readonly NamespaceOwnership[]): OwnershipSummary {
  const owned = rows.filter((r) => r.owned).length;
  const unowned = rows.length - owned;
  if (rows.length === 0) {
    return {
      namespaces: [],
      owned: 0,
      unowned: 0,
      sentence: 'No data areas were found, so there is nothing to say about who owns them.',
    };
  }
  if (unowned === 0) {
    return {
      namespaces: [...rows],
      owned,
      unowned,
      sentence: `Every data area has an owner (${owned} of ${rows.length}).`,
    };
  }
  return {
    namespaces: [...rows],
    owned,
    unowned,
    sentence: `${unowned} of ${rows.length} data areas have nobody accountable for them. If something in those is wrong, there is no one to tell.`,
  };
}
