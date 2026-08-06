import { isFleetServedModel, MODEL_CATALOG, type ModelSpec } from '@/lib/model-catalog';

// ─── Did this request run on the customer's own hardware? (PURE, zero-IO) ─────────────────────────
//
// This decides the one number the whole product is sold on, so it is worth being exact about what it
// can and cannot know.
//
// The gateway aggregator stamps every request with the node that served it — `gateway: "g1"`,
// `"g3"`, `"g5"`. That is the router's own record of where the work happened, and it is the only
// thing here that constitutes proof. When the emitter does not know a node it writes the model tag
// into that field instead, which is why `gateway === model` is the "no node recorded" case rather
// than a node called `gpt-4o-mini`.
//
// Everything else is inference. A model the curated catalogue marks as fleet-served, or one the
// router prefixed `onprem/`, is counted; an unrecognised tag is NOT, even when it looks local. Two
// of this fleet's busiest tags (`qwen2.5:14b`, `llama3.1:70b`) are Ollama-style names that almost
// certainly run downstairs — and they are still excluded, because "almost certainly" is not a thing
// to put in front of a buyer. The published figure therefore UNDER-states the truth, which is the
// only direction an error in this number is allowed to run.

/** The fields of a traffic event this decision reads. */
export interface LocalityEvent {
  /** The node that served it, per the gateway aggregator. Empty, or a copy of `model`, when unknown. */
  gateway?: string | null;
  /** The routing tag. */
  model?: string | null;
}

/**
 * True when the request was served by a named fleet node.
 *
 * A node id is a bare host label (`g1`, `s1`). A value carrying `/` or `:`, or one identical to the
 * model tag, is the aggregator echoing the model because it had no node to name — not a node.
 */
export function servedByNamedNode(event: LocalityEvent): boolean {
  const gateway = String(event.gateway ?? '').trim().toLowerCase();
  if (!gateway) return false;
  if (gateway.includes('/') || gateway.includes(':')) return false;
  return gateway !== String(event.model ?? '').trim().toLowerCase();
}

/**
 * True when we can show the request was answered on the customer's own hardware.
 *
 * Proof first (a named node), then the catalogue. Never a guess.
 */
export function ranOnOwnHardware(
  event: LocalityEvent,
  catalog: ModelSpec[] = MODEL_CATALOG,
): boolean {
  return servedByNamedNode(event) || isFleetServedModel(event.model, catalog);
}

/**
 * Where a model runs, as THREE states rather than two.
 *
 * Two states force a lie in one direction or the other. `isFleetServedModel` answers false for both
 * "this is OpenAI" and "we have never seen this tag", which is fine when the question is "may we
 * claim it stayed in" — but not when the question is "did it go out". Reporting an unrecognised
 * Ollama tag as egress claims data left the building when it probably did not, which is just the
 * original bug pointed the other way.
 *
 * `hosted` therefore means we can NAME the outside provider: the router's `compat:`/`cloud-` prefix,
 * or a vendor model family no one self-hosts.
 */
export type ModelLocality = 'fleet' | 'hosted' | 'unknown';

/** Vendor families that only exist behind someone else's API — naming one IS the proof of egress. */
const HOSTED_FAMILIES = /^(gpt-|o\d-|chatgpt|claude-|gemini-|command-r|sonar-|grok-)/;

export function modelLocality(
  id: string | null | undefined,
  catalog: ModelSpec[] = MODEL_CATALOG,
): ModelLocality {
  const raw = String(id ?? '').trim().toLowerCase();
  if (!raw) return 'unknown';
  if (isFleetServedModel(raw, catalog)) return 'fleet';
  if (raw.startsWith('compat:') || raw.startsWith('cloud-') || raw.startsWith('cloud/')) {
    return 'hosted';
  }
  const bare = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
  return HOSTED_FAMILIES.test(bare) ? 'hosted' : 'unknown';
}

/** Requests we can prove went to an outside provider, and the ones we cannot place either way. */
export interface EgressTally {
  total: number;
  /** Provably answered on the customer's own hardware. */
  fleet: number;
  /** Provably answered by a named outside provider. */
  hosted: number;
  /** Neither could be established. Reported, never silently folded into one of the other two. */
  unknown: number;
}

export function tallyEgress(
  events: readonly LocalityEvent[],
  catalog: ModelSpec[] = MODEL_CATALOG,
): EgressTally {
  const tally: EgressTally = { total: events.length, fleet: 0, hosted: 0, unknown: 0 };
  for (const e of events) {
    if (ranOnOwnHardware(e, catalog)) tally.fleet += 1;
    else if (modelLocality(e.model, catalog) === 'hosted') tally.hosted += 1;
    else tally.unknown += 1;
  }
  return tally;
}

/**
 * Share of requests answered on the customer's own hardware, 0..100, rounded.
 *
 * Returns null for an empty set. That is not pedantry: 0% is the single worst thing this product can
 * say about itself, and saying it because no traffic was recorded — rather than because everything
 * left the building — would be a lie told in the most damaging possible direction.
 */
export function localSharePct(
  events: readonly LocalityEvent[],
  catalog: ModelSpec[] = MODEL_CATALOG,
): number | null {
  if (events.length === 0) return null;
  const local = events.filter((e) => ranOnOwnHardware(e, catalog)).length;
  return Math.round((local / events.length) * 100);
}
