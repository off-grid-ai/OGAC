// ─── Chunking text for retrieval — PURE ────────────────────────────────────────────────────────────
//
// This function existed TWICE, byte-for-byte apart from a local variable: once in `rag.ts` (per-project
// documents) and once in `org-knowledge.ts` (the org corpus). Two copies of the rule that decides what a
// citation points at is exactly the duplication that drifts — change the overlap in one and half the
// product retrieves differently. One copy, imported by both, unit-testable on its own.
//
// ~600 words per chunk with 120 words of overlap (the Off Grid AI Desktop defaults, ≈4 chars/token).

export function chunkText(text: string, chunkSize = 600, overlap = 120): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const step = Math.max(1, chunkSize - overlap);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += step) {
    const slice = words.slice(i, i + chunkSize).join(' ');
    if (slice.trim().length > 20) chunks.push(slice);
    if (i + chunkSize >= words.length) break;
  }
  return chunks.length ? chunks : [text.trim()].filter(Boolean);
}
