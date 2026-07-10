// @offgrid/policy — tiny dependency-free string hash (FNV-1a, 32-bit).
// Used for cache keys. Not cryptographic; collision-resistant enough for a
// bounded in-process LRU-ish cache.

export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in int range.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
