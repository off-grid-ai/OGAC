// ─── The domestic-PII floor: precise India rules run BEFORE the content engine ────────────────────
//
// G-F2. The console ships a seeded policy that reads "Mask PAN in every output". It was not true.
// Against the live engine, `PAN ABCDE1234F, Aadhaar 2345 6789 0123, IFSC HDFC0001234, UPI ravi@okhdfc`
// came back with entities `["PHONE_NUMBER"]` and the text `PAN ABCDE1234F, Aadhaar [PHONE], IFSC
// HDFC0001234, UPI ravi@okhdfc` — PAN, IFSC and UPI undetected, and Aadhaar mislabelled as a phone
// number. A governed platform that displays a masking policy it does not enforce is worse than one
// that claims nothing.
//
// The correct patterns already existed (`adapters/pii-regex.ts`, format-anchored and unit-tested);
// they were simply not on the content-guardrail path. So this composes the two WITHOUT weakening the
// engine's fail-closed contract:
//
//   1. The precise domestic rules run first, on the ORIGINAL text. PAN/Aadhaar/IFSC/UPI are replaced
//      with their own correct labels, so the engine can no longer mislabel Aadhaar as a phone number.
//   2. The engine then screens the already-floored text and still catches everything it is good at
//      (names, emails, cards, injection, toxicity) on what remains.
//   3. The reported entities are the UNION, so the console names the domestic types it actually masked.
//
// WHAT THIS DELIBERATELY DOES NOT DO: it is not a fall-open. `mergeFloor` refuses to soften a blocked
// or unconfigured verdict — if the engine was configured and could not screen, the run stays denied
// even though the floor found something. The floor can only ever ADD coverage, never grant a pass.
// That ordering is the whole safety argument, so it is asserted in tests rather than left to comment.

import type { PiiResult } from '@/lib/adapters/types';
import { regexScan } from '@/lib/adapters/pii-regex';

export interface FloorPass {
  /** The text with domestic PII already replaced by its correctly-named label. */
  redacted: string;
  /** The domestic entity types found (IN_PAN, IN_AADHAAR, IN_IFSC, UPI_ID, …). */
  entities: string[];
}

/** Run the precise domestic rules over the original text. Pure; never touches the network. */
export function floorPass(text: string): FloorPass {
  const scanned = regexScan(text);
  return { redacted: scanned.redacted ?? text, entities: scanned.entities };
}

/**
 * Whether an engine verdict is one the floor must not soften.
 *
 * A blocked (configured-but-unreachable) or unconfigured verdict means the engine DID NOT SCREEN.
 * Turning that into a pass because a regex matched would convert a fail-closed guardrail into a
 * fail-open one — the exact bypass the engine's contract exists to prevent.
 */
export function isUnscreened(engine: PiiResult): boolean {
  return engine.blocked === true || engine.configured === false;
}

/**
 * Combine the floor with the engine's verdict.
 *
 * The engine's own status, blocked/configured flags and shard coverage are preserved verbatim; only
 * `entities` and `hits` gain the floor's findings. `redacted` stays the engine's text because the
 * engine screened the floored text, so its output already carries both passes.
 */
export function mergeFloor(floor: FloorPass, engine: PiiResult): PiiResult {
  if (isUnscreened(engine)) return engine;
  const entities = [...new Set([...floor.entities, ...engine.entities])];
  return {
    ...engine,
    entities,
    hits: engine.hits || floor.entities.length > 0,
    redacted: engine.redacted ?? floor.redacted,
  };
}
