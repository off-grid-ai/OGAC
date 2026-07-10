// Deterministic, seedable PRNG for the demo seed — PURE, zero I/O. The whole demo corpus (run
// tokens/latency/cost/timestamps, outcome distribution, eval scores) must be REPRODUCIBLE so the
// seed is idempotent: re-running writes the SAME numbers, never a fresh random spread that would
// make the seed non-deterministic. We derive every stream from a string seed via a tiny, well-known
// hash (FNV-1a → 32-bit state) feeding a mulberry32 generator — both public-domain, no dependency.
//
// SOLID: this is the one source of randomness for the demo data builders; they all take a Prng so
// the tests can assert exact values and the runner gets stable output across re-runs.

/** FNV-1a 32-bit hash of a string → the PRNG seed. Deterministic, dependency-free. */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in uint32 via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small deterministic PRNG (mulberry32). Given the same seed it yields the same sequence. */
export interface Prng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Float in [min, max). */
  float(min: number, max: number): number;
  /** True with probability p (0..1). */
  chance(p: number): boolean;
  /** Pick one element (undefined for an empty array). */
  pick<T>(arr: readonly T[]): T;
}

/** Build a Prng seeded from a string. Same string ⇒ identical stream. */
export function makePrng(seed: string): Prng {
  let state = seedFromString(seed);
  const next = (): number => {
    // mulberry32.
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}
