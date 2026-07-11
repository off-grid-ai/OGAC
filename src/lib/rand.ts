// Pure, zero-IO random-token minter backed by the platform CSPRNG (globalThis.crypto). One home for
// every "short random suffix" used to make IDs / slugs / MIME boundaries collision-resistant, so we
// never reach for Math.random() (SonarCloud S2245 — not a CSPRNG). Works in Node (>=18), the edge
// runtime, and browsers, all of which expose Web Crypto on globalThis. These are uniqueness suffixes,
// NOT security tokens, but using the CSPRNG is free and removes the finding. See test/rand.test.ts.

const DEFAULT_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * A random string of `len` characters drawn uniformly from `alphabet` using the platform CSPRNG.
 * Rejection sampling keeps the distribution uniform (no modulo bias) for any alphabet length.
 */
export function randomToken(len = 4, alphabet = DEFAULT_ALPHABET): string {
  if (len <= 0) return '';
  if (alphabet.length === 0) throw new Error('randomToken: alphabet must not be empty');
  const n = alphabet.length;
  // Largest multiple of n that fits in a byte; bytes >= this are rejected to avoid modulo bias.
  const limit = Math.floor(256 / n) * n;
  let out = '';
  const buf = new Uint8Array(len);
  while (out.length < len) {
    globalThis.crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < len; i++) {
      const b = buf[i];
      if (b < limit) out += alphabet[b % n];
    }
  }
  return out;
}
