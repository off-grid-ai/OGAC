// Pure logic for a "decrypt" text reveal: a headline word resolves from scrambled glyphs to its
// final characters, left to right, as if a system is decoding it -  an intelligent-system accent,
// not a toy. Zero IO: given the target text and a progress value 0..1, return the frame to paint.
// The .tsx drives `progress` from a rAF/timer; reduced motion just renders the final text.

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/<>#*';

/**
 * The visible frame at `progress` (0..1). Characters up to the resolved boundary show their real
 * value; the rest are scrambled from `GLYPHS`. Whitespace is never scrambled (it must keep the
 * word shape). `seed` makes the scramble deterministic so the same frame is reproducible/testable.
 */
export function decryptFrame(text: string, progress: number, seed = 0): string {
  const p = clamp01(progress);
  const resolved = Math.floor(p * text.length);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (i < resolved || ch === ' ') {
      out += ch;
    } else {
      // Deterministic pseudo-random glyph for (i, seed) -  no Math.random so tests are stable.
      const idx = (i * 73 + seed * 31 + i * i) % GLYPHS.length;
      out += GLYPHS[idx];
    }
  }
  return out;
}

/** Whether the reveal has fully resolved (every real character is showing). */
export function isDecrypted(text: string, progress: number): boolean {
  return Math.floor(clamp01(progress) * text.length) >= text.length;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
