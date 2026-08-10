import { publicLabel } from '@/lib/lineage-labels';

// ─── Machine identifiers → plain language (PURE, zero-IO) ────────────────────────────────────────
//
// A different leak from the one `publicLabel` handles. That one has a VOCABULARY of things never to
// say — engine names, our codenames. This one deals with strings that name nothing secret but are
// written for a machine: `pipeline.data.deny`, `org_suraksha`, `proof:ceiling`.
//
// It matters most in the copilot, because a fact handed to the model comes back quoted in its answer:
// a buyer asked what stops a bad answer and was told it was blocked "by proof:ceiling on
// org_suraksha". Every word of that is true and none of it is language a person reading a demo can
// use.
//
// FIXED AT THE SEAM, not after the fact. Scrubbing the model's OUTPUT cannot work — it paraphrases,
// so `org_suraksha` comes back as "the org_suraksha organisation" or "org suraksha" and no regex
// catches every shape. Clean the facts before the model sees them and it cannot quote what it was
// never given.
//
// It does NOT touch record ids. `run_0d632888` is the reader's own evidence and the thing they go and
// look up; hiding it would remove the traceability this product is sold on.

/**
 * Verbs that read wrong when simply un-dotted.
 *
 * Only the ones where the machine word actively misleads. `deny` reads as an accusation, `kill` as
 * something violent, `erasure` as a noun where a verb belongs. Anything not listed keeps its own
 * word — inventing a synonym for every action would be a second vocabulary to maintain and to get
 * subtly wrong.
 */
const VERBS: Record<string, string> = {
  deny: 'refused',
  denied: 'refused',
  block: 'blocked',
  allow: 'allowed',
  create: 'created',
  delete: 'deleted',
  update: 'updated',
  change: 'changed',
  enforce: 'enforced',
  issue: 'issued',
  rotate: 'rotated',
  revoke: 'revoked',
  write: 'written',
  writeback: 'written back',
  send: 'sent',
  ingest: 'ingested',
  review: 'reviewed',
  sync: 'synced',
  kill: 'stopped',
  erasure: 'erased',
  provision: 'provisioned',
  configure: 'configured',
  approve: 'approved',
  reject: 'rejected',
};

/**
 * An audit action code as a phrase: `pipeline.data.deny` → "pipeline data refused".
 *
 * Deliberately mechanical. It un-dots the code and fixes the handful of verbs that read wrong; it
 * does not try to write a sentence about what the action means, because a wrong explanation of a
 * governance event is far worse than a plain one.
 */
export function plainAction(action: string | null | undefined): string {
  const parts = String(action ?? '')
    .trim()
    .toLowerCase()
    .split(/[.:_]+/)
    .filter(Boolean);
  if (parts.length === 0) return '';
  const last = parts[parts.length - 1];
  const verb = VERBS[last];
  return [...parts.slice(0, -1), verb ?? last].join(' ');
}

/**
 * An org identifier as something a reader can hear.
 *
 * Always "this organisation" rather than the tenant's name: the reader IS that tenant, so naming
 * them adds nothing, and an answer that says "on org_suraksha" invites the question of whose other
 * orgs are in there. `default` — the platform operator's own org — gets the same treatment.
 */
export function plainOrg(org: string | null | undefined): string {
  const v = String(org ?? '').trim();
  if (!v) return '';
  return /^(org[_-]|default$)/i.test(v) ? 'this organisation' : v;
}

/** Every `key:value` internal reference in a string, spaced out: `proof:ceiling` → "proof ceiling". */
export function plainRefs(text: string | null | undefined): string {
  // Bounded to lowercase machine tokens on both sides so a time ("09:30"), a URL ("https://…") and a
  // sentence's own colon are left alone.
  return String(text ?? '').replace(/\b([a-z][a-z0-9]*):([a-z][a-z0-9_-]*)\b/g, '$1 $2');
}

/**
 * Remove an org id embedded INSIDE an identifier.
 *
 * `plainOrg` handles a field whose whole value is the org. This handles the other shape, which is the
 * one that actually survived on screen: the audit trail's resource column read
 * `pipeline:pl_seed_org_suraksha_fraud-screening`, where the org id is a segment of a longer id. The
 * whole-field rule could not see it, and neither could `publicLabel`, whose vocabulary is engine
 * names.
 *
 * The id keeps its identity — an operator reading an audit trail needs a reference they can look up —
 * it just stops carrying the tenant's internal name.
 */
export function stripOrgIds(text: string | null | undefined): string {
  return String(text ?? '')
    // Embedded segment: pl_seed_org_suraksha_fraud → pl_seed_fraud.
    .replace(/_org_[a-z0-9]+_/gi, '_')
    // Trailing segment: something_org_suraksha → something.
    .replace(/_org_[a-z0-9]+\b/gi, '')
    // Standalone, when it is one token of a longer string rather than the whole field.
    .replace(/\borg_[a-z0-9_]+\b/gi, 'this organisation');
}

/**
 * An audit action code, safe AND readable for a customer. Use this on any buyer-facing surface.
 *
 * The two mappers each solve half of it and neither is enough alone. `plainAction` fixes the SYNTAX
 * (`data.airbyte.schedule` → "data airbyte schedule") and knows nothing about vocabulary, so the
 * engine name walked straight through it onto the regulatory page. `publicLabel` fixes the
 * VOCABULARY and knows nothing about dots, so on the raw code it left a machine string.
 *
 * Composed, they produce a repeated word — "data data movement schedule" — because the replacement
 * for the engine begins with a word the code already had. So the collapse happens LAST, after both.
 * Doing it inside plainAction, where I first put it, was too early to see the duplicate at all.
 */
export function publicActionLabel(action: string | null | undefined): string {
  const words = publicLabel(plainAction(action)).split(/\s+/).filter(Boolean);
  return words.filter((w, i) => w.toLowerCase() !== (words[i - 1] ?? '').toLowerCase()).join(' ');
}
